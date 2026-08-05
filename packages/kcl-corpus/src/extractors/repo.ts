import {
  ASSEMBLY_STARTER_KCL,
  DEFAULT_ASSEMBLY_KCL,
  DEFAULT_INSTRUCTIONS_MD,
  DEFAULT_KCL,
} from "@foundry/cad";
import type { CorpusComponentKind, CorpusRecord } from "../port";
import { buildSnippet } from "../record";

/**
 * KCL that ships in the repository itself. Small but unambiguous: hand-written,
 * canonical, and covered by the repo's own licence rather than user content.
 *
 * These are the same constants `record.ts` flags as boilerplate, so they are
 * recorded with `includeBoilerplate` intent — provenance for the corpus, and a
 * reference point for measuring how far a project drifted from the starter.
 */
const REPO_SOURCES: {
  id: string;
  content: string;
  kind: CorpusComponentKind;
  path: string;
  name: string;
}[] = [
  {
    id: "packages/cad/src/doc.ts#DEFAULT_KCL",
    content: DEFAULT_KCL,
    kind: "part",
    path: "parts/main.kcl",
    name: "Default part",
  },
  {
    id: "packages/cad/src/doc.ts#DEFAULT_ASSEMBLY_KCL",
    content: DEFAULT_ASSEMBLY_KCL,
    kind: "assembly",
    path: "assembly/product.kcl",
    name: "Default assembly",
  },
  {
    id: "packages/cad/src/doc.ts#ASSEMBLY_STARTER_KCL",
    content: ASSEMBLY_STARTER_KCL,
    kind: "assembly",
    path: "assembly/product.kcl",
    name: "Assembly starter",
  },
  {
    id: "packages/cad/src/doc.ts#DEFAULT_INSTRUCTIONS_MD",
    content: DEFAULT_INSTRUCTIONS_MD,
    kind: "instructions",
    path: "docs/assembly-instructions.md",
    name: "Default instructions",
  },
];

export function extractRepoConstants(opts: { license: string }): CorpusRecord[] {
  return REPO_SOURCES.filter((s) => s.content.trim()).map((source) => ({
    snippet: buildSnippet({
      content: source.content,
      componentKind: source.kind,
      origin: "template",
      license: opts.license,
    }),
    occurrence: {
      sourceKind: "repo" as const,
      sourceId: source.id,
      projectRef: null,
      branchRef: null,
      path: source.path,
      componentName: source.name,
      observedAt: null,
    },
  }));
}
