/**
 * Builds image/video prompts for product marketing media from product-graph
 * facts, so a render depicts the product that was actually designed rather
 * than generic stock imagery.
 *
 * These prompts never assert verification. Claim-bearing text belongs on the
 * page (gated by release + Verify state), not baked into pixels.
 */
export type MediaPromptContext = {
  productName: string;
  summary?: string | null;
  /** Requirement labels that describe visible form, size, or interface. */
  formNotes?: readonly string[];
  /** Component names the product visibly includes (display, connector, …). */
  components?: readonly string[];
  /** Verify state of the release this media describes. */
  verified: boolean;
};

const ROLE_DIRECTION: Record<string, string> = {
  HERO: "Hero shot: three-quarter view on a clean seamless studio backdrop, soft key light with gentle falloff, product centered with generous negative space for overlaid headline text.",
  GALLERY:
    "Catalog view: straight-on product shot on a neutral background, even lighting, no props, full product visible edge to edge.",
  DETAIL:
    "Macro detail: tight crop on the primary interface (display, connector, or control), shallow depth of field, emphasis on material and surface finish.",
  LIFESTYLE:
    "In-use context: the product resting on a real desk or workbench surface with natural window light, realistic scale cues, no human faces.",
  SOCIAL:
    "Square social crop: bold centered product with high-contrast lighting and simple background suitable for a thumbnail.",
  EXPLODED:
    "Exploded layout: major components separated along a vertical axis with even spacing on a plain background, engineering-illustration feel.",
  OTHER: "Clean studio product photograph on a neutral background.",
};

function bullets(lines: readonly string[]): string {
  return lines.map((line) => `- ${line}`).join("\n");
}

/** Prompt for one still (or the video shot description) of a product. */
export function buildMediaPrompt(input: {
  context: MediaPromptContext;
  role: string;
  /** Extra art direction typed by the user. */
  userPrompt?: string | null;
  /** Video adds motion direction instead of a single framing. */
  motion?: boolean;
}): string {
  const { context } = input;
  const sections: string[] = [
    `Photorealistic product visualization of a physical hardware product: ${context.productName}.`,
  ];

  if (context.summary) sections.push(`Product summary: ${context.summary}`);

  if (context.formNotes?.length) {
    sections.push("", "Design constraints that must be respected:", bullets(context.formNotes));
  }
  if (context.components?.length) {
    sections.push(
      "",
      "Visible hardware features (include only these):",
      bullets(context.components),
    );
  }

  sections.push("", ROLE_DIRECTION[input.role] ?? ROLE_DIRECTION.OTHER!);

  if (input.motion) {
    sections.push(
      "Motion: slow 180-degree orbit around the product with a subtle push-in, locked exposure, no cuts, no camera shake.",
    );
  }

  if (input.userPrompt?.trim()) {
    sections.push("", `Additional art direction: ${input.userPrompt.trim()}`);
  }

  sections.push(
    "",
    "Hard rules:",
    bullets([
      "Do not render any text, logo, wordmark, label, badge, packaging copy, or UI copy.",
      "Do not invent certification marks, safety seals, awards, or brand names.",
      "Do not add components, ports, or buttons that are not listed above.",
      "No people, no hands, no pets, no clutter unrelated to the product.",
      context.verified
        ? "Depict the product as built to the constraints above."
        : "This is a pre-production design concept — depict a prototype-quality object, not a retail-packaged product.",
    ]),
  );

  return sections.join("\n");
}
