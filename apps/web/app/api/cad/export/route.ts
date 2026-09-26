import { NextResponse } from "next/server";
import { compileCadModel } from "@/server/cad-mesh";
import { readCadRequest } from "@/server/cad-request";

export const runtime = "nodejs";
export const maxDuration = 300;

/** Rebuilds the current source snapshot; the STEP file retains exact OCCT solids. */
export async function POST(request: Request): Promise<Response> {
  const format = new URL(request.url).searchParams.get("format");
  if (format !== "step" && format !== "stl")
    return NextResponse.json({ error: "Choose STEP or STL export" }, { status: 400 });
  const authorized = await readCadRequest(request);
  if (authorized instanceof Response) return authorized;
  try {
    const model = await compileCadModel(authorized.input, authorized.projectId, request.signal);
    const name = (authorized.input.entryPath ?? "model.py")
      .replace(/\.py$/, "")
      .replace(/[^a-zA-Z0-9_-]+/g, "-");
    return new Response(new Uint8Array(model[format]), {
      headers: {
        "Content-Type": `model/${format}`,
        "Content-Disposition": `attachment; filename="${name}.${format}"`,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch {
    return NextResponse.json(
      {
        error: request.signal.aborted
          ? "CAD export cancelled"
          : "The model could not be exported. Check the Python source and imports.",
      },
      { status: request.signal.aborted ? 499 : 422 },
    );
  }
}
