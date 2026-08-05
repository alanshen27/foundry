import { createClient } from "@supabase/supabase-js";
import type {
  CorpusRecord,
  CorpusSinkPort,
  CorpusSourceKind,
  ScrapeRunHandle,
  ScrapeRunStats,
} from "./port";

/**
 * Supabase adapter for CorpusSinkPort — the only file in this package that
 * imports a vendor SDK.
 *
 * Requires the service-role key: the `kcl` schema is not exposed through
 * PostgREST and its tables carry RLS with no permissive policies, so anon and
 * authenticated keys are denied by design.
 */
export function createSupabaseCorpusSink(input: {
  url: string;
  serviceRoleKey: string;
  /** Rows per upsert round-trip. */
  batchSize?: number;
}): CorpusSinkPort {
  // Schema is pinned to `kcl`, so the client type is inferred rather than
  // annotated: an explicit SupabaseClient defaults its schema to "public".
  const client = createClient(input.url, input.serviceRoleKey, {
    db: { schema: "kcl" },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const batchSize = input.batchSize ?? 500;

  return {
    async startRun({ sourceKinds, watermarkFrom }) {
      const { data, error } = await client
        .from("scrape_run")
        .insert({
          source_kinds: sourceKinds,
          watermark_from: watermarkFrom,
          status: "running",
        })
        .select("id")
        .single();
      if (error) throw new Error(`startRun failed: ${error.message}`);
      return { id: (data as { id: string }).id };
    },

    async writeRecords(run: ScrapeRunHandle, records: CorpusRecord[]) {
      let written = 0;
      for (let i = 0; i < records.length; i += batchSize) {
        const batch = records.slice(i, i + batchSize);

        // Snippets first: occurrences need their ids. onConflict on the content
        // hash makes a re-scrape of the same window a no-op.
        const { data: snippets, error: snippetError } = await client
          .from("snippet")
          .upsert(
            batch.map((r) => ({
              sha256: r.snippet.sha256,
              content: r.snippet.content,
              char_len: r.snippet.charLen,
              line_count: r.snippet.lineCount,
              component_kind: r.snippet.componentKind,
              origin: r.snippet.origin,
              has_module_imports: r.snippet.hasModuleImports,
              has_foreign_imports: r.snippet.hasForeignImports,
              top_level_params: r.snippet.topLevelParams,
              license: r.snippet.license,
              is_boilerplate: r.snippet.isBoilerplate,
            })),
            { onConflict: "sha256", ignoreDuplicates: false },
          )
          .select("id, sha256");
        if (snippetError) throw new Error(`snippet upsert failed: ${snippetError.message}`);

        const idBySha = new Map(
          (snippets as { id: string; sha256: string }[]).map((s) => [s.sha256, s.id]),
        );

        const { error: occurrenceError } = await client.from("occurrence").upsert(
          batch.map((r) => ({
            snippet_id: idBySha.get(r.snippet.sha256),
            source_kind: r.occurrence.sourceKind,
            source_id: r.occurrence.sourceId,
            project_ref: r.occurrence.projectRef,
            branch_ref: r.occurrence.branchRef,
            path: r.occurrence.path,
            component_name: r.occurrence.componentName,
            observed_at: r.occurrence.observedAt ?? undefined,
            scrape_run_id: run.id,
          })),
          { onConflict: "source_kind,source_id,path,snippet_id", ignoreDuplicates: true },
        );
        if (occurrenceError)
          throw new Error(`occurrence upsert failed: ${occurrenceError.message}`);

        written += batch.length;
      }
      return { written };
    },

    async finishRun(run, result) {
      const patch =
        result.status === "ok"
          ? {
              status: "ok",
              stats: result.stats as ScrapeRunStats,
              watermark_to: result.watermarkTo,
              finished_at: new Date().toISOString(),
            }
          : { status: "failed", error: result.error, finished_at: new Date().toISOString() };
      const { error } = await client.from("scrape_run").update(patch).eq("id", run.id);
      if (error) throw new Error(`finishRun failed: ${error.message}`);
    },

    async lastWatermark() {
      const { data, error } = await client
        .from("scrape_run")
        .select("watermark_to")
        .eq("status", "ok")
        .not("watermark_to", "is", null)
        .order("watermark_to", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw new Error(`lastWatermark failed: ${error.message}`);
      return (data as { watermark_to: string } | null)?.watermark_to ?? null;
    },
  };
}

export type { CorpusSourceKind };
