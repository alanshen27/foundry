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

export const DESIGN_KINDS = ["CIRCUIT", "PCB", "MODEL3D", "DESIGN"] as const;
export type DesignKind = (typeof DESIGN_KINDS)[number];

/** Encode identifiers independently so a room can never cross a branch boundary. */
export function designDocumentRoom(projectId: string, branchId: string, kind: DesignKind): string {
  return `design:${encodeURIComponent(projectId)}:${encodeURIComponent(branchId)}:${kind}`;
}

export function parseDesignDocumentRoom(name: string): {
  projectId: string;
  branchId: string;
  kind: DesignKind;
} | null {
  const parts = name.split(":");
  if (parts.length !== 4 || parts[0] !== "design") return null;
  const kind = parts[3] as DesignKind;
  if (!DESIGN_KINDS.includes(kind)) return null;
  try {
    const projectId = decodeURIComponent(parts[1]!);
    const branchId = decodeURIComponent(parts[2]!);
    if (!projectId || !branchId || designDocumentRoom(projectId, branchId, kind) !== name)
      return null;
    return { projectId, branchId, kind };
  } catch {
    return null;
  }
}
