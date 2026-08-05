/**
 * Client-safe @foundry/kcl-corpus entry. The Supabase adapter lives in
 * `@foundry/kcl-corpus/sink` so pure extraction can be used without the SDK.
 */
export type {
  CorpusComponentKind,
  CorpusOrigin,
  CorpusRecord,
  CorpusSinkPort,
  CorpusSourceKind,
  OccurrenceRecord,
  ScrapeRunHandle,
  ScrapeRunStats,
  SnippetRecord,
} from "./port";
export {
  buildSnippet,
  dedupeBySha,
  isBoilerplate,
  isTrivial,
  pseudonymize,
  sha256,
} from "./record";
export {
  extractDesignDoc,
  type DesignDocRow,
  type DesignDocExtractOptions,
} from "./extractors/design-doc";
export { extractRepoConstants } from "./extractors/repo";
export { extractSamples, type SampleFile, type SampleExtractOptions } from "./extractors/samples";
