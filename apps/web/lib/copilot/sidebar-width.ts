export const CHAT_SIDEBAR_DEFAULT_WIDTH = 352;
export const CHAT_SIDEBAR_MIN_WIDTH = 300;
export const CHAT_SIDEBAR_STORAGE_KEY = "foundry:chat-width";

/** Keep the stored preference independent of the current window's limits. */
export function readChatSidebarWidth(saved: string | null): number {
  const width = Number(saved);
  return Number.isFinite(width) && width >= CHAT_SIDEBAR_MIN_WIDTH && width <= 1200
    ? width
    : CHAT_SIDEBAR_DEFAULT_WIDTH;
}

export function maxChatSidebarWidth(viewportWidth: number): number {
  return Math.max(
    0,
    Math.min(600, viewportWidth >= 1024 ? viewportWidth * 0.44 : viewportWidth - 24),
  );
}

export function clampChatSidebarWidth(width: number, viewportWidth: number): number {
  const max = maxChatSidebarWidth(viewportWidth);
  return Math.min(max, Math.max(Math.min(CHAT_SIDEBAR_MIN_WIDTH, max), width));
}

/** The divider is on the left: moving it left gives the sidebar more room. */
export function keyboardChatSidebarWidth(
  preferredWidth: number,
  key: string,
  viewportWidth: number,
): number | null {
  const renderedWidth = clampChatSidebarWidth(preferredWidth, viewportWidth);
  if (key === "ArrowLeft") return clampChatSidebarWidth(renderedWidth + 20, viewportWidth);
  if (key === "ArrowRight") return clampChatSidebarWidth(renderedWidth - 20, viewportWidth);
  if (key === "Home") return clampChatSidebarWidth(CHAT_SIDEBAR_MIN_WIDTH, viewportWidth);
  if (key === "End") return maxChatSidebarWidth(viewportWidth);
  return null;
}
