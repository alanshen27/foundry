import { NextResponse } from "next/server";
import { prisma } from "@foundry/db";
import { pingRedis } from "@/server/chat-run/queue";
import { checkReadiness } from "@/server/readiness";

export const dynamic = "force-dynamic";

/**
 * Readiness: Postgres and Redis reachable. For post-deploy smoke tests and
 * uptime monitors — not Render's healthCheckPath, which stays on /api/health
 * so a database blip does not restart healthy web instances.
 */
export async function GET() {
  const report = await checkReadiness({
    database: () => prisma.$queryRaw`SELECT 1`,
    redis: pingRedis,
  });
  return NextResponse.json(report, {
    status: report.ok ? 200 : 503,
    headers: { "cache-control": "no-store" },
  });
}
