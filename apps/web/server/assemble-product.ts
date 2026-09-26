import "server-only";
import {
  defaultAssemblyIteratePrompt,
  rewriteKclModuleImportPaths,
  seedAssemblyPreviewKcl,
  setActiveComponent,
  stableCadHash,
  toZooKclPath,
  updateComponentContent,
  type CadComponent,
  type CadDoc,
  type CadPort,
} from "@foundry/cad";
import { normalizePcbSet, type PcbDoc, type PcbSet } from "@/lib/pcb/doc";
import {
  isManagedPcbCadPartPath,
  legacyPcbPartKcl,
  pcbCadPartName,
  pcbCadPartPath,
  pcbPartKcl,
} from "@/lib/pcb/kcl";
import { pcbMechanicalSourceHash } from "@/lib/pcb/mechanical";
import { pcbPartPython, pcbPythonPath } from "@/lib/pcb/python";
import { withKclProjectDir } from "./kcl-project-dir";

export type PcbCadSyncResult = {
  doc: CadDoc;
  updated: string[];
  removed: string[];
  conflicts: string[];
};

/**
 * Pure all-board sync. Only content whose generated fingerprint still matches
 * can be replaced or removed. Legacy files are adopted only by exact equality
 * with a complete known generator output for exactly one current board.
 */
export function syncPcbCadParts(doc: CadDoc, set: PcbSet): PcbCadSyncResult {
  const updated: string[] = [];
  const removed: string[] = [];
  const conflicts: string[] = [];
  const boards = new Map(set.boards.map((b) => [b.id ?? "board-1", b]));
  if (boards.size !== set.boards.length)
    throw new Error("PCB board IDs must be unique before synchronization");
  let components = [...doc.components];
  let ambiguousLegacy = false;
  for (const component of components) {
    if (component.kind !== "part" || component.source || !isManagedPcbCadPartPath(component.path))
      continue;
    const matches = set.boards.filter(
      (board) =>
        component.content.trim() === legacyPcbPartKcl(board).trim() ||
        component.content.trim() === pcbPartKcl(board).trim(),
    );
    if (
      matches.length === 1 &&
      !components.some((c) => c.source?.boardId === (matches[0]!.id ?? "board-1"))
    ) {
      const board = matches[0]!;
      components = components.map((c) =>
        c.id === component.id
          ? {
              ...c,
              source: {
                kind: "pcb",
                boardId: board.id ?? "board-1",
                sourceHash: pcbMechanicalSourceHash(board),
                generatedHash: stableCadHash(c.content),
              },
            }
          : c,
      );
      updated.push(component.path);
    } else {
      ambiguousLegacy = true;
      conflicts.push(
        `${component.path}: unlinked PCB source cannot be safely identified; preserve it and rename or link it explicitly`,
      );
    }
  }
  const sourceIds = new Set<string>();
  const keep: CadComponent[] = [];
  for (const component of components) {
    if (component.source?.kind !== "pcb") {
      keep.push(component);
      continue;
    }
    const source = component.source;
    if (sourceIds.has(source.boardId)) {
      conflicts.push(`${component.path}: duplicate CAD source for board ${source.boardId}`);
      keep.push(component);
      continue;
    }
    sourceIds.add(source.boardId);
    const board = boards.get(source.boardId);
    if (stableCadHash(component.content) !== source.generatedHash) {
      conflicts.push(
        `${component.path}: generated PCB geometry was edited; preserving the custom source`,
      );
      keep.push(component);
      continue;
    }
    if (!board) {
      removed.push(component.path);
      continue;
    }
    if (doc.engine === "build123d" && component.path.endsWith(".kcl")) {
      conflicts.push(
        `${component.path}: preserved legacy PCB source needs conversion to Python before synchronization`,
      );
      keep.push(component);
      continue;
    }
    const content = doc.engine === "build123d" ? pcbPartPython(board) : pcbPartKcl(board);
    const nextSource = {
      kind: "pcb" as const,
      boardId: source.boardId,
      sourceHash: pcbMechanicalSourceHash(board),
      generatedHash: stableCadHash(content),
    };
    if (component.content !== content || stableCadHash(source) !== stableCadHash(nextSource)) {
      keep.push({ ...component, content, source: nextSource });
      if (!updated.includes(component.path)) updated.push(component.path);
    } else keep.push(component);
  }
  components = keep;
  for (const [boardId, board] of boards) {
    if (sourceIds.has(boardId) || ambiguousLegacy) continue;
    const name = pcbCadPartName(board);
    const path = doc.engine === "build123d" ? pcbPythonPath(board) : pcbCadPartPath(name);
    if (components.some((c) => c.path === path)) {
      conflicts.push(`${path}: an existing source owns this path`);
      continue;
    }
    const content = doc.engine === "build123d" ? pcbPartPython(board) : pcbPartKcl(board);
    let id = `pcb-${stableCadHash(boardId)}`;
    while (components.some((c) => c.id === id)) id += "-new";
    components.push({
      id,
      name: board.name?.trim() || "PCB board",
      path,
      kind: "part",
      content,
      source: {
        kind: "pcb",
        boardId,
        sourceHash: pcbMechanicalSourceHash(board),
        generatedHash: stableCadHash(content),
      },
    });
    updated.push(path);
  }
  const activeId = components.some((c) => c.id === doc.activeId)
    ? doc.activeId
    : (components[0]?.id ?? doc.activeId);
  const active =
    components.find((c) => c.id === activeId && c.kind !== "instructions") ??
    components.find((c) => c.kind !== "instructions");
  return {
    doc: { ...doc, components, activeId, script: active?.content ?? "" },
    updated,
    removed,
    conflicts,
  };
}

/** Compatibility entrypoint; a set is always synchronized as a whole. */
export function syncPcbCadPart(doc: CadDoc, pcb: PcbDoc | PcbSet | null): CadDoc {
  if (!pcb) return doc;
  const result = syncPcbCadParts(doc, normalizePcbSet(pcb));
  if (result.conflicts.length)
    throw new Error(`PCB synchronization conflicts: ${result.conflicts.join("; ")}`);
  return result.doc;
}

export type AssembleProductResult = {
  doc: CadDoc;
  assemblyPath: string;
  /** Manufacturing parts attached as read-only generation references. */
  placed: Array<{ path: string }>;
  operationId: string;
  executeMessage: string;
  warnings: string[];
};

/**
 * Rebuild `assembly/product.kcl` as a product PREVIEW via Astra:
 * 1. Attach manufacturing part KCL as reference (parts stay under parts/)
 * 2. Seed product.kcl with comments listing expected solid names
 * 3. Ask Astra for a coherent finished-product preview (named solids OK;
 *    imports optional — parts need not be reused as modules)
 * 4. Validate with Zoo MCP execute_kcl when available (soft-fail if MCP missing)
 */
export async function assembleProductWithZooMcp(params: {
  cad: CadPort;
  doc: CadDoc;
  assembly: CadComponent;
  parts: CadComponent[];
  pcb?: PcbDoc | PcbSet | null;
  /** Optional product-preview intent for Astra. */
  prompt?: string;
  signal?: AbortSignal;
  /** Progress of the Astra turn, for a live progress row in the UI. */
  onProgress?: (note: string) => void;
  onDraft?: (file: { path: string; content: string }) => void;
}): Promise<AssembleProductResult> {
  const warnings: string[] = [];
  let doc = params.pcb ? syncPcbCadPart(params.doc, params.pcb) : params.doc;

  const partList = params.parts.filter(
    (part) => !part.source || doc.components.some((c) => c.id === part.id),
  );
  // Use refreshed source objects after synchronization, including every board.
  for (let index = 0; index < partList.length; index++) {
    if (partList[index]!.source?.kind === "pcb") {
      partList[index] =
        doc.components.find((c) => c.id === partList[index]!.id) ?? partList[index]!;
    }
  }
  for (const pcbPart of doc.components.filter(
    (c) => c.source?.kind === "pcb" && c.kind === "part",
  )) {
    if (!partList.some((p) => p.id === pcbPart.id)) partList.push(pcbPart);
  }

  const usable: CadComponent[] = [];
  for (const part of partList) {
    if (!part.content.trim()) {
      warnings.push(`${part.path}: empty KCL — skipped`);
      continue;
    }
    usable.push(part);
  }

  if (usable.length === 0) {
    throw new Error("No parts available to assemble");
  }

  const seed = seedAssemblyPreviewKcl(usable);
  doc = setActiveComponent(
    updateComponentContent(doc, params.assembly.id, seed),
    params.assembly.id,
  );

  const files: Record<string, string> = {};
  for (const part of usable) {
    // Attach manufacturing parts as reference only — never write generated rewrites
    // back into parts/* (fab files stay authoritative).
    files[toZooKclPath(part.path)] = rewriteKclModuleImportPaths(part.content);
  }
  const assemblyZooPath = toZooKclPath(params.assembly.path);
  files[assemblyZooPath] = seed;
  files["main.kcl"] = seed;

  const prompt = params.prompt?.trim() || defaultAssemblyIteratePrompt(usable.map((p) => p.path));

  const iterated = await params.cad.iterateCadProject(files, prompt, {
    focusPath: "main.kcl",
    signal: params.signal,
    onProgress: params.onProgress,
    onDraft: (file) => params.onDraft?.({ ...file, path: params.assembly.path }),
  });
  if (!iterated.ok) {
    throw new Error("CAD assembly generation failed.");
  }

  const assemblyOut =
    iterated.data.files["main.kcl"] ??
    iterated.data.files[assemblyZooPath] ??
    iterated.data.files[params.assembly.path];
  if (!assemblyOut?.trim() || assemblyOut.trim() === seed.trim()) {
    throw new Error("Astra returned no product preview KCL");
  }

  doc = setActiveComponent(
    updateComponentContent(doc, params.assembly.id, assemblyOut),
    params.assembly.id,
  );

  params.onProgress?.("Validating the assembly in the engine");
  const executed = await withKclProjectDir(doc, params.assembly.path, (projectDir) =>
    params.cad.executeKcl({ projectDir }),
  );

  if (!executed.ok) {
    const message = "CAD assembly validation failed.";
    warnings.push(message);
    return {
      doc,
      assemblyPath: params.assembly.path,
      placed: usable.map((p) => ({ path: p.path })),
      operationId: iterated.data.id,
      executeMessage: message,
      warnings,
    };
  }

  return {
    doc,
    assemblyPath: params.assembly.path,
    placed: usable.map((p) => ({ path: p.path })),
    operationId: iterated.data.id,
    executeMessage: executed.data.message,
    warnings,
  };
}
