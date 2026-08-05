import type { CorpusRecord } from "../port";
import { buildSnippet, isTrivial } from "../record";

/** One `.kcl` file from an external sample set (e.g. KittyCAD/kcl-samples). */
export type SampleFile = {
  /** Repo-relative path, e.g. `bracket/main.kcl`. */
  path: string;
  content: string;
};

export type SampleExtractOptions = {
  /** Licence of the sample set. Recorded per row so exports can filter by it. */
  license: string;
  /** Identifies the sample set in `source_id`, e.g. `KittyCAD/kcl-samples`. */
  sourceRepo: string;
};

/**
 * Zoo's convention mirrors FOUNDRY's: a part is a directory containing
 * `main.kcl`, and a top-level `main.kcl` importing others is the assembly.
 */
function kindFor(content: string): "part" | "assembly" {
  const importsSiblings = /^\s*import\s+["']/m.test(content);
  return importsSiblings ? "assembly" : "part";
}

export function extractSamples(files: SampleFile[], opts: SampleExtractOptions): CorpusRecord[] {
  const records: CorpusRecord[] = [];
  for (const file of files) {
    if (!file.path.endsWith(".kcl")) continue;
    const kind = kindFor(file.content);
    if (isTrivial(file.content, kind)) continue;

    records.push({
      snippet: buildSnippet({
        content: file.content,
        componentKind: kind,
        origin: "external",
        license: opts.license,
      }),
      occurrence: {
        sourceKind: "external",
        sourceId: `${opts.sourceRepo}:${file.path}`,
        projectRef: null,
        branchRef: null,
        path: file.path,
        componentName: sampleName(file.path),
        observedAt: null,
      },
    });
  }
  return records;
}

/** `bracket/main.kcl` -> `bracket`; `flange.kcl` -> `flange`. */
function sampleName(path: string): string {
  const segments = path.split("/").filter(Boolean);
  const file = segments.at(-1) ?? path;
  if (file === "main.kcl" && segments.length > 1) return segments.at(-2)!;
  return file.replace(/\.kcl$/i, "");
}
