/**
 * Product-graph context handed to the site builder as a system prompt.
 *
 * This is the whole reason FOUNDRY generates sites instead of sending users
 * to a generic builder: the page is written from real requirements,
 * components, and release facts rather than from the user's prose alone.
 */
export type SiteProductContext = {
  productName: string;
  summary?: string | null;
  /** Immutable release this page describes. Null for an unreleased draft. */
  releaseVersion?: string | null;
  /** Whether the release's Verify stage was approved. Drives claim rules. */
  verified: boolean;
  requirements?: readonly { label: string; detail?: string | null }[];
  components?: readonly { name: string; quantity: number }[];
  /** Marketing media attached to this site, approved and ready to embed. */
  media?: readonly SiteMediaAsset[];
};

/**
 * One approved asset the builder may embed. URLs are time-limited signed URLs
 * from the storage port, so the builder must use them verbatim rather than
 * rewriting or re-hosting them.
 */
export type SiteMediaAsset = {
  slot: "HERO" | "GALLERY" | "VIDEO_PRIMARY" | "SOCIAL";
  kind: "STILL" | "VIDEO";
  url: string;
  altText?: string | null;
  /** Still shown before a video plays. */
  posterUrl?: string | null;
};

function bullets(lines: readonly string[]): string {
  return lines.map((line) => `- ${line}`).join("\n");
}

/**
 * Builds the system prompt. The claim rules are not stylistic — PRD 24.4
 * requires that a listing never imply verification beyond recorded evidence,
 * so unverified products must not carry performance or safety claims.
 */
export function buildSiteSystemPrompt(ctx: SiteProductContext): string {
  const sections: string[] = [
    "You are generating a product landing page for a real, physical hardware product.",
    "Use only the product facts below. Do not invent specifications, dimensions, certifications, prices, reviews, or customer testimonials.",
    "",
    `Product: ${ctx.productName}`,
  ];

  if (ctx.summary) sections.push(`Summary: ${ctx.summary}`);
  sections.push(
    ctx.releaseVersion
      ? `Release: ${ctx.releaseVersion}`
      : "Release: none — this product has no immutable release yet.",
  );

  if (ctx.requirements?.length) {
    sections.push(
      "",
      "Requirements (the only specifications you may state):",
      bullets(ctx.requirements.map((r) => (r.detail ? `${r.label}: ${r.detail}` : r.label))),
    );
  }

  if (ctx.components?.length) {
    sections.push(
      "",
      "Key components (you may reference these by name):",
      bullets(ctx.components.map((c) => `${c.name} x${c.quantity}`)),
    );
  }

  if (ctx.media?.length) {
    sections.push(
      "",
      "Product media (approved renders and video for this product):",
      bullets(
        ctx.media.map((asset) => {
          const alt = asset.altText ? ` alt="${asset.altText}"` : "";
          const poster = asset.posterUrl ? ` poster=${asset.posterUrl}` : "";
          return `${asset.slot} (${asset.kind}): ${asset.url}${poster}${alt}`;
        }),
      ),
      "",
      "Media rules:",
      bullets([
        "Use these URLs verbatim in src attributes. Do not rewrite, proxy, shorten, or re-host them.",
        "Do not use placeholder services, stock photos, gradients-as-images, emoji, or invented image paths.",
        "HERO is the single above-the-fold image. GALLERY items go in a gallery/grid in the order listed. SOCIAL is only for og:image/twitter:image metadata.",
        "VIDEO_PRIMARY renders as an HTML5 <video> element with controls, muted, playsInline, and its poster when provided. Never autoplay with sound.",
        "Every image needs descriptive alt text; use the provided alt text when present.",
        "Do not overlay claims, badges, prices, or ratings on the media.",
      ]),
    );
  } else {
    sections.push(
      "",
      "Product media: none is available. Build a text-and-layout-driven page — do not reference image files, placeholder image services, or invented asset paths.",
    );
  }

  sections.push("", "Claim rules:");
  sections.push(
    ctx.verified
      ? bullets([
          "This product passed verification. You may describe the requirements above as met.",
          "Do not claim any certification, safety rating, or regulatory approval — none is recorded.",
          "Do not show an unverified or fake-product warning banner.",
        ])
      : bullets([
          "This product has NOT completed verification — treat it as an unverified / pre-proof product.",
          "Do not state or imply that any specification is proven, tested, certified, or safe.",
          "Present specifications as target/design intent only.",
          'REQUIRED: put a persistent, highly visible page alert/banner at the top of every viewport (sticky or fixed) with exact wording: "UNVERIFIED PRODUCT — Specs are design targets, not proven results." Use a high-contrast warning style. Do not hide it behind a dismiss control.',
        ]),
  );

  sections.push(
    "",
    "Build a single responsive landing page: hero, key specs, component highlights, and a call to action. Do not add a checkout or payment flow.",
  );

  return sections.join("\n");
}
