import { notFound } from "next/navigation";
import { WorkspaceUiLab } from "@/components/dev/workspace-ui-lab";

export const dynamic = "force-dynamic";

/** Isolated synthetic UI review, never exposed by a production build. */
export default function WorkspaceUiLabPage() {
  if (process.env.NODE_ENV === "production") notFound();
  return <WorkspaceUiLab />;
}
