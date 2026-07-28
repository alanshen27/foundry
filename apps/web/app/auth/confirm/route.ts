import { NextResponse } from "next/server";
import { getServerEnv } from "@foundry/config";
import type { EmailOtpKind } from "@foundry/auth";
import { safeAuthNextPath } from "@/server/auth-redirect";
import { createRequestSupabaseAuth } from "@/server/supabase-auth";
import { upsertSupabaseUser } from "@/server/session";

const OTP_KINDS = new Set<EmailOtpKind>([
  "signup",
  "email",
  "invite",
  "magiclink",
  "recovery",
  "email_change",
]);

function isEmailOtpKind(value: string): value is EmailOtpKind {
  return OTP_KINDS.has(value as EmailOtpKind);
}

/**
 * Custom email-template landing: `token_hash` + `type` from Supabase templates
 * in `supabase/templates/`.
 */
export async function GET(request: Request) {
  const env = getServerEnv();
  const url = new URL(request.url);
  const next = safeAuthNextPath(url.searchParams.get("next"));
  const errorRedirect = new URL("/auth/sign-in", url.origin);
  errorRedirect.searchParams.set("error", "confirm");

  if (env.AUTH_MODE !== "supabase") {
    return NextResponse.redirect(new URL("/auth/sign-in", url.origin));
  }

  const tokenHash = url.searchParams.get("token_hash");
  const typeParam = url.searchParams.get("type") ?? "email";
  if (!tokenHash || !isEmailOtpKind(typeParam)) {
    return NextResponse.redirect(errorRedirect);
  }

  const { auth, pendingCookies } = await createRequestSupabaseAuth();
  const result = await auth.confirmEmailWithToken({ tokenHash, type: typeParam });
  if (!result.ok) {
    errorRedirect.searchParams.set("message", result.error);
    return NextResponse.redirect(errorRedirect);
  }

  await upsertSupabaseUser(result.identity);
  const response = NextResponse.redirect(new URL(next, url.origin));
  for (const cookie of pendingCookies) {
    response.cookies.set(cookie.name, cookie.value, cookie.options as never);
  }
  return response;
}
