import { z } from "zod";
import { createLogger } from "@foundry/observability";
import { clientIp, policies, rateLimit } from "@/server/rate-limit";

/**
 * Receives errors caught in the browser and records them server-side.
 *
 * Browser errors used to exist only in the console of whoever hit them. This
 * relays them into the same logger — and so the same error reporter — as
 * server failures, without shipping a vendor SDK to every client.
 *
 * Unauthenticated on purpose: the sign-in page can crash too. That makes it
 * an open write endpoint, so everything is capped: a small body, truncated
 * fields, and a per-address rate limit that silently drops excess reports.
 */

const MAX_BODY_BYTES = 16_000;

const reportSchema = z.object({
  message: z.string().max(2_000),
  name: z.string().max(200).optional(),
  stack: z.string().max(8_000).optional(),
  digest: z.string().max(200).optional(),
  url: z.string().max(2_000).optional(),
  boundary: z.enum(["segment", "global", "manual"]).default("manual"),
});

const log = createLogger("client");

export async function POST(request: Request) {
  const text = await request.text();
  if (text.length > MAX_BODY_BYTES) return new Response(null, { status: 413 });

  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return new Response(null, { status: 400 });
  }
  const parsed = reportSchema.safeParse(body);
  if (!parsed.success) return new Response(null, { status: 400 });

  // Over the limit, accept and drop: a crashing page must not start seeing
  // failed network requests on top of its original error.
  const limited = await rateLimit(policies().clientErrors, clientIp(request));
  if (!limited.allowed) return new Response(null, { status: 202 });

  const report = parsed.data;
  const err = Object.assign(new Error(report.message), {
    name: report.name ?? "ClientError",
    stack: report.stack,
  });
  log.error("browser error", {
    err,
    boundary: report.boundary,
    digest: report.digest,
    url: report.url,
    userAgent: request.headers.get("user-agent")?.slice(0, 300),
  });
  return new Response(null, { status: 202 });
}
