/**
 * Fetches public KiCad footprint files for the copilot's footprint installer.
 *
 * Outbound requests are limited to public source hosts, each redirect hop is
 * re-checked against the allowlist, and bodies are size- and time-bounded, so
 * a model-chosen URL cannot reach internal services or stall a run.
 */

const MAX_BYTES = 1_000_000;
const TIMEOUT_MS = 10_000;
const MAX_REDIRECTS = 3;

export const KICAD_FOOTPRINTS_RAW =
  "https://gitlab.com/kicad/libraries/kicad-footprints/-/raw/master";

const SAFE_SEGMENT = /^[A-Za-z0-9][A-Za-z0-9_.,+-]{0,127}$/;

export class FootprintFetchError extends Error {}

/** Official KiCad library path, e.g. ("Button_Switch_THT", "SW_PUSH_6mm"). */
export function kicadLibraryUrl(library: string, footprint: string): string {
  const lib = library.replace(/\.pretty$/, "");
  const name = footprint.replace(/\.kicad_mod$/, "");
  if (
    !SAFE_SEGMENT.test(lib) ||
    !SAFE_SEGMENT.test(name) ||
    lib.includes("..") ||
    name.includes("..")
  )
    throw new FootprintFetchError("Library and footprint names must be plain KiCad names");
  return `${KICAD_FOOTPRINTS_RAW}/${encodeURIComponent(lib)}.pretty/${encodeURIComponent(name)}.kicad_mod`;
}

/** github.com blob links are HTML; the raw host serves the file itself. */
function normalizeSourceUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new FootprintFetchError("Not a valid URL");
  }
  if (url.hostname === "github.com") {
    const match = /^\/([^/]+)\/([^/]+)\/(?:blob|raw)\/(.+)$/.exec(url.pathname);
    if (match)
      url = new URL(`https://raw.githubusercontent.com/${match[1]}/${match[2]}/${match[3]}`);
  }
  return url;
}

export function isAllowedFootprintUrl(url: URL): boolean {
  if (url.protocol !== "https:" || url.username || url.password || url.port) return false;
  if (url.hostname === "raw.githubusercontent.com") return true;
  if (url.hostname === "gitlab.com")
    return /^\/kicad\/libraries\/kicad-footprints\/-\/raw\//.test(url.pathname);
  return false;
}

export async function fetchFootprintSource(
  rawUrl: string,
  fetchImpl: typeof fetch = fetch,
): Promise<{ url: string; text: string }> {
  let url = normalizeSourceUrl(rawUrl);
  if (!url.pathname.endsWith(".kicad_mod"))
    throw new FootprintFetchError("Only .kicad_mod footprint files can be installed from a URL");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    for (let hop = 0; ; hop++) {
      if (!isAllowedFootprintUrl(url))
        throw new FootprintFetchError(
          `${url.hostname} is not an allowed footprint source (official KiCad library on gitlab.com, or raw.githubusercontent.com)`,
        );
      const response = await fetchImpl(url, {
        redirect: "manual",
        signal: controller.signal,
        headers: { Accept: "text/plain" },
      });
      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get("location");
        if (!location || hop >= MAX_REDIRECTS) throw new FootprintFetchError("Too many redirects");
        url = new URL(location, url);
        continue;
      }
      if (!response.ok) throw new FootprintFetchError(`Source returned HTTP ${response.status}`);
      const declared = Number(response.headers.get("content-length") ?? 0);
      if (declared > MAX_BYTES) throw new FootprintFetchError("Footprint file is too large");
      const reader = response.body?.getReader();
      if (!reader) throw new FootprintFetchError("Empty response");
      const chunks: Uint8Array[] = [];
      let size = 0;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > MAX_BYTES) {
          await reader.cancel();
          throw new FootprintFetchError("Footprint file is too large");
        }
        chunks.push(value);
      }
      return { url: url.toString(), text: new TextDecoder().decode(Buffer.concat(chunks)) };
    }
  } catch (err) {
    if (err instanceof FootprintFetchError) throw err;
    throw new FootprintFetchError(
      controller.signal.aborted ? "Footprint download timed out" : "Footprint download failed",
    );
  } finally {
    clearTimeout(timer);
  }
}
