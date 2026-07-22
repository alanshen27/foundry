/**
 * LOCAL auth primitives (dev/e2e only). Password hashing via scrypt and
 * stateless HMAC-signed session tokens. Never enable in production.
 */
import { createHmac, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

export const LOCAL_SESSION_COOKIE = "foundry_local_session";

export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${hash}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [salt, expected] = stored.split(":");
  if (!salt || !expected) return false;
  const actual = scryptSync(password, salt, 64);
  const expectedBuf = Buffer.from(expected, "hex");
  return actual.length === expectedBuf.length && timingSafeEqual(actual, expectedBuf);
}

type SessionPayload = { userId: string; email: string; exp: number };

function sign(data: string, secret: string): string {
  return createHmac("sha256", secret).update(data).digest("base64url");
}

export function createSessionToken(
  userId: string,
  email: string,
  secret: string,
  ttlMs = 1000 * 60 * 60 * 24 * 7,
): string {
  const payload: SessionPayload = { userId, email, exp: Date.now() + ttlMs };
  const data = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${data}.${sign(data, secret)}`;
}

export function verifySessionToken(token: string, secret: string): SessionPayload | null {
  const [data, signature] = token.split(".");
  if (!data || !signature) return null;
  const expected = sign(data, secret);
  const sigBuf = Buffer.from(signature);
  const expBuf = Buffer.from(expected);
  if (sigBuf.length !== expBuf.length || !timingSafeEqual(sigBuf, expBuf)) return null;
  try {
    const payload = JSON.parse(Buffer.from(data, "base64url").toString()) as SessionPayload;
    if (typeof payload.exp !== "number" || payload.exp < Date.now()) return null;
    if (typeof payload.userId !== "string" || typeof payload.email !== "string") return null;
    return payload;
  } catch {
    return null;
  }
}
