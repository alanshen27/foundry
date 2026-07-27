import { describe, expect, it } from "vitest";
import {
  buildFolderTree,
  childFolders,
  folderBreadcrumbs,
  folderSubtreeIds,
  type FolderRef,
} from "@/lib/workspace-folders";

const folders: FolderRef[] = [
  { id: "a", name: "Alpha", parentId: null, sortOrder: 0 },
  { id: "b", name: "Beta", parentId: "a", sortOrder: 0 },
  { id: "c", name: "Gamma", parentId: "b", sortOrder: 0 },
  { id: "d", name: "Delta", parentId: null, sortOrder: 1 },
];

describe("buildFolderTree", () => {
  it("nests folders under parents and sorts siblings", () => {
    const tree = buildFolderTree(folders);
    expect(tree.map((f) => f.id)).toEqual(["a", "d"]);
    expect(tree[0]!.children.map((f) => f.id)).toEqual(["b"]);
    expect(tree[0]!.children[0]!.children.map((f) => f.id)).toEqual(["c"]);
  });
});

describe("folderBreadcrumbs", () => {
  it("returns the chain from root to the folder", () => {
    expect(folderBreadcrumbs(folders, "c").map((f) => f.id)).toEqual(["a", "b", "c"]);
    expect(folderBreadcrumbs(folders, null)).toEqual([]);
  });
});

describe("folderSubtreeIds", () => {
  it("includes self and descendants for move exclusion", () => {
    expect([...folderSubtreeIds(folders, "a")].sort()).toEqual(["a", "b", "c"]);
    expect([...folderSubtreeIds(folders, "d")]).toEqual(["d"]);
  });
});

describe("childFolders", () => {
  it("lists direct children of a parent", () => {
    expect(childFolders(folders, null).map((f) => f.id)).toEqual(["a", "d"]);
    expect(childFolders(folders, "a").map((f) => f.id)).toEqual(["b"]);
  });
});
