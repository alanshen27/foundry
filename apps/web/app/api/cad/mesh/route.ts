import { NextResponse } from "next/server";
import { createLogger } from "@foundry/observability";
import { exportCadMesh } from "@/server/cad-mesh";
import { readCadRequest } from "@/server/cad-request";

const log = createLogger("cad-mesh");

export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(request: Request): Promise<Response> {
  const authorized = await readCadRequest(request);
  if (authorized instanceof Response) return authorized;
  try {
    const stl = await exportCadMesh(authorized.input, authorized.projectId, request.signal);
    return new Response(new Uint8Array(stl), {
      headers: {
        "Content-Type": "model/stl",
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
        "X-Cad-Up-Axis": "z",
        "X-Cad-Unit": "mm",
      },
    });
  } catch (error) {
    if (!request.signal.aborted) log.warn("cad mesh export failed", { error });
    return NextResponse.json(
      {
        error: request.signal.aborted
          ? "CAD preview cancelled"
          : "The Python model could not be built. Check the source and imports, then retry.",
      },
      { status: request.signal.aborted ? 499 : 422 },
    );
  }
}
