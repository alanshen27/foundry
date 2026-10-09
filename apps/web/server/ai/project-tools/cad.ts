/**
 * Copilot tools: native Python/build123d CAD, linked assemblies, and
 * the connected schematic → PCB → CAD workflow.
 */

import { z } from "zod";
import { prisma } from "@foundry/db";
import {
  addCadComponents,
  normalizeCadDoc,
  removeCadComponents,
  toZooKclPath,
  fromZooKclPath,
  type CadComponentKind,
  type CadDoc,
} from "@/lib/cad/engine";
import { mutateModel3dDoc } from "../../cad-doc";
import { getPythonCad } from "../../cad";
import { evaluateCadComponent } from "../../python-cad";
import {
  upsertPythonPart,
  upsertPythonParts,
  upsertPythonCadContent,
  isPythonCadComponent,
  isCadStarterComponent,
  PYTHON_ASSEMBLY_PATH,
} from "@foundry/cad";
import { applyKclEdits } from "@/lib/cad/patch-kcl";
import { assemblyInstanceSchema } from "@/lib/engineering/input";
import { getEngineeringStatus, updateEngineering } from "../../engineering";
import { type ToolContext, type ToolKit, guard, touchStage } from "./shared";

/**
 * Long CAD tools attach their narration timeline (`progressLog`) to the output
 * so the transcript can expand it later — but replaying that timeline to the
 * model every turn is pure token waste, so it's stripped from what the model
 * sees.
 */
function stripProgressLogForModel({ output }: { output: unknown }) {
  const value =
    output && typeof output === "object" && "progressLog" in output
      ? Object.fromEntries(Object.entries(output).filter(([k]) => k !== "progressLog"))
      : output;
  return { type: "json" as const, value: value as never };
}

/**
 * Engineering results carry the whole CAD document, ~20 KB per call. The model
 * sees a part index instead and reads source with read_cad_file; the fit report
 * goes first so it is not lost behind the index.
 */
export function engineeringForModel({ output }: { output: unknown }) {
  if (!output || typeof output !== "object" || !("cad" in output)) {
    return { type: "json" as const, value: output as never };
  }
  const { cad, fit, seatNotes, ...rest } = output as Record<string, unknown> & { cad: CadDoc };
  const value = {
    ...(fit ? { fit } : {}),
    ...(Array.isArray(seatNotes) && seatNotes.length ? { seatNotes } : {}),
    ...rest,
    cad: {
      engine: cad.engine,
      activePath: cad.components.find((c) => c.id === cad.activeId)?.path ?? null,
      components: cad.components.map((c) => ({
        id: c.id,
        name: c.name,
        path: c.path,
        kind: c.kind,
        chars: c.content.length,
      })),
      ...(cad.assembly ? { instances: cad.assembly.instances } : {}),
    },
  };
  return { type: "json" as const, value: value as never };
}

/**
 * Resolve a model-supplied component reference to a CAD component. The model
 * tends to use whichever form it saw last — bare name, name with extension, or
 * full path — so all three resolve.
 */
function findCadComponent(doc: CadDoc, key: string, kind: CadComponentKind) {
  const raw = key.trim();
  const bare = raw.replace(/\.(?:kcl|py)$/i, "");
  const zooKey = toZooKclPath(raw);
  const fromZoo = fromZooKclPath(raw);
  return [...doc.components]
    .sort((a, b) =>
      doc.engine === "build123d"
        ? Number(isPythonCadComponent(b)) - Number(isPythonCadComponent(a))
        : 0,
    )
    .find((c) => {
      if (c.kind !== kind) return false;
      if (c.path === raw || c.path === zooKey || c.path === fromZoo) return true;
      if (c.name === bare || c.name === raw) return true;
      if (c.path.replace(/\.(?:kcl|py)$/i, "") === bare) return true;
      if (
        ["kcl", "py"].some(
          (ext) => c.path.endsWith(`/${bare}.${ext}`) || c.path.endsWith(`/${bare}/main.${ext}`),
        )
      )
        return true;
      if (toZooKclPath(c.path) === zooKey || fromZooKclPath(c.path) === fromZoo) return true;
      return false;
    });
}

/** Resolve a CAD file by id, path, or name (any kind). */
function findAnyCadComponent(doc: CadDoc, key: string) {
  const raw = key.trim();
  if (!raw) return undefined;
  const byId = doc.components.find((c) => c.id === raw);
  if (byId) return byId;
  for (const kind of ["part", "assembly", "instructions"] as const) {
    const hit = findCadComponent(doc, raw, kind);
    if (hit) return hit;
  }
  return undefined;
}

/** Mechanical CAD: native Python parts, linked assemblies, and engineering sync. */
export function buildCadTools(ctx: ToolContext, kit: ToolKit) {
  const { projectId, branchId } = ctx;
  const { CAD_PART_MAX_ATTEMPTS, progress, takeProgressLog } = kit;
  const mutateCad = (mutate: (doc: CadDoc) => CadDoc) =>
    mutateModel3dDoc(projectId, branchId, ctx.userId, mutate, ctx.runId);

  const readCadDoc = async () => {
    const row = await prisma.designDoc.findUnique({
      where: { projectId_branchId_kind: { projectId, branchId, kind: "MODEL3D" } },
    });
    return normalizeCadDoc(row?.data ?? null);
  };
  const nativePath = (base: CadDoc, key?: string) => {
    const existing = key ? findAnyCadComponent(base, key) : undefined;
    if (existing && isPythonCadComponent(existing)) return existing.path;
    const target = key?.replace(/\.kcl$/i, ".py");
    const candidate = upsertPythonPart(base, target, "");
    return candidate.components.find((part) => part.id === candidate.activeId)!.path;
  };
  const verifyPythonDoc = async (doc: CadDoc, signal?: AbortSignal) => {
    signal?.throwIfAborted();
    try {
      const geometry = await evaluateCadComponent(doc, doc.activeId, projectId, signal);
      signal?.throwIfAborted();
      if (!geometry.valid || geometry.solidCount < 1)
        return {
          verified: false as const,
          executeError: "build123d produced no valid solid geometry",
        };
      return {
        verified: true as const,
        boundingBoxMm: geometry.bbox,
        solidCount: geometry.solidCount,
        volumeMm3: geometry.volumeMm3,
      };
    } catch (error) {
      signal?.throwIfAborted();
      return {
        verified: false as const,
        executeError: error instanceof Error ? error.message : String(error),
      };
    }
  };
  const assertUnchanged = (before: CadDoc, current: CadDoc, paths: string[]) => {
    for (const path of paths) {
      if (
        before.components.find((part) => part.path === path)?.content !==
        current.components.find((part) => part.path === path)?.content
      )
        throw new Error(
          `CAD source changed while validating ${path}. Read the current file before retrying.`,
        );
    }
  };
  const saveNativeSource = async (
    script: string,
    partName: string | undefined,
    workspaceId: string,
    signal?: AbortSignal,
  ) => {
    const before = await readCadDoc();
    const key = partName?.endsWith(".kcl") ? partName.replace(/\.kcl$/, ".py") : partName;
    const candidate = upsertPythonCadContent(before, key, script);
    const component = candidate.components.find((part) => part.id === candidate.activeId)!;
    const verdict =
      component.kind === "instructions"
        ? { verified: "UNVERIFIED" as const, reason: "instructions are not geometry" }
        : await verifyPythonDoc(candidate, signal);
    if (verdict.verified === false)
      return {
        error: `Python CAD failed local execution; nothing saved: ${verdict.executeError}`,
        ...verdict,
      };
    signal?.throwIfAborted();
    const data = await mutateCad((current) => {
      assertUnchanged(before, current, [component.path]);
      return upsertPythonCadContent(current, component.path, script);
    });
    const staleStages = await touchStage(ctx, workspaceId, "ENGINEER");
    return {
      ok: true,
      engine: "build123d",
      language: component.kind === "instructions" ? "markdown" : "python",
      path: component.path,
      sourceChars: script.length,
      ...verdict,
      verificationState: "UNVERIFIED",
      staleStages,
      paths: data.components.map((part) => part.path),
      hint: "Editable source saved. Local solid validity does not establish assembly fit or manufacturing readiness.",
    };
  };

  return {
    get_engineering_status: {
      description:
        "Read the connected schematic → PCB → CAD → assembly workflow, local readiness issues, and current fingerprint. Call before sync_pcb_to_cad or build_linked_assembly. Current means synchronized only; it is not manufacturing verification.",
      inputSchema: z.object({}),
      execute: async () => guard(ctx, "project.read", () => getEngineeringStatus(ctx)),
      toModelOutput: engineeringForModel,
    },

    read_cad_file: {
      description:
        "Read the current source of one CAD file by path or name (e.g. parts/enclosure_lid/main.py). Engineering results list files without their source; read a file before patching it so find strings match exactly.",
      inputSchema: z.object({ path: z.string().min(1).max(240) }),
      execute: async ({ path }: { path: string }) =>
        guard(ctx, "project.read", async () => {
          const doc = await readCadDoc();
          const part =
            findCadComponent(doc, path, "part") ??
            findCadComponent(doc, path, "assembly") ??
            findCadComponent(doc, path, "instructions");
          if (!part) {
            return {
              error: `No CAD file matches ${path}.`,
              paths: doc.components.map((c) => c.path),
            };
          }
          return { path: part.path, name: part.name, kind: part.kind, content: part.content };
        }),
    },

    sync_pcb_to_cad: {
      description:
        "Update mechanical board parts from every saved PCB using stable board IDs, real outlines, mounting holes, and UNVERIFIED package-envelope mockups for footprints with known body heights. Preserves user-edited files by reporting conflicts. Requires the current fingerprint from get_engineering_status. Then inspect readiness and build_linked_assembly so those board parts are placed in the product.",
      inputSchema: z.object({ expectedFingerprint: z.string().length(64) }),
      execute: async (input: { expectedFingerprint: string }) =>
        guard(ctx, "mechanical.edit", () =>
          updateEngineering(ctx, { ...input, action: "sync_pcb_to_cad" }),
        ),
      toModelOutput: engineeringForModel,
    },

    build_linked_assembly: {
      description:
        "Build assembly/product.py by importing the ACTUAL manufacturing parts — including synced PCB boards with package mockups — and applying editable instance positions in mm and global XYZ rotations in degrees. Each instance is labeled so Assembly can highlight it. Explicitly replaces the product preview. First sync boards to CAD. Supply translations for pcb-* parts, not only housings. The builder then seats each upright PCB: the display top is set flush with the housing top face, and a board that crosses the housing outline is centered. Do not put the board back on the housing origin — that origin is the middle of a centered solid, so the screen lands about half the housing height too low and the board clips the walls. After building, the result carries fit: collisions (exact solid overlap between parts, e.g. display glass sunk into a lid frame) and loose (parts that can move 2 mm in a direction without touching anything, e.g. a button cap with no flange). Fix every entry by changing geometry — pockets, flanges, bosses, ribs, snaps — then rebuild. Never close a gap by lengthening a stem or moving a part into another. Omit instances to retain placements and add missing parts at the origin; origin placement is UNVERIFIED, never solved mates. Call get_engineering_status for fingerprint and component IDs.",
      inputSchema: z.object({
        expectedFingerprint: z.string().length(64),
        instances: assemblyInstanceSchema.array().max(200).optional(),
      }),
      execute: async (input: {
        expectedFingerprint: string;
        instances?: z.infer<typeof assemblyInstanceSchema>[];
      }) =>
        guard(ctx, "mechanical.edit", () =>
          updateEngineering(ctx, { ...input, action: "build_linked_assembly" }),
        ),
      toModelOutput: engineeringForModel,
    },

    create_cad_component: {
      description:
        "Add one or more components to Engineer > Model in a single call (Python parts, native Python assembly, or instructions markdown). Prefer one batched call with components:[…] over many parallel calls — same result, fewer round trips. Assembly kind ALWAYS creates/updates assembly/product.py (never another assembly path).",
      inputSchema: z
        .object({
          name: z.string().min(1).max(64).optional(),
          kind: z.enum(["part", "assembly", "instructions"]).optional(),
          content: z.string().max(40_000).optional(),
          components: z
            .array(
              z.object({
                name: z.string().min(1).max(64),
                kind: z.enum(["part", "assembly", "instructions"]),
                content: z.string().max(40_000).optional(),
              }),
            )
            .min(1)
            .max(20)
            .optional(),
        })
        .refine((v) => Boolean(v.components?.length || (v.name && v.kind)), {
          message: "Provide components[] or name+kind",
        }),
      execute: async (
        input: {
          name?: string;
          kind?: "part" | "assembly" | "instructions";
          content?: string;
          components?: {
            name: string;
            kind: "part" | "assembly" | "instructions";
            content?: string;
          }[];
        },
        options?: { abortSignal?: AbortSignal },
      ) =>
        guard(ctx, "mechanical.edit", async (workspaceId) => {
          options?.abortSignal?.throwIfAborted();
          const items =
            input.components ??
            (input.name && input.kind
              ? [{ name: input.name, kind: input.kind, content: input.content }]
              : []);
          const before = await readCadDoc();
          const beforePaths = new Set(before.components.map((part) => part.path));
          const candidate = addCadComponents({ ...before, engine: "build123d" }, items);
          for (const part of candidate.components) {
            const changed =
              before.components.find((existing) => existing.path === part.path)?.content !==
              part.content;
            if (
              !changed ||
              part.kind === "instructions" ||
              !items.some((item) => item.content?.trim())
            )
              continue;
            if (isCadStarterComponent(part)) continue;
            const verdict = await verifyPythonDoc(
              { ...candidate, activeId: part.id },
              options?.abortSignal,
            );
            if (!verdict.verified)
              return { error: `${part.path}: ${verdict.executeError}. Nothing saved.` };
          }
          options?.abortSignal?.throwIfAborted();
          const data = await mutateCad((current) => {
            if (JSON.stringify(current) !== JSON.stringify(before))
              throw new Error(
                "CAD changed while validating new components. Read the current project before retrying.",
              );
            return candidate;
          });
          const created = data.components.filter((c) => !beforePaths.has(c.path));
          const staled = await touchStage(ctx, workspaceId, "ENGINEER");
          return {
            ok: true,
            created: created.map((c) => ({ path: c.path, kind: c.kind, name: c.name })),
            paths: data.components.map((c) => c.path),
            staleStages: staled,
          };
        }),
    },

    delete_cad_component: {
      description:
        "Delete CAD files from Engineer > Model (parts/*.py, assembly/*.py, docs/*.md; legacy .kcl files stay addressable). Prefer paths or ids from get_project_state.cad.components. Use when the user asks to remove a part, scrap a failed generation, or clear an assembly file. After deleting parts referenced by assembly/product.py, call add_part_to_assembly again if the assembly should still exist.",
      inputSchema: z.object({
        paths: z
          .array(z.string().min(1).max(200))
          .max(40)
          .optional()
          .describe("Paths or names, e.g. parts/lid/main.py, lid, assembly/product.py"),
        ids: z
          .array(z.string())
          .max(40)
          .optional()
          .describe("Component ids from get_project_state"),
        nameContains: z
          .array(z.string().min(1).max(200))
          .max(20)
          .optional()
          .describe("Case-insensitive name substring match when path/id is unknown"),
      }),
      execute: async ({
        paths,
        ids,
        nameContains,
      }: {
        paths?: string[];
        ids?: string[];
        nameContains?: string[];
      }) =>
        guard(ctx, "mechanical.edit", async (workspaceId) => {
          if (
            (!paths || paths.length === 0) &&
            (!ids || ids.length === 0) &&
            (!nameContains || nameContains.length === 0)
          ) {
            return { error: "Provide paths, ids, and/or nameContains" };
          }
          const idSet = new Set(ids ?? []);
          const needles = (nameContains ?? []).map((n) => n.toLowerCase());
          const pathKeys = paths ?? [];
          let deleted: { id: string; path: string; kind: string; name: string }[] = [];
          const data = await mutateCad((base) => {
            const toDrop = new Set<string>();
            for (const c of base.components) {
              if (idSet.has(c.id)) toDrop.add(c.id);
              else if (needles.some((n) => c.name.toLowerCase().includes(n))) toDrop.add(c.id);
            }
            for (const key of pathKeys) {
              const hit = findAnyCadComponent(base, key);
              if (hit) toDrop.add(hit.id);
            }
            deleted = base.components
              .filter((c) => toDrop.has(c.id))
              .map((c) => ({ id: c.id, path: c.path, kind: c.kind, name: c.name }));
            return removeCadComponents(base, toDrop);
          });
          if (deleted.length === 0) {
            return {
              ok: true,
              deleted: 0,
              paths: data.components.map((c) => c.path),
              hint: "No matching CAD components. Call get_project_state and check cad.components.",
            };
          }
          const staled = await touchStage(ctx, workspaceId, "ENGINEER");
          return {
            ok: true,
            deleted: deleted.length,
            removed: deleted,
            paths: data.components.map((c) => c.path),
            staleStages: staled,
          };
        }),
    },

    text_to_cad: {
      description:
        "Generate editable Python/build123d CAD with GPT-6 Astra. Each part is executed locally through OpenCascade before saving its .py source. Use parts:[{partName,prompt}…] for independent parts in parallel; only successful parts are saved. Units are mm; use named dimension parameters and assign the final Shape or Builder to result. One focused repair is attempted on execution failure. Existing KCL remains preserved; new source uses Python. No Zoo calls are made.",
      inputSchema: z
        .object({
          prompt: z.string().min(10).max(4000).optional(),
          partName: z
            .string()
            .min(1)
            .max(128)
            .optional()
            .describe(
              "Name or Python path, e.g. enclosure or parts/lid/main.py. Defaults to main.",
            ),
          parts: z
            .array(
              z.object({
                partName: z.string().min(1).max(128),
                prompt: z.string().min(10).max(4000),
              }),
            )
            .min(1)
            .max(6)
            .optional(),
        })
        .refine((value) => Boolean(value.parts?.length || value.prompt), {
          message: "Provide parts[] or prompt",
        }),
      execute: async (
        input: {
          prompt?: string;
          partName?: string;
          parts?: { partName: string; prompt: string }[];
        },
        { abortSignal, toolCallId }: { abortSignal?: AbortSignal; toolCallId: string },
      ) =>
        guard(ctx, "mechanical.edit", async (workspaceId) => {
          if (abortSignal?.aborted) return { error: "CAD generation cancelled" };
          const cad = getPythonCad();
          const before = await readCadDoc();
          const jobs = (
            input.parts?.length
              ? input.parts
              : [{ partName: input.partName, prompt: input.prompt ?? "" }]
          ).map((job) => ({ ...job, path: nativePath(before, job.partName) }));
          if (new Set(jobs.map((job) => job.path)).size !== jobs.length)
            return { error: "Each generated part must have a distinct Python file path." };
          const contextFiles = Object.fromEntries(
            before.components.filter(isPythonCadComponent).map((part) => [part.path, part.content]),
          );
          type Verdict = Awaited<ReturnType<typeof verifyPythonDoc>>;
          const runJob = async (job: (typeof jobs)[number]) => {
            const label = jobs.length > 1 ? `${job.partName ?? "main"}: ` : "";
            let lastError = "CAD generation failed";
            let failedScript: string | undefined;
            let generationMs = 0;
            let verificationMs = 0;
            let attempts = 0;
            for (let attempt = 1; attempt <= CAD_PART_MAX_ATTEMPTS; attempt += 1) {
              if (abortSignal?.aborted) break;
              attempts = attempt;
              const prompt = failedScript
                ? `${job.prompt}\n\nRepair the supplied Python/build123d file using this exact execution error:\n${lastError}\nPreserve intended dimensions and unrelated working features. Return the complete corrected source at ${job.path}.`
                : job.prompt;
              const generationStarted = Date.now();
              const result = await cad
                .generate(prompt, {
                  projectName: projectId,
                  focusPath: job.path,
                  files: { ...contextFiles, ...(failedScript ? { [job.path]: failedScript } : {}) },
                  signal: abortSignal,
                  onDraft: (file: { path: string; content: string }) => {
                    if (file.path === job.path && !abortSignal?.aborted)
                      ctx.onCadDraft?.({ toolCallId, ...file });
                  },
                  onProgress: (note: string) =>
                    progress(
                      toolCallId,
                      "generate",
                      `${label}${attempt > 1 ? "Repairing: " : ""}${note}`,
                    ),
                })
                .catch((error: unknown) => ({
                  ok: false as const,
                  error: error instanceof Error ? error.message : String(error),
                }));
              generationMs += Date.now() - generationStarted;
              if (abortSignal?.aborted) break;
              if (!result.ok) {
                lastError = result.error;
                if (/cancelled|timed out/i.test(lastError)) break;
                continue;
              }
              const script = result.data.files[job.path];
              if (!script?.trim()) {
                lastError = `Astra returned no Python source for ${job.path}`;
                continue;
              }
              const candidate = upsertPythonPart(before, job.path, script);
              progress(toolCallId, "execute", `${label}checking local build123d geometry`);
              const verificationStarted = Date.now();
              let verdict: Verdict;
              try {
                verdict = await verifyPythonDoc(candidate, abortSignal);
              } catch (error) {
                if (abortSignal?.aborted) break;
                throw error;
              }
              const elapsed = Date.now() - verificationStarted;
              verificationMs += elapsed;
              if (abortSignal?.aborted) break;
              if (!verdict.verified) {
                lastError = verdict.executeError;
                failedScript = script;
                const canRepair =
                  attempt < CAD_PART_MAX_ATTEMPTS && !/cancelled|timed out/i.test(lastError);
                progress(
                  toolCallId,
                  canRepair ? "generate" : "execute",
                  `${label}Python execution failed (${(elapsed / 1000).toFixed(1)}s); ${canRepair ? "repairing the source with the execution error" : "not saved; existing part preserved"}`,
                );
                if (!canRepair) break;
                continue;
              }
              progress(
                toolCallId,
                "execute",
                `${label}build123d geometry is valid (${(elapsed / 1000).toFixed(1)}s)`,
              );
              return {
                job,
                script,
                operationId: result.data.id,
                verdict,
                generationMs,
                verificationMs,
                attempts,
              };
            }
            return {
              job,
              error: abortSignal?.aborted ? "CAD generation cancelled" : lastError,
              generationMs,
              verificationMs,
              attempts,
            };
          };
          progress(toolCallId, "generate", "Generating Python CAD with Astra");
          const outcomes = await Promise.all(jobs.map(runJob));
          const successful = outcomes.filter(
            (outcome) => "script" in outcome && typeof outcome.script === "string",
          );
          const failed = outcomes
            .filter((outcome) => "error" in outcome)
            .map((outcome) => ({
              partName: outcome.job.partName,
              error: outcome.error,
              attempts: outcome.attempts,
              generationMs: outcome.generationMs,
              verificationMs: outcome.verificationMs,
            }));
          if (!successful.length)
            return {
              error: failed.map((part) => `${part.partName ?? "main"}: ${part.error}`).join("; "),
              failed,
              progressLog: takeProgressLog(toolCallId),
            };
          abortSignal?.throwIfAborted();
          const data = await mutateCad((current) => {
            assertUnchanged(
              before,
              current,
              successful.map((part) => part.job.path),
            );
            return upsertPythonParts(
              current,
              successful.map((part) => ({ partName: part.job.path, script: part.script! })),
            );
          });
          const staleStages = await touchStage(ctx, workspaceId, "ENGINEER");
          return {
            ok: true,
            engine: "build123d",
            language: "python",
            generated: successful.length,
            parts: successful.map((part) => ({
              partName: part.job.partName,
              path: part.job.path,
              operationId: part.operationId,
              sourceChars: part.script!.length,
              attempts: part.attempts,
              ...part.verdict,
              generationMs: part.generationMs,
              verificationMs: part.verificationMs,
            })),
            ...(failed.length ? { failed } : {}),
            operationId: successful[0]?.operationId,
            path: data.components.find((part) => part.id === data.activeId)?.path,
            sourceChars: successful.reduce((sum, part) => sum + part.script!.length, 0),
            verificationState: "UNVERIFIED",
            staleStages,
            hint: failed.length
              ? "Retry only failed parts; their existing source was preserved."
              : "Editable Python saved and local geometry built. Use build_linked_assembly with actual parts; inspect fit separately.",
            progressLog: takeProgressLog(toolCallId),
          };
        }).finally(() => ctx.onCadProgressEnd?.(toolCallId)),
      toModelOutput: stripProgressLogForModel,
    },

    save_cad_script: {
      description:
        "Write editable Python/build123d CAD (.py), or assembly instructions markdown. Geometry must execute locally before it is saved. Units are mm; assign a Shape/Builder to result and declare named dimensions. Use parts/name/main.py for parts and assembly/product.py for assembly source. Legacy KCL is retained; write Python to a .py path.",
      inputSchema: z.object({
        script: z.string().min(8).max(40_000),
        partName: z.string().min(1).max(128).optional(),
      }),
      execute: async (
        { script, partName }: { script: string; partName?: string },
        options?: { abortSignal?: AbortSignal },
      ) =>
        guard(ctx, "mechanical.edit", (workspaceId) =>
          saveNativeSource(script, partName, workspaceId, options?.abortSignal),
        ),
    },

    patch_cad_script: {
      description:
        "Apply exact text edits to a saved Python CAD file or markdown instructions. Each find must match exactly once. Changed geometry is executed locally before saving; invalid edits leave the existing source untouched. Read the current .py path first. Legacy KCL must be converted to Python instead.",
      inputSchema: z.object({
        partName: z.string().min(1).max(128),
        edits: z
          .array(z.object({ find: z.string().min(1).max(2000), replace: z.string().max(2000) }))
          .min(1)
          .max(10),
      }),
      execute: async (
        input: { partName: string; edits: { find: string; replace: string }[] },
        { toolCallId, abortSignal }: { toolCallId: string; abortSignal?: AbortSignal },
      ) =>
        guard(ctx, "mechanical.edit", async (workspaceId) => {
          const before = await readCadDoc();
          const component = findAnyCadComponent(before, input.partName);
          if (!component)
            return {
              error: `No CAD component matches "${input.partName}" — check get_project_state.cad.components.`,
            };
          if (component.kind !== "instructions" && !isPythonCadComponent(component))
            return {
              error:
                "Legacy KCL is preserved. Regenerate this part with text_to_cad or save converted Python to a .py path.",
            };
          const patched = applyKclEdits(component.content, input.edits);
          if (!patched.ok) return { error: patched.error };
          const candidate = upsertPythonCadContent(before, component.path, patched.content);
          const verdict =
            component.kind === "instructions"
              ? { verified: "UNVERIFIED" as const, reason: "instructions are not geometry" }
              : await verifyPythonDoc(candidate, abortSignal);
          if (verdict.verified === false)
            return {
              error: `Patched Python fails local execution — nothing saved: ${verdict.executeError}`,
            };
          abortSignal?.throwIfAborted();
          const data = await mutateCad((current) => {
            assertUnchanged(before, current, [component.path]);
            return upsertPythonCadContent(current, component.path, patched.content);
          });
          const staleStages = await touchStage(ctx, workspaceId, "ENGINEER");
          return {
            ok: true,
            engine: "build123d",
            path: data.components.find((part) => part.id === data.activeId)?.path,
            editsApplied: input.edits.length,
            sourceChars: patched.content.length,
            ...verdict,
            verificationState: "UNVERIFIED",
            staleStages,
          };
        }).finally(() => ctx.onCadProgressEnd?.(toolCallId)),
    },

    python_cad: {
      description:
        "Save native editable Python/build123d source after local OpenCascade execution. Units are mm. Import build123d and assign result to the final Shape or Builder. This saves a .py component with named parameters, not an STL-only proxy. Invalid geometry is rejected without overwriting the prior part. Use `print('BUILD123D_PROGRESS: <note>')` to stream progress while the kernel runs.",
      inputSchema: z.object({
        partName: z.string().min(1).max(128),
        script: z.string().min(20).max(40_000),
      }),
      execute: async (
        { partName, script }: { partName: string; script: string },
        { toolCallId, abortSignal }: { toolCallId: string; abortSignal?: AbortSignal },
      ) =>
        guard(ctx, "mechanical.edit", async (workspaceId) => {
          progress(toolCallId, "execute", `${partName}: checking build123d geometry`);
          return saveNativeSource(script, partName, workspaceId, abortSignal);
        }).finally(() => ctx.onCadProgressEnd?.(toolCallId)),
      toModelOutput: stripProgressLogForModel,
    },

    add_part_to_assembly: {
      description:
        "Add existing native Python manufacturing parts to a linked assembly/product.py. Retains existing native instance poses; newly added instances begin at the origin and remain UNVERIFIED. Does not redraw or approximate parts. For explicit placement use build_linked_assembly. Optional prose intent is retained as a note, never treated as solved placement.",
      inputSchema: z.object({
        parts: z.array(z.string().min(1).max(128)).min(1).max(20),
        includePcb: z.boolean().optional().default(true),
        prompt: z.string().min(8).max(4000).optional(),
      }),
      execute: async (
        { parts, includePcb, prompt }: { parts: string[]; includePcb?: boolean; prompt?: string },
        { abortSignal, toolCallId }: { abortSignal?: AbortSignal; toolCallId: string },
      ) =>
        guard(ctx, "mechanical.edit", async () => {
          abortSignal?.throwIfAborted();
          let state = await getEngineeringStatus(ctx);
          const selected = parts.map((key) => findCadComponent(state.cad, key, "part"));
          const missing = parts.filter((_key, index) => !selected[index]);
          if (missing.length)
            return { error: `No matching manufacturing parts: ${missing.join(", ")}` };
          if (selected.some((part) => !isPythonCadComponent(part!)))
            return {
              error:
                "Convert or regenerate the selected KCL parts to Python before adding them to a native assembly. Original source remains preserved.",
            };
          if (includePcb !== false) {
            const pcb = await prisma.designDoc.findUnique({
              where: { projectId_branchId_kind: { projectId, branchId, kind: "PCB" } },
            });
            if (pcb?.data)
              state = await updateEngineering(ctx, {
                action: "sync_pcb_to_cad",
                expectedFingerprint: state.fingerprint,
              });
          }
          abortSignal?.throwIfAborted();
          const nativeParts = state.cad.components.filter(
            (part) => part.kind === "part" && isPythonCadComponent(part),
          );
          const ids = new Set(selected.map((part) => part!.id));
          if (includePcb !== false)
            nativeParts
              .filter((part) => part.source?.kind === "pcb")
              .forEach((part) => ids.add(part.id));
          const instances = [...(state.cad.assembly?.instances ?? [])];
          if (
            instances.some(
              (instance) => !nativeParts.some((part) => part.id === instance.componentId),
            )
          )
            return {
              error:
                "The saved assembly still references legacy or missing parts. Convert those parts and update their instance references before adding native parts. Existing placement is unchanged.",
            };
          for (const id of ids) {
            if (instances.some((instance) => instance.componentId === id)) continue;
            instances.push({
              id: `instance-${id}`,
              componentId: id,
              translationMm: { x: 0, y: 0, z: 0 },
              rotationDeg: { x: 0, y: 0, z: 0 },
              visible: true,
              fixed: false,
            });
          }
          progress(toolCallId, "assemble", "Linking actual Python manufacturing geometry");
          const result = await updateEngineering(ctx, {
            action: "build_linked_assembly",
            expectedFingerprint: state.fingerprint,
            instances,
          });
          return {
            ok: true,
            engine: "build123d",
            assembly: PYTHON_ASSEMBLY_PATH,
            verificationState: "UNVERIFIED",
            instances: result.cad.assembly?.instances,
            ...(result.fit ? { fit: result.fit } : {}),
            ...(prompt ? { intent: prompt } : {}),
            hint: "Native part geometry is linked. Retained poses were preserved; new instances are at the origin. Review explicit placement and fit before treating this as assembled.",
            progressLog: takeProgressLog(toolCallId),
          };
        }).finally(() => ctx.onCadProgressEnd?.(toolCallId)),
      toModelOutput: stripProgressLogForModel,
    },
  };
}
