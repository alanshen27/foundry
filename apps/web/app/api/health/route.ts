import { NextResponse } from "next/server";

/** Liveness only — no Auth, DB, or Redis (avoids health-check connection spam). */
export function GET() {
  return NextResponse.json({ ok: true }, { status: 200 });
}
