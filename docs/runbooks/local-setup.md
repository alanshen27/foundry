# Runbook: local setup

1. Install Node 22 and pnpm 9 (`corepack enable`).
2. `pnpm install`
3. Database — choose one:
   - Local: `docker compose -f infra/local/docker-compose.yml up -d`
   - Supabase: create a project, copy the connection string into
     `DATABASE_URL` (use the "session" pooler string for Prisma).
4. `cp .env.example .env`. Fill `NEXT_PUBLIC_SUPABASE_URL`,
   `NEXT_PUBLIC_SUPABASE_ANON_KEY`, and `SUPABASE_SERVICE_ROLE_KEY` (object
   storage always uses Supabase Storage — create a private `artifacts`
   bucket). Set `AUTH_MODE=supabase` for Supabase Auth, or keep
   `AUTH_MODE=local` for the LOCAL credentials adapter. For presence set
   `NEXT_PUBLIC_REALTIME_MODE=supabase`.
5. Run `pnpm db:generate`, `pnpm db:migrate:deploy`, and `pnpm db:seed`.
   The seed includes the **Environmental Monitor** project used to demo the
   product graph (Engineer > Sourcing > the branch icon on the battery row).

   **Keep local work off production.** If `.env` holds production credentials,
   put local overrides in `.env.local` — `db:*` scripts and the dev server
   read it first. Without Docker, a Homebrew Postgres works:
   `brew install postgresql@16 && brew services start postgresql@16`, then
   create a `foundry` role and database and point `DATABASE_URL` /
   `DIRECT_URL` at `postgresql://foundry:foundry@localhost:5432/foundry`.
   Local `AUTH_MODE=local` still needs placeholder Supabase values
   (`http://localhost:54321` and any non-empty keys), as CI uses.

   **Changing the schema:** edit `schema.prisma`, then
   `pnpm db:migrate --name <change>` to generate a migration. CI rebuilds the
   database from migrations and fails if `schema.prisma` has drifted from
   them. `pnpm db:push` still works for throwaway experiments, but never
   commit a schema change without its migration.

6. `pnpm dev` and open http://localhost:3000.
7. Sign in with `builder@foundry.local` / `demo-password` (LOCAL mode).

Production deploy + branded confirmation email: see `deploy-render.md` and
`auth-email.md`.

## Troubleshooting

- "Invalid environment configuration" on boot: the zod validator in
  `packages/config` prints exactly which variable is missing.
- Prisma cannot reach the DB: check `docker ps` and that port 5432 is free.
- e2e tests fail immediately: they require `AUTH_MODE=local` and seeded users.
