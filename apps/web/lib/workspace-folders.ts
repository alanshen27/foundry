export type FolderRef = {
  id: string;
  name: string;
  parentId: string | null;
  sortOrder: number;
  /** Palette id; null means derive from the folder id. See lib/folder-color.ts. */
  color?: string | null;
};

export type FolderNode = FolderRef & { children: FolderNode[] };

export function buildFolderTree(folders: FolderRef[]): FolderNode[] {
  const byParent = new Map<string | null, FolderRef[]>();
  for (const f of folders) {
    const list = byParent.get(f.parentId) ?? [];
    list.push(f);
    byParent.set(f.parentId, list);
  }
  function nest(parentId: string | null): FolderNode[] {
    return (byParent.get(parentId) ?? [])
      .slice()
      .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name))
      .map((f) => ({ ...f, children: nest(f.id) }));
  }
  return nest(null);
}

/** Root → … → current folder (empty if folderId is null / missing). */
export function folderBreadcrumbs(folders: FolderRef[], folderId: string | null): FolderRef[] {
  if (!folderId) return [];
  const byId = new Map(folders.map((f) => [f.id, f]));
  const chain: FolderRef[] = [];
  let current: string | null = folderId;
  while (current) {
    const folder = byId.get(current);
    if (!folder) break;
    chain.unshift(folder);
    current = folder.parentId;
  }
  return chain;
}

/** Folder ids that cannot be a move target for `folderId` (self + descendants). */
export function folderSubtreeIds(folders: FolderRef[], folderId: string): Set<string> {
  const children = new Map<string | null, string[]>();
  for (const f of folders) {
    const list = children.get(f.parentId) ?? [];
    list.push(f.id);
    children.set(f.parentId, list);
  }
  const blocked = new Set<string>();
  const stack = [folderId];
  while (stack.length) {
    const id = stack.pop()!;
    if (blocked.has(id)) continue;
    blocked.add(id);
    for (const child of children.get(id) ?? []) stack.push(child);
  }
  return blocked;
}

export function childFolders(folders: FolderRef[], parentId: string | null): FolderRef[] {
  return folders
    .filter((f) => f.parentId === parentId)
    .slice()
    .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name));
}
