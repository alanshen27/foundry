import "server-only";
import {
  defaultAssemblyIteratePrompt,
  rewriteKclModuleImportPaths,
  seedAssemblyPreviewKcl,
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
 * CAD manufacturing part (dims as parameters).
 */
export function syncPcbCadPart(doc: CadDoc, pcb: PcbDoc | null): CadDoc {
  if (!pcb) return doc;
  const kcl = pcbPartKcl(normalizePcbDoc(pcb));
  return upsertPartScript(doc, PCB_PART_NAME, kcl);
}

export type AssembleProductResult = {
  doc: CadDoc;
  assemblyPath: string;
  /** Manufacturing parts attached as Zoo references. */
  placed: Array<{ path: string }>;
  zooOpId: string;
  executeMessage: string;
  warnings: string[];
};

/**
 * Rebuild `assembly/product.kcl` as a product PREVIEW via Zoo Zookeeper:
 * 1. Attach manufacturing part KCL as reference (parts stay under parts/)
 * 2. Seed product.kcl with comments listing expected solid names
 * 3. Ask Zoo text-to-CAD for a coherent finished-product preview (named solids OK;
 *    imports optional — parts need not be reused as modules)
 * 4. Validate with Zoo MCP execute_kcl when available (soft-fail if MCP missing)
 */
export async function assembleProductWithZooMcp(params: {
  cad: CadPort;
  doc: CadDoc;
  assembly: CadComponent;
  parts: CadComponent[];
  pcb?: PcbDoc | null;
  /** Optional product-preview intent for Zoo. */
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

  const seed = seedAssemblyPreviewKcl(usable);
  doc = setActiveComponent(
    updateComponentContent(doc, params.assembly.id, seed),
    params.assembly.id,
  );

  const files: Record<string, string> = {};
  for (const part of usable) {
    // Attach manufacturing parts as reference only — never write Zoo rewrites
    // back into parts/* (fab files stay authoritative).
    files[toZooKclPath(part.path)] = rewriteKclModuleImportPaths(part.content);
  }
  const assemblyZooPath = toZooKclPath(params.assembly.path);
  files[assemblyZooPath] = seed;
  files["main.kcl"] = seed;

  const prompt = params.prompt?.trim() || defaultAssemblyIteratePrompt(usable.map((p) => p.path));

  const iterated = await params.cad.iterateCadProject(files, prompt, {
    focusPath: "main.kcl",
    forcedTools: ["text_to_cad"],
    signal: params.signal,
  });
  if (!iterated.ok) {
    throw new Error(`Zoo Zookeeper assembly preview failed: ${iterated.error}`);
  }

  const assemblyOut =
    iterated.data.files["main.kcl"] ??
    iterated.data.files[assemblyZooPath] ??
    iterated.data.files[params.assembly.path];
  if (!assemblyOut?.trim() || assemblyOut.trim() === seed.trim()) {
    throw new Error("Zoo Zookeeper returned no product preview KCL");
  }

  doc = setActiveComponent(
    updateComponentContent(doc, params.assembly.id, assemblyOut),
    params.assembly.id,
  );

  const executed = await withKclProjectDir(doc, params.assembly.path, (projectDir) =>
    params.cad.executeKcl({ projectDir }),
  );

  if (!executed.ok) {
    warnings.push(`Zoo MCP execute_kcl: ${executed.error}`);
    return {
      doc,
      assemblyPath: params.assembly.path,
      placed: usable.map((p) => ({ path: p.path })),
      zooOpId: iterated.data.id,
      executeMessage: executed.error,
      warnings,
    };
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
