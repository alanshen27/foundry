/**
 * Derives what a project card should show for its 3D preview.
 *
 * The cached PNG lives at a stable storage key, so the URL carries the render
 * time as a cache buster — `/api/files` marks responses immutable and would
 * otherwise pin the first render forever.
 */

/**
 * Bumped whenever the render itself changes shape (size, camera, framing), so
 * previews cached in the old format re-render instead of lingering forever —
 * nothing about the model changes, so the timestamp check alone can't catch it.
 */
const PREVIEW_FORMAT = "v5";

/** One key per project: the preview overwrites in place, so storage never grows. */
export function projectThumbnailKey(projectId: string) {
  return `projects/${projectId}/thumb/model-${PREVIEW_FORMAT}.png`;
}

export type ProjectPreviewSource = {
  id: string;
  activeBranchId: string | null;
  thumbnailKey: string | null;
  thumbnailUpdatedAt: Date | null;
  /** MODEL3D docs for this project, any branch. */
  designDocs: { branchId: string; updatedAt: Date }[];
};

export type ProjectPreview = {
  thumbnailUrl: string | null;
  /** There is CAD geometry worth rendering. */
  hasModel: boolean;
  /** The model changed since the cached preview was rendered. */
  stale: boolean;
};

/**
 * The doc the preview represents: the active branch's, or — for projects whose
 * active branch was never set — the most recently touched one.
 */
export function previewModelDoc<T extends { branchId: string; updatedAt: Date }>(
  activeBranchId: string | null,
  designDocs: T[],
): T | null {
  const onBranch = activeBranchId
    ? designDocs.find((d) => d.branchId === activeBranchId)
    : undefined;
  if (onBranch) return onBranch;
  return [...designDocs].sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())[0] ?? null;
}

export function projectPreview(project: ProjectPreviewSource): ProjectPreview {
  const modelUpdatedAt =
    previewModelDoc(project.activeBranchId, project.designDocs)?.updatedAt ?? null;

  const thumbnailUrl = project.thumbnailKey
    ? `/api/files/${project.thumbnailKey}?v=${project.thumbnailUpdatedAt?.getTime() ?? 0}`
    : null;

  const stale =
    modelUpdatedAt !== null &&
    (project.thumbnailUpdatedAt === null ||
      project.thumbnailKey !== projectThumbnailKey(project.id) ||
      project.thumbnailUpdatedAt.getTime() < modelUpdatedAt.getTime());

  return { thumbnailUrl, hasModel: modelUpdatedAt !== null, stale };
}
