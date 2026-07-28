/**
 * AuthPort: the only auth surface domain/app code may depend on.
 * Implementations: Supabase Auth (production) and LOCAL (dev/e2e only,
 * clearly labeled; see PRD instruction 6).
 */
export type AuthenticatedIdentity = {
  /** Provider-scoped subject: Supabase auth user id or LOCAL user id. */
  subject: string;
  email: string;
  name?: string;
  /** Profile picture URL (e.g. Supabase user_metadata.avatar_url). */
  avatarUrl?: string;
  provider: "supabase" | "local";
};

/**
 * Result of a sign-up attempt. `hasSession` is false when the provider
 * requires email confirmation before a session is issued (Supabase).
 */
export type SignUpResult =
  { ok: true; identity: AuthenticatedIdentity; hasSession: boolean } | { ok: false; error: string };

/** Supabase email OTP kinds we handle in custom confirmation routes. */
export type EmailOtpKind =
  "signup" | "email" | "invite" | "magiclink" | "recovery" | "email_change";

export type ConfirmEmailResult =
  { ok: true; identity: AuthenticatedIdentity } | { ok: false; error: string };

export type SignUpOptions = {
  /** Where Supabase should send the user after they click the email link. */
  emailRedirectTo?: string;
};

export interface AuthPort {
  /** Resolve the identity for the current request, if signed in. */
  getIdentity(): Promise<AuthenticatedIdentity | null>;
  /** Password sign-in. Returns identity or null on bad credentials. */
  signInWithPassword(email: string, password: string): Promise<AuthenticatedIdentity | null>;
  /** Register a new account with email + password. */
  signUpWithPassword(
    email: string,
    password: string,
    name?: string,
    options?: SignUpOptions,
  ): Promise<SignUpResult>;
  /**
   * Exchange a confirmation / magic-link token hash for a session.
   * Used by `/auth/confirm` with custom Supabase email templates.
   */
  confirmEmailWithToken(input: {
    tokenHash: string;
    type: EmailOtpKind;
  }): Promise<ConfirmEmailResult>;
  /**
   * PKCE code exchange after Supabase redirects to `/auth/callback`.
   */
  exchangeAuthCode(code: string): Promise<ConfirmEmailResult>;
  signOut(): Promise<void>;
}
