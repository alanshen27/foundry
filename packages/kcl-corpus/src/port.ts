/**
 * CorpusSinkPort: the only surface the KCL scrapers write through.
 *
 * Extractors stay pure — they turn a source row into records and never touch a
 * database. Swapping Supabase for a file dump or a dry run is a sink swap.
 */

export type CorpusComponentKind = "part" | "assembly" | "instructions";

export type CorpusOrigin = "human" | "zoo_generated" | "template" | "external";

export type CorpusSourceKind =
  "design_doc" | "chat_message" | "chat_run_event" | "repo" | "external";

/** A unique piece of KCL, addressed by the hash of its content. */
export type SnippetRecord = {
  sha256: string;
  content: string;
  charLen: number;
  lineCount: number;
  componentKind: CorpusComponentKind;
  origin: CorpusOrigin;
  hasModuleImports: boolean;
  hasForeignImports: boolean;
  topLevelParams: { name: string; value: number | boolean | string }[];
  license: string;
  isBoilerplate: boolean;
};

/** Where a snippet was seen. Many occurrences may share one snippet. */
export type OccurrenceRecord = {
  sourceKind: CorpusSourceKind;
  sourceId: string;
  /** Pseudonymized before it reaches the sink — never a raw FOUNDRY id. */
  projectRef: string | null;
  branchRef: string | null;
  path: string | null;
  componentName: string | null;
  observedAt: string | null;
};

/** One extracted item: the content plus the single place it came from. */
export type CorpusRecord = {
  snippet: SnippetRecord;
  occurrence: OccurrenceRecord;
};

export type ScrapeRunHandle = { id: string };

export type ScrapeRunStats = Record<string, number>;

export interface CorpusSinkPort {
  /** Open a run and return its handle; watermark drives incremental pulls. */
  startRun(input: {
    sourceKinds: CorpusSourceKind[];
    watermarkFrom: string | null;
  }): Promise<ScrapeRunHandle>;

  /**
   * Upsert a batch. Idempotent: snippets collide on sha256, occurrences on
   * their natural key, so re-running a window is a no-op.
   */
  writeRecords(run: ScrapeRunHandle, records: CorpusRecord[]): Promise<{ written: number }>;

  /** Close the run, recording stats and the new watermark. */
  finishRun(
    run: ScrapeRunHandle,
    result:
      | { status: "ok"; stats: ScrapeRunStats; watermarkTo: string | null }
      | { status: "failed"; error: string },
  ): Promise<void>;

  /** Watermark of the last successful run, for incremental extraction. */
  lastWatermark(): Promise<string | null>;
}
