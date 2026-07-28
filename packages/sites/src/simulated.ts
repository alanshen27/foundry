import type { SiteBuilderPort } from "./port";

/**
 * SIMULATED site builder for dev/e2e when V0_API_KEY is unset.
 *
 * It generates nothing. Every revision is flagged `simulated` so callers can
 * label it, and publishing always fails — simulated output must never reach
 * a public URL (AGENTS.md rule 3).
 */
export function createSimulatedSiteBuilder(): SiteBuilderPort {
  let counter = 0;

  const revision = (chatId: string) => ({
    ok: true as const,
    data: {
      chatId,
      versionId: `${chatId}-v${++counter}`,
      previewUrl: null,
      builderUrl: null,
      simulated: true,
    },
  });

  return {
    async createSite() {
      return revision(`simulated-${Date.now()}-${++counter}`);
    },

    async reviseSite(chatId) {
      return revision(chatId);
    },

    async publishSite() {
      return {
        ok: false,
        error:
          "This site is SIMULATED and cannot be published. Set V0_API_KEY to generate a real site.",
      };
    },
  };
}
