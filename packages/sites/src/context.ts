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

  sections.push("", "Claim rules:");
  sections.push(
    ctx.verified
      ? bullets([
          "This product passed verification. You may describe the requirements above as met.",
          "Do not claim any certification, safety rating, or regulatory approval — none is recorded.",
        ])
      : bullets([
          "This product has NOT completed verification.",
          "Do not state or imply that any specification is proven, tested, certified, or safe.",
          "Present specifications as target/design intent, and include a visible note that figures are unverified.",
        ]),
  );

  sections.push(
    "",
    "Build a single responsive landing page: hero, key specs, component highlights, and a call to action. Do not add a checkout or payment flow.",
  );

  return sections.join("\n");
}
