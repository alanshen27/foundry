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
 * PKCE / default Supabase redirect landing (`?code=`). Also accepts the
 * custom-template `token_hash` shape so either flow can share this URL.
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

  const { auth, pendingCookies } = await createRequestSupabaseAuth();
  const code = url.searchParams.get("code");
  const tokenHash = url.searchParams.get("token_hash");
  const typeParam = url.searchParams.get("type") ?? "email";

  let result: Awaited<ReturnType<typeof auth.exchangeAuthCode>>;
  if (code) {
    result = await auth.exchangeAuthCode(code);
  } else if (tokenHash && isEmailOtpKind(typeParam)) {
    result = await auth.confirmEmailWithToken({ tokenHash, type: typeParam });
  } else {
    result = { ok: false, error: "Missing confirmation code" };
  }

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
