/**
 * Supabase Auth adapter. Cookie-based SSR sessions via @supabase/ssr.
 * The web app supplies cookie accessors so this package stays framework-thin.
 */
import { createServerClient } from "@supabase/ssr";
import type { AuthenticatedIdentity, AuthPort, SignUpResult } from "./port";

export type CookieAccessor = {
  getAll(): { name: string; value: string }[];
  setAll(cookies: { name: string; value: string; options?: Record<string, unknown> }[]): void;
};

export type SupabaseAuthConfig = {
  url: string;
  anonKey: string;
  cookies: CookieAccessor;
};

export function createSupabaseAuthAdapter(config: SupabaseAuthConfig): AuthPort {
  const client = createServerClient(config.url, config.anonKey, {
    cookies: {
      getAll: () => config.cookies.getAll(),
      setAll: (cookies: { name: string; value: string; options?: Record<string, unknown> }[]) =>
        config.cookies.setAll(cookies),
    },
  });

  return {
    async getIdentity(): Promise<AuthenticatedIdentity | null> {
      const { data } = await client.auth.getUser();
      if (!data.user?.email) return null;
      return {
        subject: data.user.id,
        email: data.user.email,
        name: (data.user.user_metadata?.name as string | undefined) ?? undefined,
        provider: "supabase",
      };
    },

    async signInWithPassword(email, password): Promise<AuthenticatedIdentity | null> {
      const { data, error } = await client.auth.signInWithPassword({ email, password });
      if (error || !data.user?.email) return null;
      return { subject: data.user.id, email: data.user.email, provider: "supabase" };
    },

    async signUpWithPassword(email, password, name): Promise<SignUpResult> {
      const { data, error } = await client.auth.signUp({
        email,
        password,
        options: name ? { data: { name } } : undefined,
      });
      if (error || !data.user?.email) {
        return { ok: false, error: error?.message ?? "Sign-up failed" };
      }
      return {
        ok: true,
        identity: {
          subject: data.user.id,
          email: data.user.email,
          name,
          provider: "supabase",
        },
        // Supabase omits a session when email confirmation is required.
        hasSession: Boolean(data.session),
      };
    },

    async signOut(): Promise<void> {
      await client.auth.signOut();
    },
  };
}
