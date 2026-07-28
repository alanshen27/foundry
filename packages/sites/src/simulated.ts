import type { SiteBuilderPort, SiteMessage, SiteRevision, SiteWorkspace } from "./port";

/**
 * SIMULATED site builder for dev/e2e when V0_API_KEY is unset.
 *
 * It generates nothing. Every revision is flagged `simulated` so callers can
 * label it, and publishing always fails — simulated output must never reach
 * a public URL (AGENTS.md rule 3).
 */
export function createSimulatedSiteBuilder(): SiteBuilderPort {
  let counter = 0;
  const workspaces = new Map<string, SiteWorkspace>();

  function revision(chatId: string): SiteRevision {
    return {
      chatId,
      versionId: `${chatId}-v${++counter}`,
      previewUrl: null,
      builderUrl: null,
      simulated: true,
    };
  }

  function message(chatId: string, role: SiteMessage["role"], content: string): SiteMessage {
    return {
      id: `${chatId}-message-${++counter}`,
      role,
      content,
      createdAt: new Date().toISOString(),
    };
  }

  function simulatedReply(chatId: string): SiteMessage {
    return message(
      chatId,
      "assistant",
      "SIMULATED mode: no site or source code was generated. Configure V0_API_KEY to use the native preview, code, and chat workspace.",
    );
  }

  return {
    async getSite(chatId) {
      const workspace = workspaces.get(chatId);
      return workspace
        ? { ok: true, data: workspace }
        : { ok: false, error: "Simulated site conversation not found" };
    },

    async createSite(prompt) {
      const chatId = `simulated-${Date.now()}-${++counter}`;
      const currentRevision = revision(chatId);
      workspaces.set(chatId, {
        chatId,
        revision: currentRevision,
        files: [],
        messages: [message(chatId, "user", prompt), simulatedReply(chatId)],
      });
      return { ok: true, data: currentRevision };
    },

    async reviseSite(chatId, prompt) {
      const current = workspaces.get(chatId);
      if (!current) return { ok: false, error: "Simulated site conversation not found" };
      const currentRevision = revision(chatId);
      workspaces.set(chatId, {
        ...current,
        revision: currentRevision,
        messages: [...current.messages, message(chatId, "user", prompt), simulatedReply(chatId)],
      });
      return { ok: true, data: currentRevision };
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
