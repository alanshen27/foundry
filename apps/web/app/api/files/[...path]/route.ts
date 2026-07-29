import { NextResponse } from "next/server";
import { getCurrentUser } from "@/server/session";
import { requireProjectCapability } from "@/server/access";
import { getObjectStorage } from "@/server/storage";

/** Long enough for a page session; keys are content-addressed / UUID'd so reuse is fine. */
const SIGNED_URL_TTL_SECONDS = 60 * 60 * 6;

/**
 * Auth gate for stored objects, then 302 to a Supabase signed URL.
 *
 * Previously this downloaded the object into the Render process and re-streamed
 * it — every thumbnail/avatar paid Render↔Supabase RTT twice and felt like
 * `next dev`. The browser fetches bytes from Supabase (or its CDN) directly.
 *
 * - `projects/{projectId}/...` — project members with project.read
 * - `users/{userId}/...` — any signed-in user (avatars appear in member lists)
 */
export async function GET(_request: Request, { params }: { params: Promise<{ path: string[] }> }) {
  const { path } = await params;
  const key = path.map(decodeURIComponent).join("/");
  if (key.includes("..") || !path[0] || !path[1]) {
    return NextResponse.json({ error: "Invalid key" }, { status: 400 });
  }

  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  if (path[0] === "projects") {
    try {
      await requireProjectCapability(user.id, path[1], "project.read");
    } catch {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
  } else if (path[0] === "users") {
    // Avatars are readable by any authenticated user; writes stay on the user router.
  } else {
    return NextResponse.json({ error: "Invalid key" }, { status: 400 });
  }

  try {
    const signedUrl = await getObjectStorage().getSignedUrl(key, SIGNED_URL_TTL_SECONDS);
    return NextResponse.redirect(signedUrl, {
      status: 302,
      headers: {
        // Allow the browser to reuse the redirect briefly; the signed URL is the durable cache key.
        "cache-control": "private, max-age=60",
      },
    });
  } catch {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
}
