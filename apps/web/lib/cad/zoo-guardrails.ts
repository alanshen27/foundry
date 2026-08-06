/**
 * Prompt guardrails for Zoo text-to-CAD: known engine limits and KCL API
 * pitfalls that Zoo's model repeatedly trips over. Appending them to every
 * generation prompt avoids multi-minute self-heal loops.
 */
export const KCL_ENGINE_GUARDRAILS = [
  "Engine constraints (must follow):",
  "- The engine cannot boolean union() or subtract() separate solids. Model the part as ONE closed-profile extrusion (a single solid) and cut holes/pockets from that single solid instead of combining multiple bodies.",
  "- point() takes no `construction` argument — never write point(construction = true).",
].join("\n");

/** First-attempt generation prompt with the engine guardrails appended. */
export function withKclGuardrails(prompt: string): string {
  return `${prompt}\n\n${KCL_ENGINE_GUARDRAILS}`;
}

/**
 * Regeneration prompt when the previous attempt produced no usable KCL, so
 * the retry has to start from the design prompt plus the failure.
 */
export function buildRegeneratePrompt(designPrompt: string, error: string): string {
  return `${withKclGuardrails(designPrompt)}\n\nIMPORTANT: a previous attempt produced KCL that failed in the engine with this error:\n${error}\nGenerate corrected KCL that avoids this exact error.`;
}

/**
 * Edit prompt for iterating on the previous attempt's KCL: fix the exact
 * engine error while keeping the already-modelled geometry, instead of
 * rediscovering the whole design from an empty project.
 */
export function buildFixIteratePrompt(designPrompt: string, error: string): string {
  return `The current KCL fails to execute in the engine with this error:\n${error}\nFix the file so it executes cleanly while preserving the existing geometry and design intent.\n\nDesign intent, for reference:\n${designPrompt}\n\n${KCL_ENGINE_GUARDRAILS}`;
}
