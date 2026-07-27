# Runbook: local setup

1. Install Node 20+ and pnpm 9+ (`corepack enable`).
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
5. `pnpm db:generate && pnpm db:push && pnpm db:seed`
6. `pnpm dev` and open http://localhost:3000.
7. Sign in with `builder@foundry.local` / `demo-password` (LOCAL mode).

## Troubleshooting

- "Invalid environment configuration" on boot: the zod validator in
  `packages/config` prints exactly which variable is missing.
- Prisma cannot reach the DB: check `docker ps` and that port 5432 is free.
- e2e tests fail immediately: they require `AUTH_MODE=local` and seeded users.
