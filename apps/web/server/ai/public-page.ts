import "server-only";
import { lookup } from "node:dns/promises";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { BlockList, isIP } from "node:net";
import { brotliDecompressSync, gunzipSync, inflateSync } from "node:zlib";

const blocked = new BlockList();
for (const [address, prefix] of [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.88.99.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 3],
] as const)
  blocked.addSubnet(address, prefix, "ipv4");
const globalV6 = new BlockList();
globalV6.addSubnet("2000::", 3, "ipv6");
blocked.addSubnet("2001::", 23, "ipv6");
blocked.addSubnet("2001:db8::", 32, "ipv6");
blocked.addSubnet("2002::", 16, "ipv6");
blocked.addSubnet("3fff::", 20, "ipv6");

export function isPublicPageAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 4) return !blocked.check(address, "ipv4");
  return family === 6 && globalV6.check(address, "ipv6") && !blocked.check(address, "ipv6");
}

/** Strict web URLs only; DNS is checked separately and pinned on each connection. */
export function publicPageUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("Use a valid public product-page URL");
  }
  const host = url.hostname
    .replace(/^\[|\]$/g, "")
    .toLowerCase()
    .replace(/\.$/, "");
  if (
    !/^https?:$/.test(url.protocol) ||
    url.username ||
    url.password ||
    (url.port && url.port !== "80" && url.port !== "443") ||
    !host ||
    /(^|\.)(localhost|local|internal|invalid|test)$/.test(host) ||
    (isIP(host) && !isPublicPageAddress(host))
  ) {
    throw new Error("Product images require a public HTTP or HTTPS URL");
  }
  url.hash = "";
  return url;
}

export type PublicPageResponse = {
  url: string;
  status: number;
  headers: Record<string, string>;
  body: Buffer;
};
type Address = { address: string; family: number };
type Resolver = (hostname: string, options: { all: true; verbatim: true }) => Promise<Address[]>;

function aborted(signal: AbortSignal): Error {
  return new Error(
    signal.reason?.name === "TimeoutError"
      ? "Product image lookup timed out"
      : "Product image lookup cancelled",
  );
}

async function abortable<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) throw aborted(signal);
  return new Promise<T>((resolve, reject) => {
    const stop = () => reject(aborted(signal));
    signal.addEventListener("abort", stop, { once: true });
    promise.then(resolve, reject).finally(() => signal.removeEventListener("abort", stop));
  });
}

/**
 * Per-lookup DNS cache. All addresses must be public and the validated address
 * is passed directly to Node's socket lookup, preventing DNS-rebinding races.
 * Browser fallback uses this same loader for every subresource and redirect.
 */
export function createPublicPageLoader(signal: AbortSignal, resolve: Resolver = lookup) {
  const hosts = new Map<string, Promise<Address[]>>();
  const addresses = async (url: URL): Promise<Address[]> => {
    const host = url.hostname.replace(/^\[|\]$/g, "");
    const family = isIP(host);
    if (family) return [{ address: host, family }];
    let pending = hosts.get(host);
    if (!pending) {
      pending = resolve(host, { all: true, verbatim: true })
        .then((results) => {
          if (!results.length || results.some((item) => !isPublicPageAddress(item.address)))
            throw new Error("Product page hostname must resolve only to public addresses");
          return results;
        })
        .catch((error: unknown) => {
          if (error instanceof Error && error.message.includes("public addresses")) throw error;
          throw new Error("Product page hostname could not be resolved");
        });
      hosts.set(host, pending);
    }
    return abortable(pending, signal);
  };
  const validate = async (raw: string): Promise<URL> => {
    const url = publicPageUrl(raw);
    await addresses(url);
    if (signal.aborted) throw aborted(signal);
    return url;
  };
  const read = async (
    raw: string,
    options: { maxBytes?: number; accept?: string } = {},
    redirects = 0,
  ): Promise<PublicPageResponse> => {
    const url = await validate(raw);
    const resolved = await addresses(url);
    const address = resolved.find((item) => item.family === 4) ?? resolved[0]!;
    const maxBytes = options.maxBytes ?? 2_000_000;
    const response = await new Promise<PublicPageResponse>((resolve, reject) => {
      const request = url.protocol === "https:" ? httpsRequest : httpRequest;
      const req = request(
        url,
        {
          signal,
          method: "GET",
          family: address.family,
          // SNI/Host still use the product hostname; only DNS resolution is pinned.
          lookup: (_hostname, _options, callback) =>
            callback(null, address.address, address.family),
          headers: {
            "user-agent": "Foundry-Product-Images/1.0",
            accept: options.accept ?? "text/html,application/xhtml+xml",
            "accept-encoding": "identity",
          },
        },
        (res) => {
          const chunks: Buffer[] = [];
          let size = 0;
          res.on("data", (chunk: Buffer) => {
            size += chunk.length;
            if (size > maxBytes) {
              req.destroy(new Error("Product page exceeds the image lookup size limit"));
              return;
            }
            chunks.push(chunk);
          });
          res.on("error", reject);
          res.on("end", () => {
            try {
              const headers: Record<string, string> = {};
              for (const [key, value] of Object.entries(res.headers))
                if (value !== undefined && key !== "set-cookie")
                  headers[key] = Array.isArray(value) ? value.join(", ") : value;
              let body = Buffer.concat(chunks);
              const encoding = headers["content-encoding"];
              const decode =
                encoding === "gzip"
                  ? gunzipSync
                  : encoding === "br"
                    ? brotliDecompressSync
                    : encoding === "deflate"
                      ? inflateSync
                      : null;
              if (decode) body = decode(body, { maxOutputLength: maxBytes });
              else if (encoding && encoding !== "identity")
                throw new Error("Unsupported product page encoding");
              delete headers["content-encoding"];
              delete headers["content-length"];
              delete headers["transfer-encoding"];
              resolve({ url: url.href, status: res.statusCode ?? 502, headers, body });
            } catch {
              reject(new Error("Product page could not be decoded within the size limit"));
            }
          });
        },
      );
      req.setTimeout(8_000, () => req.destroy(new Error("Product page request timed out")));
      req.on("error", (error) =>
        reject(
          signal.aborted
            ? aborted(signal)
            : new Error(
                error.message.includes("size limit")
                  ? error.message
                  : "Product page request failed",
              ),
        ),
      );
      req.end();
    });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      if (redirects >= 4 || !response.headers.location)
        throw new Error("Product page redirected too many times");
      return read(new URL(response.headers.location, url).href, options, redirects + 1);
    }
    return response;
  };
  return { read, validate };
}
