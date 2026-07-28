import { NextResponse } from "next/server";
import { getCurrentUser } from "@/server/session";
import { requireProjectCapability } from "@/server/access";
import { getObjectStorage } from "@/server/storage";

/**
 * Serves project files (concept images, render snapshots) from the storage
 * port to authenticated project members. Keys look like
 * `projects/{projectId}/...`.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ path: string[] }> }) {
  const { path } = await params;
  const key = path.map(decodeURIComponent).join("/");
  if (key.includes("..") || path[0] !== "projects" || !path[1]) {
    return NextResponse.json({ error: "Invalid key" }, { status: 400 });
  }

  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    await requireProjectCapability(user.id, path[1], "project.read");
  } catch {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const object = await getObjectStorage().get(key);
  if (!object) return NextResponse.json({ error: "Not found" }, { status: 404 });

  return new NextResponse(Buffer.from(object.body), {
    headers: {
      "content-type": object.contentType,
      "cache-control": "private, max-age=31536000, immutable",
    },
  });
}
