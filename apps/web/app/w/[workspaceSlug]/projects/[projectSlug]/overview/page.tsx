import { redirect } from "next/navigation";

/**
 * The workbench is the project. Overview used to be a stage-status landing
 * page; every link now lands straight in the Engineer viewport, and old
 * bookmarks follow.
 */
export default async function ProjectOverviewPage({
  params,
}: {
  params: Promise<{ workspaceSlug: string; projectSlug: string }>;
}) {
  const { workspaceSlug, projectSlug } = await params;
  redirect(`/w/${workspaceSlug}/projects/${projectSlug}/engineer`);
}
