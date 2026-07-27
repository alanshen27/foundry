import "server-only";
import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { getServerEnv } from "@foundry/config";

/**
 * Short-lived signed tokens that let the copilot's headless browser open the
 * /render/* pages without a user session. The secret is derived from server
 * env (never sent anywhere) so it is identical across dev bundles/workers —
 * a per-module random secret breaks in Next dev, where API routes and pages
 * compile into separate module instances.
 */

let secret: Buffer | undefined;
function getSecret(): Buffer {
  if (!secret) {
    const env = getServerEnv();
    secret = createHash("sha256")
      .update(`foundry-render:${env.AUTH_SECRET ?? env.DATABASE_URL}`)
      .digest();
  }
  return secret;
}

const TTL_MS = 5 * 60 * 1000;

export type RenderClaims = {
  projectId: string;
  branchId: string;
  kind: "model3d" | "circuit" | "pcb";
  exp: number;
};

function sign(payload: string): string {
  return createHmac("sha256", getSecret()).update(payload).digest("base64url");
}

export function mintRenderToken(claims: Omit<RenderClaims, "exp">): string {
  const payload = Buffer.from(
    JSON.stringify({ ...claims, exp: Date.now() + TTL_MS } satisfies RenderClaims),
  ).toString("base64url");
  return `${payload}.${sign(payload)}`;
}

export function verifyRenderToken(token: string): RenderClaims | null {
  const [payload, mac] = token.split(".");
  if (!payload || !mac) return null;
  const expected = sign(payload);
  const got = Buffer.from(mac);
  const want = Buffer.from(expected);
  if (got.length !== want.length || !timingSafeEqual(got, want)) return null;
  try {
    const claims = JSON.parse(Buffer.from(payload, "base64url").toString()) as RenderClaims;
    if (claims.exp < Date.now()) return null;
    return claims;
  } catch {
    return null;
  }
}
