import { normalizeCadDoc } from "@foundry/cad";
import type { CorpusRecord } from "../port";
import { buildSnippet, isTrivial, pseudonymize } from "../record";

/** A DesignDoc row (kind = MODEL3D) as read from Postgres. */
export type DesignDocRow = {
  id: string;
  projectId: string;
  branchId: string;
  /** CadDoc JSON — any shape; normalizeCadDoc migrates v4 and legacy docs. */
  data: unknown;
  updatedAt: Date | string;
};

export type DesignDocExtractOptions = {
  /** Salt for HMAC pseudonymization of project/branch ids. */
  salt: string;
  /** Keep stock starter scripts. Off by default — they swamp the corpus. */
  includeBoilerplate?: boolean;
};

/**
 * Extract every KCL component from a project's CAD workspace.
 *
 * Deliberately reads `components[]` and never `CadDoc.script`: that field is a
 * compat mirror of the active component, so counting it would duplicate one
 * component per document.
 */
export function extractDesignDoc(row: DesignDocRow, opts: DesignDocExtractOptions): CorpusRecord[] {
  const doc = normalizeCadDoc(row.data);
  const observedAt =
    row.updatedAt instanceof Date
      ? row.updatedAt.toISOString()
      : new Date(row.updatedAt).toISOString();

  const records: CorpusRecord[] = [];
  for (const component of doc.components) {
    const content = component.content ?? "";
    if (isTrivial(content, component.kind)) continue;

    const snippet = buildSnippet({
      content,
      componentKind: component.kind,
      // Authored in-app: by a person, or by Zoo and then kept. The chat
      // extractor (S2) is what can tell those apart; here it is unknowable.
      origin: "human",
      license: "user-content",
    });
    if (snippet.isBoilerplate && !opts.includeBoilerplate) continue;

    records.push({
      snippet,
      occurrence: {
        sourceKind: "design_doc",
        sourceId: row.id,
        projectRef: pseudonymize(row.projectId, opts.salt),
        branchRef: pseudonymize(row.branchId, opts.salt),
        path: component.path,
        componentName: component.name,
        observedAt,
      },
    });
  }
  return records;
}
