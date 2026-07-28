/**
 * Supabase Auth adapter. Cookie-based SSR sessions via @supabase/ssr.
 * The web app supplies cookie accessors so this package stays framework-thin.
 */
import { createServerClient } from "@supabase/ssr";
import type {
  AuthenticatedIdentity,
  AuthPort,
  ConfirmEmailResult,
  EmailOtpKind,
  SignUpOptions,
  SignUpResult,
} from "./port";

export type CookieAccessor = {
  getAll(): { name: string; value: string }[];
  setAll(cookies: { name: string; value: string; options?: Record<string, unknown> }[]): void;
};

export type SupabaseAuthConfig = {
  url: string;
  anonKey: string;
  cookies: CookieAccessor;
};

type UserLike = {
  id: string;
  email?: string | null;
  user_metadata?: Record<string, unknown> | null;
};

/** Short TTL so chat.activeRun polling doesn't hammer Supabase Auth (429). */
const IDENTITY_CACHE_MS = 45_000;
const identityCache = new Map<string, { identity: AuthenticatedIdentity; exp: number }>();

function identityFromUser(user: UserLike): AuthenticatedIdentity | null {
  if (!user.email) return null;
  return {
    subject: user.id,
    email: user.email,
    name: (user.user_metadata?.name as string | undefined) ?? undefined,
    avatarUrl:
      (user.user_metadata?.avatar_url as string | undefined) ??
      (user.user_metadata?.picture as string | undefined) ??
      undefined,
    provider: "supabase",
  };
}

function confirmFromUser(
  user: UserLike | null | undefined,
  errorMessage: string,
): ConfirmEmailResult {
  const identity = user ? identityFromUser(user) : null;
  if (!identity) return { ok: false, error: errorMessage };
  return { ok: true, identity };
}

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
      const { data: sessionData } = await client.auth.getSession();
      const accessToken = sessionData.session?.access_token ?? "";
      if (accessToken) {
        const hit = identityCache.get(accessToken);
        if (hit && hit.exp > Date.now()) return hit.identity;
      }

      const { data, error } = await client.auth.getUser();
      if (error) {
        // Rate-limited / transient Auth API failures: fall back to the JWT session
        // so high-frequency tRPC polls don't flap 401 forever.
        const status = "status" in error ? Number(error.status) : 0;
        if (status === 429 && sessionData.session?.user) {
          return identityFromUser(sessionData.session.user);
        }
        return null;
      }
      const identity = data.user ? identityFromUser(data.user) : null;
      if (identity && accessToken) {
        identityCache.set(accessToken, { identity, exp: Date.now() + IDENTITY_CACHE_MS });
      }
      return identity;
    },

    async signInWithPassword(email, password): Promise<AuthenticatedIdentity | null> {
      const { data, error } = await client.auth.signInWithPassword({ email, password });
      if (error || !data.user?.email) return null;
      return { subject: data.user.id, email: data.user.email, provider: "supabase" };
    },

    async signUpWithPassword(
      email,
      password,
      name?,
      options?: SignUpOptions,
    ): Promise<SignUpResult> {
      const { data, error } = await client.auth.signUp({
        email,
        password,
        options: {
          ...(name ? { data: { name } } : {}),
          ...(options?.emailRedirectTo ? { emailRedirectTo: options.emailRedirectTo } : {}),
        },
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

    async confirmEmailWithToken(input: {
      tokenHash: string;
      type: EmailOtpKind;
    }): Promise<ConfirmEmailResult> {
      const { data, error } = await client.auth.verifyOtp({
        token_hash: input.tokenHash,
        type: input.type,
      });
      if (error) return { ok: false, error: error.message };
      return confirmFromUser(data.user, "Confirmation succeeded but no user was returned");
    },

    async exchangeAuthCode(code: string): Promise<ConfirmEmailResult> {
      const { data, error } = await client.auth.exchangeCodeForSession(code);
      if (error) return { ok: false, error: error.message };
      return confirmFromUser(data.user, "Code exchange succeeded but no user was returned");
    },

    async signOut(): Promise<void> {
      await client.auth.signOut();
    },
  };
}
