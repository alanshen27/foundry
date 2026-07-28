import { createHash, createHmac, timingSafeEqual } from "node:crypto";

const TTL_MS = 60 * 60 * 1000;

export type CollabRoomKind = "codefile" | "siteprompt";

export type CollabClaims = {
  kind: CollabRoomKind;
  /** CodeFile id or Site id, matching the room suffix. */
  resourceId: string;
  userId: string;
  name: string;
  avatarUrl?: string | null;
  canEdit: boolean;
  exp: number;
};

function secretBuffer(secretMaterial: string): Buffer {
  return createHash("sha256").update(`foundry-collab:${secretMaterial}`).digest();
}

function sign(payload: string, secretMaterial: string): string {
  return createHmac("sha256", secretBuffer(secretMaterial)).update(payload).digest("base64url");
}

export function mintCollabToken(
  claims: Omit<CollabClaims, "exp">,
  secretMaterial: string,
  ttlMs: number = TTL_MS,
): string {
  const payload = Buffer.from(
    JSON.stringify({ ...claims, exp: Date.now() + ttlMs } satisfies CollabClaims),
  ).toString("base64url");
  return `${payload}.${sign(payload, secretMaterial)}`;
}

export function verifyCollabToken(token: string, secretMaterial: string): CollabClaims | null {
  const [payload, mac] = token.split(".");
  if (!payload || !mac) return null;
  const expected = sign(payload, secretMaterial);
  const got = Buffer.from(mac);
  const want = Buffer.from(expected);
  if (got.length !== want.length || !timingSafeEqual(got, want)) return null;
  try {
    const claims = JSON.parse(Buffer.from(payload, "base64url").toString()) as CollabClaims;
    if (typeof claims.exp !== "number" || claims.exp < Date.now()) return null;
    if (
      (claims.kind !== "codefile" && claims.kind !== "siteprompt") ||
      !claims.resourceId ||
      !claims.userId ||
      !claims.name
    ) {
      return null;
    }
    return claims;
  } catch {
    return null;
  }
}
