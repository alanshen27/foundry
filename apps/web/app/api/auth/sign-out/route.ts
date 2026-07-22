import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getServerEnv } from "@foundry/config";
import { createSupabaseAuthAdapter, LOCAL_SESSION_COOKIE } from "@foundry/auth";

export async function POST(request: Request) {
  const env = getServerEnv();
  const response = NextResponse.redirect(new URL("/", request.url), { status: 303 });

  if (env.AUTH_MODE === "local") {
    response.cookies.delete(LOCAL_SESSION_COOKIE);
    return response;
  }

  const cookieStore = await cookies();
  const auth = createSupabaseAuthAdapter({
    url: env.NEXT_PUBLIC_SUPABASE_URL!,
    anonKey: env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    cookies: {
      getAll: () => cookieStore.getAll(),
      setAll: (cookies) => {
        for (const cookie of cookies) {
          response.cookies.set(cookie.name, cookie.value, cookie.options as never);
        }
      },
    },
  });
  await auth.signOut();
  return response;
}
