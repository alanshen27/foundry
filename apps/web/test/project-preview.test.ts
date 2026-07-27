import { describe, expect, it } from "vitest";
import {
  projectPreview,
  projectThumbnailKey,
  type ProjectPreviewSource,
} from "@/lib/project-preview";

const RENDERED = new Date("2026-07-01T10:00:00Z");
const EDITED = new Date("2026-07-02T10:00:00Z");

const KEY = projectThumbnailKey("p1");

function source(over: Partial<ProjectPreviewSource> = {}): ProjectPreviewSource {
  return {
    id: "p1",
    activeBranchId: "main",
    thumbnailKey: null,
    thumbnailUpdatedAt: null,
    designDocs: [],
    ...over,
  };
}

describe("projectPreview", () => {
  it("reports no model when the branch has no CAD doc", () => {
    const preview = projectPreview(source());
    expect(preview.hasModel).toBe(false);
    expect(preview.stale).toBe(false);
    expect(preview.thumbnailUrl).toBeNull();
  });

  it("prefers the active branch's doc when several exist", () => {
    const preview = projectPreview(
      source({
        thumbnailUpdatedAt: RENDERED,
        thumbnailKey: KEY,
        designDocs: [
          { branchId: "experiment", updatedAt: EDITED },
          { branchId: "main", updatedAt: RENDERED },
        ],
      }),
    );
    // Fresh, because main (not the newer experiment branch) is what's rendered.
    expect(preview.stale).toBe(false);
  });

  it("marks a model with no preview as stale so one gets rendered", () => {
    const preview = projectPreview(
      source({ designDocs: [{ branchId: "main", updatedAt: EDITED }] }),
    );
    expect(preview.hasModel).toBe(true);
    expect(preview.stale).toBe(true);
  });

  it("marks a preview rendered before the last edit as stale", () => {
    const preview = projectPreview(
      source({
        thumbnailKey: KEY,
        thumbnailUpdatedAt: RENDERED,
        designDocs: [{ branchId: "main", updatedAt: EDITED }],
      }),
    );
    expect(preview.stale).toBe(true);
  });

  it("treats a preview matching the current edit as fresh", () => {
    const preview = projectPreview(
      source({
        thumbnailKey: KEY,
        thumbnailUpdatedAt: EDITED,
        designDocs: [{ branchId: "main", updatedAt: EDITED }],
      }),
    );
    expect(preview.stale).toBe(false);
  });

  it("marks a preview left over from an older render format as stale", () => {
    const preview = projectPreview(
      source({
        thumbnailKey: "projects/p1/thumb/model.png",
        thumbnailUpdatedAt: EDITED,
        designDocs: [{ branchId: "main", updatedAt: EDITED }],
      }),
    );
    expect(preview.stale).toBe(true);
  });

  it("cache-busts the URL with the render time", () => {
    const preview = projectPreview(
      source({ thumbnailKey: KEY, thumbnailUpdatedAt: RENDERED }),
    );
    expect(preview.thumbnailUrl).toBe(`/api/files/${KEY}?v=${RENDERED.getTime()}`);
  });

  it("falls back to the newest doc when no active branch is set", () => {
    const preview = projectPreview(
      source({
        activeBranchId: null,
        designDocs: [
          { branchId: "old", updatedAt: RENDERED },
          { branchId: "main", updatedAt: EDITED },
        ],
      }),
    );
    expect(preview.hasModel).toBe(true);
    expect(preview.stale).toBe(true);
  });
});
