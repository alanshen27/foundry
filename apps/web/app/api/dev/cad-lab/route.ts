import { NextResponse } from "next/server";

/** No diagnostics escape hatch to paid Zoo requests. */
export async function POST() {
  return NextResponse.json(
    {
      ok: false,
      error:
        "Zoo diagnostics are retired. Use the Python/build123d CAD editor and its local preview/export tools.",
    },
    { status: 410 },
  );
}
