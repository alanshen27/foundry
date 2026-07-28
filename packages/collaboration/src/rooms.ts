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
