import { createHash, createHmac } from "node:crypto";
import {
  ASSEMBLY_STARTER_KCL,
  DEFAULT_ASSEMBLY_KCL,
  DEFAULT_INSTRUCTIONS_MD,
  DEFAULT_KCL,
  meshPartProxyKcl,
  parseCadParams,
  parseForeignImports,
  parseKclModuleImports,
} from "@foundry/cad";
import type { CorpusComponentKind, CorpusOrigin, SnippetRecord } from "./port";

/**
 * Stock content shipped with every new CAD workspace. These dominate the raw
 * corpus — most projects never touch the starter script — so they are hashed
 * once here, flagged, and excluded from the export views.
 *
 * meshPartProxyKcl is name-dependent, so it is matched structurally instead.
 */
const BOILERPLATE_HASHES: ReadonlySet<string> = new Set(
  [DEFAULT_KCL, DEFAULT_ASSEMBLY_KCL, ASSEMBLY_STARTER_KCL, DEFAULT_INSTRUCTIONS_MD].map((s) =>
    sha256(s),
  ),
);

/** Marker comment emitted by meshPartProxyKcl for any part name. */
const MESH_PROXY_MARKER = meshPartProxyKcl("x").split("\n")[1] ?? "proxyW = 12";

export function sha256(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

/**
 * Stable pseudonym for a FOUNDRY id. HMAC rather than a bare hash so the
 * mapping cannot be brute-forced from a leaked corpus: ids are short and
 * low-entropy, and the salt is held outside the corpus database.
 */
export function pseudonymize(id: string, salt: string): string {
  return createHmac("sha256", salt).update(id, "utf8").digest("hex").slice(0, 32);
}

export function isBoilerplate(content: string): boolean {
  if (BOILERPLATE_HASHES.has(sha256(content))) return true;
  return content.includes(MESH_PROXY_MARKER) && content.includes("UNVERIFIED mesh proxy");
}

/**
 * Content that carries no learnable geometry: empty, comment-only, or too
 * short to express a shape. Filtered before it reaches the sink.
 */
export function isTrivial(content: string, componentKind: CorpusComponentKind): boolean {
  const meaningful = content
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("//"));
  if (meaningful.length === 0) return true;
  // Instructions are prose; a single line is still a real instruction.
  if (componentKind === "instructions") return content.trim().length < 16;
  return meaningful.length < 2 || content.trim().length < 32;
}

export function buildSnippet(input: {
  content: string;
  componentKind: CorpusComponentKind;
  origin: CorpusOrigin;
  license: string;
}): SnippetRecord {
  const { content, componentKind, origin, license } = input;
  // Markdown instructions have no KCL grammar to parse.
  const isKcl = componentKind !== "instructions";
  return {
    sha256: sha256(content),
    content,
    charLen: content.length,
    lineCount: content.split("\n").length,
    componentKind,
    origin,
    hasModuleImports: isKcl && parseKclModuleImports(content).length > 0,
    hasForeignImports: isKcl && parseForeignImports(content).length > 0,
    topLevelParams: isKcl
      ? parseCadParams(content).map((p) => ({ name: p.name, value: p.value }))
      : [],
    license,
    isBoilerplate: isBoilerplate(content),
  };
}

/** Collapse records that hash alike, keeping the first occurrence of each. */
export function dedupeBySha(records: { snippet: SnippetRecord }[]): { snippet: SnippetRecord }[] {
  const seen = new Set<string>();
  return records.filter((r) => {
    if (seen.has(r.snippet.sha256)) return false;
    seen.add(r.snippet.sha256);
    return true;
  });
}
