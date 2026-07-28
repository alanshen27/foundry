# Runbook: custom auth email verification

FOUNDRY uses Supabase Auth for production email confirmation. The app owns the
landing pages and the confirmation exchange; Supabase only delivers mail.

## App routes

| Route            | Purpose                                           |
| ---------------- | ------------------------------------------------- |
| `/auth/confirm`  | Custom template link (`token_hash` + `type`)      |
| `/auth/callback` | PKCE `code` exchange (default Supabase redirect)  |
| `/auth/sign-up`  | Shows “check inbox” when confirmation is required |

Sign-up passes `emailRedirectTo = {APP_ORIGIN}/auth/callback` so the default
Supabase confirmation flow also lands in-app.

## Install the branded templates

1. Supabase Dashboard → Authentication → Email Templates.
2. For **Confirm signup**, paste `supabase/templates/confirmation.html`.
3. For **Magic Link** / **Invite user** (optional), paste
   `supabase/templates/magic-link.html` and adjust the heading copy.
4. Subject line suggestion: `Confirm your FOUNDRY account`.

The templates link to:

```
{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=email&next=/
```

`SiteURL` must be your production `APP_ORIGIN` (the Render web URL or custom
domain). Also allowlist `/auth/confirm` and `/auth/callback` under Auth → URL
Configuration → Redirect URLs.

## Custom SMTP (recommended for production)

Supabase’s built-in mailer is rate-limited. For real traffic, Authentication →
SMTP Settings with Resend / Postmark / SES:

- Sender: `Foundry <auth@yourdomain.com>`
- Host / port / user / password from your provider
- Keep the HTML templates above; only the transport changes

## Local / e2e

`AUTH_MODE=local` never sends email and issues a session immediately. Use
`AUTH_MODE=supabase` against a Supabase project to exercise confirmation.
