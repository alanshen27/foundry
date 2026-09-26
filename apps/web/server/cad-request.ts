import "server-only";
import { NextResponse } from "next/server";
import {
  cadMeshRequestSchema,
  cadMeshStorageKey,
  type CadMeshRequest,
} from "@/lib/cad/mesh-request";
import { getCurrentUser } from "@/server/session";
import { requireProjectCapability } from "@/server/access";
import { verifyRenderToken } from "@/server/render-token";

const MAX_REQUEST_BYTES = 3_000_000;

/** Bound memory while reading the request, including clients without Content-Length. */
async function readPreviewBody(request: Request): Promise<string | null> {
  request.signal.throwIfAborted();
  const reader = request.body?.getReader();
  if (!reader) return "";
  const decoder = new TextDecoder();
  const chunks: string[] = [];
  let bytes = 0;
  try {
    while (true) {
      request.signal.throwIfAborted();
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > MAX_REQUEST_BYTES) {
        await reader.cancel().catch(() => undefined);
        return null;
      }
      chunks.push(decoder.decode(value, { stream: true }));
    }
    chunks.push(decoder.decode());
    return chunks.join("");
  } finally {
    reader.releaseLock();
  }
}

/** Read-only preview of the editor's draft; no project state or verification is changed. */
export async function readCadRequest(
  request: Request,
): Promise<Response | { input: CadMeshRequest; projectId: string | undefined }> {
  let raw: string | null;
  try {
    raw = await readPreviewBody(request);
  } catch {
    return NextResponse.json(
      { error: request.signal.aborted ? "CAD preview cancelled" : "Invalid CAD preview request" },
      { status: request.signal.aborted ? 499 : 400 },
    );
  }
  if (raw === null)
    return NextResponse.json({ error: "CAD preview is too large" }, { status: 413 });
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: "Invalid CAD preview request" }, { status: 400 });
  }
  const parsed = cadMeshRequestSchema.safeParse(body);
  if (!parsed.success)
    return NextResponse.json(
      { error: "Invalid CAD preview inputs or file paths" },
      { status: 400 },
    );
  const input = parsed.data;
  let projectId = input.projectId;
  if (input.renderToken) {
    const claims = verifyRenderToken(input.renderToken);
    if (!claims || claims.kind !== "model3d" || (projectId && claims.projectId !== projectId)) {
      return NextResponse.json({ error: "Invalid or expired render session" }, { status: 401 });
    }
    projectId = claims.projectId;
  } else if (projectId) {
    const user = await getCurrentUser();
    if (!user)
      return NextResponse.json({ error: "Sign in to preview this model" }, { status: 401 });
    try {
      await requireProjectCapability(user.id, projectId, "project.read");
    } catch {
      return NextResponse.json({ error: "You do not have access to this model" }, { status: 403 });
    }
  } else if (process.env.NODE_ENV === "production") {
    return NextResponse.json({ error: "Open a project to preview CAD geometry" }, { status: 401 });
  }
  if (
    (input.meshAssets ?? []).some(
      (asset) => !projectId || !cadMeshStorageKey(asset.fileUrl, projectId),
    )
  ) {
    return NextResponse.json(
      { error: "Mesh asset does not belong to this project" },
      { status: 403 },
    );
  }
  if (input.engine !== "build123d")
    return NextResponse.json(
      {
        error:
          "Zoo is disabled. Convert this KCL part to Python/build123d; its source is preserved.",
      },
      { status: 409 },
    );
  return { input, projectId };
}
