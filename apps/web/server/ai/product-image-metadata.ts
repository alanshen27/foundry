import { publicPageUrl } from "./public-page";

export type ProductImageCandidate = {
  url: string;
  source: "og" | "twitter" | "jsonld" | "img";
  width: number;
  height: number;
};

function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|amp|quot|apos|lt|gt);/gi, (_all, entity: string) => {
    if (entity[0] === "#") {
      const value =
        entity[1]?.toLowerCase() === "x"
          ? parseInt(entity.slice(2), 16)
          : parseInt(entity.slice(1), 10);
      return value > 0 && value <= 0x10ffff ? String.fromCodePoint(value) : "";
    }
    return (
      ({ amp: "&", quot: '"', apos: "'", lt: "<", gt: ">" } as Record<string, string>)[
        entity.toLowerCase()
      ] ?? ""
    );
  });
}

function attributes(tag: string): Record<string, string> {
  const out: Record<string, string> = {};
  const re = /([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
  for (const match of tag.matchAll(re))
    out[match[1]!.toLowerCase()] = decodeEntities(match[2] ?? match[3] ?? match[4] ?? "");
  return out;
}

export function rankProductImages(
  raw: ProductImageCandidate[],
  limit: number,
): ProductImageCandidate[] {
  const seen = new Set<string>();
  const scores = { og: 4, twitter: 3, jsonld: 2, img: 1 };
  return raw
    .map((candidate) => ({ ...candidate }))
    .sort((a, b) => scores[b.source] - scores[a.source] || b.width * b.height - a.width * a.height)
    .filter((candidate) => {
      try {
        candidate.url = publicPageUrl(candidate.url).href;
      } catch {
        return false;
      }
      if (seen.has(candidate.url)) return false;
      seen.add(candidate.url);
      return true;
    })
    .slice(0, Math.max(1, Math.min(12, limit)));
}

/** Small bounded metadata pass; a browser is needed only when this yields no usable image. */
export function productImagesFromHtml(html: string, pageUrl: string): ProductImageCandidate[] {
  const out: ProductImageCandidate[] = [];
  const push = (value: unknown, source: ProductImageCandidate["source"], width = 0, height = 0) => {
    if (typeof value !== "string" || !value.trim()) return;
    try {
      out.push({ url: new URL(decodeEntities(value), pageUrl).href, source, width, height });
    } catch {
      /* invalid URL */
    }
  };
  const content = html.replace(/<!--[\s\S]*?-->/g, "");
  let visited = 0;
  const visit = (value: unknown, depth = 0): void => {
    if (!value || typeof value !== "object" || depth > 12 || ++visited > 1_000) return;
    if (Array.isArray(value)) {
      for (const item of value) visit(item, depth + 1);
      return;
    }
    const node = value as Record<string, unknown>;
    const images = Array.isArray(node.image) ? node.image : [node.image];
    for (const image of images) {
      if (typeof image === "string") push(image, "jsonld");
      else if (image && typeof image === "object")
        push((image as Record<string, unknown>).url, "jsonld");
    }
    if (node["@graph"]) visit(node["@graph"], depth + 1);
    if (node.mainEntity) visit(node.mainEntity, depth + 1);
  };
  for (const match of content.matchAll(
    /<script\b((?:"[^"]*"|'[^']*'|[^'">])*)>([\s\S]*?)<\/script\s*>/gi,
  )) {
    if (attributes(match[1]!).type?.toLowerCase() !== "application/ld+json") continue;
    try {
      visit(JSON.parse(match[2]!));
    } catch {
      /* malformed optional metadata */
    }
  }
  // Do not read pseudo-tags embedded in scripts, styles or text-only elements.
  const markup = content.replace(/<(script|style|textarea|title)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, "");
  for (const match of markup.matchAll(/<(meta|img)\b((?:"[^"]*"|'[^']*'|[^'">])*)>/gi)) {
    const attrs = attributes(match[2]!);
    if (match[1]!.toLowerCase() === "meta") {
      const name = (attrs.property ?? attrs.name ?? "").toLowerCase();
      if (["og:image", "og:image:url", "og:image:secure_url"].includes(name))
        push(attrs.content, "og");
      else if (["twitter:image", "twitter:image:src"].includes(name))
        push(attrs.content, "twitter");
    } else {
      const width = Number(attrs.width ?? 0),
        height = Number(attrs.height ?? 0);
      if (width >= 120 && height >= 120) push(attrs["data-src"] || attrs.src, "img", width, height);
    }
  }
  return rankProductImages(out, 12);
}
