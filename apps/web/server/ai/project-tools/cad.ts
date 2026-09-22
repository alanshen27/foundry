/**
 * Copilot tools: mechanical CAD: parts, KCL scripts, Python CAD, and the product assembly.
 */

import { z } from "zod";
import { prisma } from "@foundry/db";
import { createLogger } from "@foundry/observability";
import { normalizePcbDoc } from "@/lib/pcb/doc";
import { isPlausibleZooOpId } from "@foundry/cad";
import {
  addCadComponents,
  normalizeCadDoc,
  removeCadComponents,
  upsertCadContent,
  upsertPartScripts,
  toZooKclPath,
  fromZooKclPath,
  importAssetPath,
  importMeshAsPart,
  slugifyCadName,
  type CadComponentKind,
  type CadDoc,
} from "@/lib/cad/engine";
import { mutateModel3dDoc } from "../../cad-doc";
import { getObjectStorage } from "../../storage";
import { getCad } from "../../cad";
import { runBuild123d } from "@foundry/cad/server";
import { assembleProductWithZooMcp } from "../../assemble-product";
import { applyKclEdits } from "@/lib/cad/patch-kcl";
import {
  buildFixIteratePrompt,
  buildRegeneratePrompt,
  withKclGuardrails,
} from "@/lib/cad/zoo-guardrails";
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
 * Resolve a model-supplied component reference to a CAD component. The model
 * tends to use whichever form it saw last — bare name, name with extension, or
 * full path — so all three resolve.
 */
function findCadComponent(doc: CadDoc, key: string, kind: CadComponentKind) {
  const raw = key.trim();
  const bare = raw.replace(/\.kcl$/i, "");
  const zooKey = toZooKclPath(raw);
  const fromZoo = fromZooKclPath(raw);
  return doc.components.find((c) => {
    if (c.kind !== kind) return false;
    if (c.path === raw || c.path === zooKey || c.path === fromZoo) return true;
    if (c.name === bare || c.name === raw) return true;
    if (c.path.replace(/\.kcl$/i, "") === bare) return true;
    if (c.path.endsWith(`/${bare}.kcl`) || c.path.endsWith(`/${bare}/main.kcl`)) return true;
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

/** Mechanical CAD: parts, KCL scripts, Python CAD, and the product assembly. */
export function buildCadTools(ctx: ToolContext, kit: ToolKit) {
  const { projectId, branchId } = ctx;
  const { CAD_PART_MAX_ATTEMPTS, progress, takeProgressLog, verifyPartScript } = kit;

  return {
    create_cad_component: {
      description:
        "Add one or more components to Engineer > Model in a single call (parts, assembly KCL, or instructions markdown). Prefer one batched call with components:[…] over many parallel calls — same result, fewer round trips. Assembly kind ALWAYS creates/updates assembly/product.kcl (never another assembly path).",
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
      execute: async (input: {
        name?: string;
        kind?: "part" | "assembly" | "instructions";
        content?: string;
        components?: {
          name: string;
          kind: "part" | "assembly" | "instructions";
          content?: string;
        }[];
      }) =>
        guard(ctx, "mechanical.edit", async (workspaceId) => {
          const items =
            input.components ??
            (input.name && input.kind
              ? [{ name: input.name, kind: input.kind, content: input.content }]
              : []);
          const beforePaths = new Set<string>();
          const data = await mutateModel3dDoc(projectId, branchId, ctx.userId, (base) => {
            for (const c of base.components) beforePaths.add(c.path);
            return addCadComponents(base, items);
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
        "Delete CAD files from Engineer > Model (parts/*.kcl, assembly/*.kcl, docs/*.md). Prefer paths or ids from get_project_state.cad.components. Use when the user asks to remove a part, scrap a failed generation, or clear an assembly file. After deleting parts referenced by assembly/product.kcl, call add_part_to_assembly again if the assembly should still exist.",
      inputSchema: z.object({
        paths: z
          .array(z.string().min(1).max(200))
          .max(40)
          .optional()
          .describe("Paths or names, e.g. parts/lid.kcl, lid, assembly/product.kcl"),
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
          const data = await mutateModel3dDoc(projectId, branchId, ctx.userId, (base) => {
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
        "Generate parametric KCL parts via Zoo Zookeeper (Agent API) and save them into the CAD workspace (parts/*). Prefer this for new geometry. To model several independent parts (enclosure + lid + bracket), pass parts:[{partName,prompt}…] — they generate concurrently and each lands in its own file, which is much faster than one call per part. Each part is then engine-verified independently (verified/executeError per part) — fix only failing parts. Single-part form: prompt + optional partName (defaults to parts/main.kcl). Each generation can take several minutes. After success, call render_model_views. NEVER invent zooOpId — omit it for new jobs; only pass a zooOpId copied exactly from a prior tool error (legacy REST resume). Fall back to save_cad_script only if Zoo failed.",
      inputSchema: z
        .object({
          prompt: z
            .string()
            .min(10)
            .max(4000)
            .optional()
            .describe(
              "Detailed mechanical description of the part to generate (mm). Required for new jobs.",
            ),
          partName: z
            .string()
            .min(1)
            .max(64)
            .optional()
            .describe("Part name or path (e.g. enclosure or parts/lid.kcl). Defaults to main."),
          parts: z
            .array(
              z.object({
                partName: z
                  .string()
                  .min(1)
                  .max(64)
                  .describe("Part name or path — must be unique within the call."),
                prompt: z
                  .string()
                  .min(10)
                  .max(4000)
                  .describe("Detailed mechanical description of this part (mm)."),
              }),
            )
            .min(1)
            .max(6)
            .optional()
            .describe(
              "Independent parts to generate concurrently. Use when no part's geometry depends on another's output.",
            ),
          zooOpId: z
            .string()
            .uuid()
            .optional()
            .describe(
              "ONLY a Zoo op id from a previous text_to_cad timeout/cancel error. Never invent placeholders like 1111…/4444…. Omit for new generation. Single-part form only.",
            ),
        })
        .refine((v) => Boolean(v.parts?.length || v.zooOpId || v.prompt), {
          message: "Provide parts[], prompt, or zooOpId",
        }),
      execute: async (
        input: {
          prompt?: string;
          partName?: string;
          parts?: { partName: string; prompt: string }[];
          zooOpId?: string;
        },
        { abortSignal, toolCallId }: { abortSignal?: AbortSignal; toolCallId: string },
      ) =>
        guard(ctx, "mechanical.edit", async (workspaceId) => {
          let cad;
          try {
            cad = getCad();
          } catch (err) {
            return { error: err instanceof Error ? err.message : String(err) };
          }

          const { zooOpId } = input;
          const resumeId = zooOpId && isPlausibleZooOpId(zooOpId) ? zooOpId : undefined;
          if (zooOpId && !resumeId) {
            createLogger("tool").warn("ignoring invented zooOpId", {
              tool: "text_to_cad",
              zooOpId,
            });
          }

          const jobs: { partName?: string; prompt: string }[] = input.parts?.length
            ? input.parts
            : [{ partName: input.partName, prompt: input.prompt ?? "" }];

          progress(toolCallId, "generate");

          type PartVerdict = Awaited<ReturnType<typeof verifyPartScript>>;
          type JobOutcome = {
            job: { partName?: string; prompt: string };
            generated?: { script: string; operationId: string; attempts: number };
            verdict?: PartVerdict;
            failure?: string;
          };

          // Each part is a self-healing agent: generate, engine-verify, and on
          // a verification failure regenerate once with the engine error fed
          // back into the prompt — all parts run concurrently.
          const runJob = async (job: {
            partName?: string;
            prompt: string;
          }): Promise<JobOutcome> => {
            const label = jobs.length > 1 ? `${job.partName ?? "main"}: ` : "";
            let lastError: string | undefined;
            let lastKcl: string | undefined;
            for (let attempt = 1; attempt <= CAD_PART_MAX_ATTEMPTS; attempt += 1) {
              if (abortSignal?.aborted) break;
              const genOptions = {
                projectName: projectId,
                signal: abortSignal,
                onProgress: (note: string) =>
                  progress(
                    toolCallId,
                    "generate",
                    `${label}${attempt > 1 ? `(retry ${attempt - 1}) ` : ""}${note}`,
                  ),
              };
              // Retries with a failing script iterate on it (edit_kcl_code)
              // instead of regenerating the whole part from an empty project.
              const result =
                attempt > 1 && lastKcl && lastError
                  ? await cad.iterateCad(
                      lastKcl,
                      buildFixIteratePrompt(job.prompt, lastError),
                      genOptions,
                    )
                  : await cad.textToCad(
                      attempt > 1 && lastError
                        ? buildRegeneratePrompt(job.prompt, lastError)
                        : withKclGuardrails(job.prompt),
                      {
                        ...genOptions,
                        // Resume only applies to the single-part, first-attempt form.
                        existingOpId: jobs.length === 1 && attempt === 1 ? resumeId : undefined,
                      },
                    );
              if (!result.ok) {
                lastError = result.error;
                // Deadline/cancel exhausted the budget — retrying can't help.
                if (/cancelled|timed out/i.test(result.error)) break;
                if (attempt < CAD_PART_MAX_ATTEMPTS) {
                  progress(toolCallId, "generate", `${label}retrying after: ${result.error}`);
                }
                continue;
              }
              if (!result.data.kcl.trim()) {
                lastError = "Zoo returned empty KCL — retry with a simpler prompt";
                continue;
              }
              progress(toolCallId, "execute", `${label}verifying in the engine`);
              const verdict = await verifyPartScript(result.data.kcl).catch((): PartVerdict => ({
                verified: "UNVERIFIED",
                reason: "verification errored",
              }));
              if (verdict.verified === false && attempt < CAD_PART_MAX_ATTEMPTS) {
                lastError = verdict.executeError;
                lastKcl = result.data.kcl;
                progress(
                  toolCallId,
                  "generate",
                  `${label}KCL failed execute — iterating on it with the error`,
                );
                continue;
              }
              progress(
                toolCallId,
                "execute",
                verdict.verified === true
                  ? `${label}KCL executes clean`
                  : verdict.verified === false
                    ? `${label}${verdict.executeError}`
                    : `${label}saved unverified (${verdict.reason})`,
              );
              // Stream the part into the workspace the moment it exists, so
              // open viewports render it while the other parts still generate.
              // mutateModel3dDoc serializes writers, so concurrent jobs are safe.
              await mutateModel3dDoc(projectId, branchId, ctx.userId, (base) =>
                upsertPartScripts(base, [{ partName: job.partName, script: result.data.kcl }]),
              )
                .then(() => progress(toolCallId, "saved", `${label}part saved to the workspace`))
                .catch(() => undefined);
              return {
                job,
                generated: {
                  script: result.data.kcl,
                  operationId: result.data.id,
                  attempts: attempt,
                },
                verdict,
              };
            }
            return { job, failure: lastError ?? "CAD generation failed" };
          };

          const outcomes = await Promise.all(jobs.map(runJob));

          const generated: { partName?: string; script: string }[] = [];
          const succeeded: {
            partName?: string;
            operationId: string;
            kclChars: number;
            attempts: number;
          }[] = [];
          const failed: { partName?: string; error: string; zooOpId?: string; hint?: string }[] =
            [];
          const verdicts = new Map<string | undefined, PartVerdict>();

          for (const outcome of outcomes) {
            if (!outcome.generated) {
              const error = outcome.failure ?? "CAD generation failed";
              const fromErr = /zooOpId=([0-9a-f-]{36})/i.exec(error)?.[1];
              const realFromErr = fromErr && isPlausibleZooOpId(fromErr) ? fromErr : undefined;
              failed.push({
                partName: outcome.job.partName,
                error,
                ...(realFromErr ? { zooOpId: realFromErr } : {}),
                ...(/ObjectNotFound|status=404|invent/i.test(error)
                  ? {
                      hint: "Call text_to_cad again with only prompt (no zooOpId) to start a new Zoo job.",
                    }
                  : {}),
              });
              continue;
            }
            generated.push({ partName: outcome.job.partName, script: outcome.generated.script });
            succeeded.push({
              partName: outcome.job.partName,
              operationId: outcome.generated.operationId,
              kclChars: outcome.generated.script.length,
              attempts: outcome.generated.attempts,
            });
            if (outcome.verdict) verdicts.set(outcome.job.partName, outcome.verdict);
          }

          if (generated.length === 0) {
            const first = failed[0];
            const log = takeProgressLog(toolCallId);
            return {
              error: failed.map((f) => `${f.partName ?? "main"}: ${f.error}`).join("; "),
              ...(first?.zooOpId ? { zooOpId: first.zooOpId } : {}),
              ...(first?.hint ? { hint: first.hint } : {}),
              ...(log ? { progressLog: log } : {}),
            };
          }

          const verifyOf = (partName?: string) =>
            verdicts.get(partName) ?? {
              verified: "UNVERIFIED" as const,
              reason: "verification errored",
            };

          // One locked read-modify-write for every generated part, so parallel
          // results can't overwrite each other.
          const data = await mutateModel3dDoc(projectId, branchId, ctx.userId, (base) =>
            upsertPartScripts(base, generated),
          );
          const staled = await touchStage(ctx, workspaceId, "ENGINEER");
          const active = data.components.find((c) => c.id === data.activeId);
          const pathOf = (partName?: string) => {
            const key = partName?.trim();
            if (!key) return "parts/main.kcl";
            return (
              data.components.find(
                (c) =>
                  c.kind === "part" &&
                  (c.path === key || c.name === key || c.path.endsWith(`/${key}.kcl`)),
              )?.path ?? key
            );
          };

          return {
            ok: true,
            engine: "zoo",
            generated: succeeded.length,
            parts: succeeded.map((part) => ({
              ...part,
              path: pathOf(part.partName),
              ...verifyOf(part.partName),
            })),
            ...(failed.length > 0 ? { failed } : {}),
            operationId: succeeded[0]?.operationId,
            path: active?.path,
            kclChars: succeeded.reduce((sum, part) => sum + part.kclChars, 0),
            staleStages: staled,
            hint:
              failed.length > 0
                ? "Some parts failed — retry those with a shorter prompt or save_cad_script, then render_model_views."
                : [...verdicts.values()].some((v) => v.verified === false)
                  ? "Some parts saved but still fail engine execute after a self-heal retry (see executeError) — fix just those with patch_cad_script or python_cad, then render_model_views."
                  : "Call render_model_views to inspect, or save_cad_script / create_cad_component for more parts.",
            ...(() => {
              const log = takeProgressLog(toolCallId);
              return log ? { progressLog: log } : {};
            })(),
          };
        }).finally(() => ctx.onCadProgressEnd?.(toolCallId)),
      toModelOutput: stripProgressLogForModel,
    },

    save_cad_script: {
      description:
        "Write Zoo KCL (or instructions markdown) into the CAD workspace. Millimetres for KCL. Prefer text_to_cad for brand-new parts; use this to patch. Pass partName/path for non-main components (e.g. lid, docs/assembly-instructions.md). Assembly content MUST use path assembly/product.kcl (any other assembly/* path is rewritten there). Declare key dimensions as top-level bindings (`width = 60`) for visual controls.",
      inputSchema: z.object({
        script: z.string().min(8).max(40_000).describe("KCL or markdown source"),
        partName: z
          .string()
          .min(1)
          .max(64)
          .optional()
          .describe("Component name or path (default parts/main.kcl)."),
      }),
      execute: async ({ script, partName }: { script: string; partName?: string }) =>
        guard(ctx, "mechanical.edit", async (workspaceId) => {
          const data = await mutateModel3dDoc(projectId, branchId, ctx.userId, (base) =>
            upsertCadContent(base, partName, script),
          );
          const staled = await touchStage(ctx, workspaceId, "ENGINEER");
          const saved = data.components.find((c) => c.id === data.activeId);
          const verdict =
            saved?.kind === "part"
              ? await verifyPartScript(script)
              : ({ verified: "UNVERIFIED", reason: "not a standalone part" } as const);
          return {
            ok: true,
            engine: "zoo",
            path: saved?.path,
            kclChars: script.length,
            ...verdict,
            staleStages: staled,
            hint:
              verdict.verified === false
                ? "Saved, but the KCL fails engine execute (see executeError) — fix it before rendering."
                : "Call render_model_views to inspect the result from multiple angles.",
          };
        }),
    },

    patch_cad_script: {
      description:
        "Apply small, high-confidence text edits to an existing CAD file without a Zoo round-trip (seconds, not minutes) — e.g. change a dimension binding, rename a variable, tweak a fillet. Each edit's `find` must match the current content exactly once. Part edits are verified by real engine execute BEFORE saving; a failing patch is rejected and nothing changes. For new geometry or big rewrites use text_to_cad / save_cad_script instead.",
      inputSchema: z.object({
        partName: z
          .string()
          .min(1)
          .max(64)
          .describe("Component name or path (e.g. enclosure or parts/lid.kcl)."),
        edits: z
          .array(
            z.object({
              find: z
                .string()
                .min(1)
                .max(2000)
                .describe("Exact substring of the current content — must occur exactly once."),
              replace: z.string().max(2000),
            }),
          )
          .min(1)
          .max(10),
      }),
      execute: async (
        input: { partName: string; edits: { find: string; replace: string }[] },
        { toolCallId }: { toolCallId: string },
      ) =>
        guard(ctx, "mechanical.edit", async (workspaceId) => {
          const row = await prisma.designDoc.findUnique({
            where: { projectId_branchId_kind: { projectId, branchId, kind: "MODEL3D" } },
          });
          const doc = row?.data ? normalizeCadDoc(row.data) : null;
          const key = input.partName.trim();
          const component = doc?.components.find(
            (c) => c.path === key || c.name === key || c.path.endsWith(`/${key}.kcl`),
          );
          if (!component) {
            return {
              error: `No CAD component matches "${input.partName}" — check get_project_state.cad.components.`,
            };
          }

          const patched = applyKclEdits(component.content, input.edits);
          if (!patched.ok) return { error: patched.error };

          // Verify the patched script before it can land: this tool exists for
          // edits the model is confident in, so a failing execute means reject.
          let verdict: Awaited<ReturnType<typeof verifyPartScript>> = {
            verified: "UNVERIFIED",
            reason: "not a standalone part",
          };
          if (component.kind === "part") {
            progress(toolCallId, "execute", `${component.path}: verifying patched KCL`);
            verdict = await verifyPartScript(patched.content);
            if (verdict.verified === false) {
              return {
                error: `Patched KCL fails engine execute — nothing saved: ${verdict.executeError}`,
                hint: "Adjust the edit, or fall back to save_cad_script / text_to_cad.",
              };
            }
          }

          const data = await mutateModel3dDoc(projectId, branchId, ctx.userId, (base) =>
            upsertCadContent(base, component.path, patched.content),
          );
          const staled = await touchStage(ctx, workspaceId, "ENGINEER");
          return {
            ok: true,
            engine: "zoo",
            path: data.components.find((c) => c.id === data.activeId)?.path,
            editsApplied: input.edits.length,
            kclChars: patched.content.length,
            ...verdict,
            staleStages: staled,
            hint: "Call render_model_views if the change should be visually confirmed.",
          };
        }).finally(() => ctx.onCadProgressEnd?.(toolCallId)),
    },

    python_cad: {
      description:
        "Model a part in build123d (Python code-CAD, OCCT kernel) and import the exported STL mesh into the CAD workspace. Fast (seconds, local execution) and reliable for prismatic/geometric parts — a strong alternative when Zoo text_to_cad fails or loops. Millimetres. The script MUST assign the finished model to a variable named `result` (a build123d Part/Shape or builder, e.g. `with BuildPart() as bp: ...` then `result = bp.part`). Trade-off: the part lands as a mesh reference (UNVERIFIED import), not editable parametric KCL — prefer text_to_cad when in-viewport parametric editing matters.",
      inputSchema: z.object({
        partName: z.string().min(1).max(64).describe("Part name, e.g. rotary_knob"),
        script: z
          .string()
          .min(20)
          .max(40_000)
          .describe(
            "Python build123d source. No filesystem/network access; must set `result`. Use `print('BUILD123D_PROGRESS: <note>')` to stream progress to the user.",
          ),
      }),
      execute: async (
        input: { partName: string; script: string },
        { toolCallId, abortSignal }: { toolCallId: string; abortSignal?: AbortSignal },
      ) =>
        guard(ctx, "mechanical.edit", async (workspaceId) => {
          try {
            progress(toolCallId, "execute", `${input.partName}: running build123d (OCCT)`);
            const run = await runBuild123d(input.script, {
              signal: abortSignal,
              onProgress: (note) => progress(toolCallId, "execute", `${input.partName}: ${note}`),
            });
            if (!run.ok) {
              const log = takeProgressLog(toolCallId);
              return {
                error: `build123d failed: ${run.error}`,
                ...(log ? { progressLog: log } : {}),
              };
            }

            const name = slugifyCadName(input.partName) || "python-part";
            const filename = `${name}.stl`;
            const path = importAssetPath(filename, "stl");
            const key = `projects/${projectId}/cad/imports/${crypto.randomUUID()}-${filename}`;
            progress(toolCallId, "execute", `${input.partName}: storing mesh + importing`);
            const stored = await getObjectStorage().put(key, run.data.stl, "model/stl");

            await prisma.artifact.create({
              data: {
                projectId,
                branchId,
                kind: "cad_import",
                name: filename,
                storageKey: stored.key,
                sha256: stored.sha256,
                mimeType: "model/stl",
                sizeBytes: stored.sizeBytes,
                verificationState: "UNVERIFIED",
                createdById: ctx.userId,
              },
            });

            const data = await mutateModel3dDoc(projectId, branchId, ctx.userId, (base) =>
              importMeshAsPart(base, {
                name,
                path,
                format: "stl",
                storageKey: stored.key,
                sizeBytes: stored.sizeBytes,
                lengthUnit: "mm",
              }),
            );
            const staled = await touchStage(ctx, workspaceId, "ENGINEER");
            return {
              ok: true,
              engine: "build123d",
              partPath: data.components.find((c) => c.id === data.activeId)?.path,
              assetPath: path,
              boundingBoxMm: run.data.bbox,
              sizeBytes: stored.sizeBytes,
              verificationState: "UNVERIFIED",
              staleStages: staled,
              hint: "Mesh import — solid geometry built by OCCT (bbox above), but not parametric KCL. Call render_model_views to inspect it.",
              ...(() => {
                const log = takeProgressLog(toolCallId);
                return log ? { progressLog: log } : {};
              })(),
            };
          } finally {
            ctx.onCadProgressEnd?.(toolCallId);
          }
        }),
      toModelOutput: stripProgressLogForModel,
    },

    add_part_to_assembly: {
      description:
        "Generate assembly/product.kcl (the ONLY valid assembly path) as a product PREVIEW via Zoo Zookeeper text-to-CAD. Attaches manufacturing parts under parts/* as reference (dims/form) — Zoo does NOT have to import them; prefer named solids in the preview matching part names. parts/* stay manufacturing/fab files; assembly/product.kcl is the visual product for Engineer > Assembly. Includes parts/pcb when a PCB exists. Use when the user asks to assemble / preview the product.",
      inputSchema: z.object({
        parts: z
          .array(z.string().min(1).max(128))
          .min(1)
          .max(20)
          .describe("Names or paths of manufacturing parts, e.g. enclosure or parts/lid.kcl"),
        includePcb: z
          .boolean()
          .optional()
          .default(true)
          .describe(
            "Include the PCB board (parts/pcb.kcl) as a manufacturing reference when a PCB doc exists.",
          ),
        prompt: z
          .string()
          .min(8)
          .max(4000)
          .optional()
          .describe(
            "Optional product-preview intent for Zoo (how the finished product should look). Omit for the default preview prompt.",
          ),
      }),
      execute: async (
        {
          parts,
          includePcb,
          prompt,
        }: {
          parts: string[];
          includePcb?: boolean;
          prompt?: string;
        },
        { abortSignal, toolCallId }: { abortSignal?: AbortSignal; toolCallId: string },
      ) =>
        guard(ctx, "mechanical.edit", async (workspaceId) => {
          let cad;
          try {
            cad = getCad();
          } catch (err) {
            return { error: err instanceof Error ? err.message : String(err) };
          }

          const modelRow = await prisma.designDoc.findUnique({
            where: { projectId_branchId_kind: { projectId, branchId, kind: "MODEL3D" } },
          });
          const base = normalizeCadDoc(modelRow?.data ?? null);
          const target =
            base.components.find(
              (c) => c.kind === "assembly" && c.path === "assembly/product.kcl",
            ) ?? base.components.find((c) => c.kind === "assembly");
          if (!target) {
            return {
              error:
                "The CAD workspace has no assembly/product.kcl yet. Create it with create_cad_component({ name: 'product', kind: 'assembly' }).",
            };
          }

          const resolvedParts = [];
          const missing: string[] = [];
          for (const key of parts) {
            const part = findCadComponent(base, key, "part");
            if (!part) missing.push(key);
            else resolvedParts.push(part);
          }
          if (resolvedParts.length === 0) {
            return {
              error: `No matching parts. Missing: ${missing.join(", ") || "(none)"}. Call get_project_state for paths.`,
            };
          }

          let pcb = null;
          if (includePcb !== false) {
            const pcbRow = await prisma.designDoc.findUnique({
              where: { projectId_branchId_kind: { projectId, branchId, kind: "PCB" } },
            });
            if (pcbRow?.data) pcb = normalizePcbDoc(pcbRow.data);
          }

          let assembled;
          try {
            progress(toolCallId, "assemble");
            assembled = await assembleProductWithZooMcp({
              cad,
              doc: base,
              assembly: target,
              parts: resolvedParts,
              pcb,
              prompt,
              signal: abortSignal,
              onProgress: (note) => progress(toolCallId, "assemble", note),
            });
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            const sourceRangeBug = /source range out of bounds/i.test(message);
            return {
              error: message,
              hint: sourceRangeBug
                ? "Zoo client bug — retry add_part_to_assembly once."
                : "Retry add_part_to_assembly once with a shorter preview prompt, or report the error. Do not invent poses with save_cad_script.",
              retryable: true,
              ...(() => {
                const log = takeProgressLog(toolCallId);
                return log ? { progressLog: log } : {};
              })(),
            };
          }

          await mutateModel3dDoc(projectId, branchId, ctx.userId, () => assembled.doc);
          const staled = await touchStage(ctx, workspaceId, "ENGINEER");
          return {
            ok: true,
            assembly: assembled.assemblyPath,
            preview: true,
            manufacturingRefs: assembled.placed,
            zooOpId: assembled.zooOpId,
            zooExecute: assembled.executeMessage,
            ...(assembled.warnings.length ? { warnings: assembled.warnings } : {}),
            ...(missing.length ? { missing } : {}),
            staleStages: staled,
            hint: "Call render_model_views to inspect the product preview. Manufacturing parts under parts/ are unchanged.",
            ...(() => {
              const log = takeProgressLog(toolCallId);
              return log ? { progressLog: log } : {};
            })(),
          };
        }).finally(() => ctx.onCadProgressEnd?.(toolCallId)),
      toModelOutput: stripProgressLogForModel,
    },
  };
}
