import "server-only";
import { cookies } from "next/headers";
import { getServerEnv } from "@foundry/config";
import { createSupabaseAuthAdapter, type AuthPort } from "@foundry/auth";

/**
 * AuthPort wired to the current request's cookie jar. Collects Set-Cookie
 * mutations so route handlers can attach them to the response.
 */
export async function createRequestSupabaseAuth(): Promise<{
  auth: AuthPort;
  pendingCookies: { name: string; value: string; options?: Record<string, unknown> }[];
}> {
  const env = getServerEnv();
  const cookieStore = await cookies();
  const pendingCookies: { name: string; value: string; options?: Record<string, unknown> }[] = [];
  const auth = createSupabaseAuthAdapter({
    url: env.NEXT_PUBLIC_SUPABASE_URL!,
    anonKey: env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    cookies: {
      getAll: () => cookieStore.getAll(),
      setAll: (next) => pendingCookies.push(...next),
    },
  });
  return { auth, pendingCookies };
}
