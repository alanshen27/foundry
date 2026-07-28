import "server-only";
import {
  defaultAssemblyIteratePrompt,
  fromZooKclPath,
  rewriteKclModuleImportPaths,
  seedAssemblyKcl,
  setActiveComponent,
  toZooKclPath,
  updateComponentContent,
  upsertPartScript,
  type CadComponent,
  type CadDoc,
  type CadPort,
} from "@foundry/cad";
import { normalizePcbDoc, type PcbDoc } from "@/lib/pcb/doc";
import { PCB_PART_NAME, PCB_PART_PATH, pcbPartKcl } from "@/lib/pcb/kcl";
import { withKclProjectDir } from "./kcl-project-dir";

/**
 * Keep `parts/pcb/main.kcl` in sync with the PCB design doc so the board is a real
 * CAD part (dims as parameters) that can be imported into product.kcl.
 */
export function syncPcbCadPart(doc: CadDoc, pcb: PcbDoc | null): CadDoc {
  if (!pcb) return doc;
  const kcl = pcbPartKcl(normalizePcbDoc(pcb));
  return upsertPartScript(doc, PCB_PART_NAME, kcl);
}

export type AssembleProductResult = {
  doc: CadDoc;
  assemblyPath: string;
  /** Parts included in the Zoo multi-file project. */
  placed: Array<{ path: string }>;
  zooOpId: string;
  executeMessage: string;
  warnings: string[];
};

function mergeProjectOutputs(doc: CadDoc, outputs: Record<string, string>): CadDoc {
  let next = doc;
  for (const [zooPath, content] of Object.entries(outputs)) {
    if (!content.trim()) continue;
    const logical = fromZooKclPath(zooPath);
    const match = next.components.find(
      (c) =>
        c.path === logical ||
        c.path === zooPath ||
        toZooKclPath(c.path) === zooPath ||
        toZooKclPath(c.path) === toZooKclPath(logical),
    );
    if (!match) continue;
    next = updateComponentContent(next, match.id, content);
  }
  return next;
}

/**
 * Rebuild `assembly/product.kcl` with Zoo multi-file Text-to-CAD iteration:
 * 1. Attach existing part KCL files (no re-bootstrap of geometry)
 * 2. Seed product.kcl with imports only
 * 3. Ask Zoo ML to orient + position parts in the assembly file
 * 4. Validate with Zoo MCP execute_kcl
 */
export async function assembleProductWithZooMcp(params: {
  cad: CadPort;
  doc: CadDoc;
  assembly: CadComponent;
  parts: CadComponent[];
  pcb?: PcbDoc | null;
  /** Optional product-intent override for Zoo multi-file iteration. */
  prompt?: string;
  signal?: AbortSignal;
}): Promise<AssembleProductResult> {
  const warnings: string[] = [];
  let doc = params.pcb ? syncPcbCadPart(params.doc, params.pcb) : params.doc;

  const partList = [...params.parts];
  const pcbPart = doc.components.find((c) => c.path === PCB_PART_PATH && c.kind === "part");
  if (pcbPart && !partList.some((p) => p.id === pcbPart.id)) {
    partList.push(pcbPart);
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

  const seed = seedAssemblyKcl(usable);
  doc = setActiveComponent(
    updateComponentContent(doc, params.assembly.id, seed),
    params.assembly.id,
  );

  const files: Record<string, string> = {};
  for (const part of usable) {
    files[toZooKclPath(part.path)] = rewriteKclModuleImportPaths(part.content);
  }
  const assemblyZooPath = toZooKclPath(params.assembly.path);
  files[assemblyZooPath] = rewriteKclModuleImportPaths(seed);

  const prompt = params.prompt?.trim() || defaultAssemblyIteratePrompt(usable.map((p) => p.path));

  const iterated = await params.cad.iterateCadProject(files, prompt, {
    focusPath: assemblyZooPath,
    signal: params.signal,
  });
  if (!iterated.ok) {
    throw new Error(`Zoo multi-file iteration failed: ${iterated.error}`);
  }

  doc = mergeProjectOutputs(doc, iterated.data.files);
  const assemblyOut =
    iterated.data.files[assemblyZooPath] ??
    iterated.data.files[params.assembly.path] ??
    doc.components.find((c) => c.id === params.assembly.id)?.content;
  if (!assemblyOut?.trim()) {
    throw new Error("Zoo multi-file iteration returned no assembly KCL");
  }
  doc = setActiveComponent(
    updateComponentContent(doc, params.assembly.id, assemblyOut),
    params.assembly.id,
  );

  const executed = await withKclProjectDir(doc, params.assembly.path, (projectDir) =>
    params.cad.executeKcl({ projectDir }),
  );

  if (!executed.ok) {
    throw new Error(`Zoo MCP execute_kcl failed: ${executed.error}`);
  }

  return {
    doc,
    assemblyPath: params.assembly.path,
    placed: usable.map((p) => ({ path: p.path })),
    zooOpId: iterated.data.id,
    executeMessage: executed.data.message,
    warnings,
  };
}
