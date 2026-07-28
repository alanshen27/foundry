/** Yjs document name for a CodeFile live-edit session. */
export function codeFileRoom(fileId: string): string {
  return `codefile:${fileId}`;
}

export function parseCodeFileRoom(documentName: string): string | null {
  if (!documentName.startsWith("codefile:")) return null;
  const fileId = documentName.slice("codefile:".length);
  return fileId.length > 0 ? fileId : null;
}

/** Shared Y.Text key bound to Monaco via y-monaco. */
export const MONACO_YTEXT_KEY = "monaco";

/** Yjs document name for a Site editor shared revision-prompt draft. */
export function sitePromptRoom(siteId: string): string {
  return `siteprompt:${siteId}`;
}

export function parseSitePromptRoom(documentName: string): string | null {
  if (!documentName.startsWith("siteprompt:")) return null;
  const siteId = documentName.slice("siteprompt:".length);
  return siteId.length > 0 ? siteId : null;
}

/** Shared Y.Text key for the site revision prompt composer. */
export const SITE_PROMPT_YTEXT_KEY = "prompt";
