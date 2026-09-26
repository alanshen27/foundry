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

## Mechanical CAD

Set `OPENAI_API_KEY` for Astra Python generation (`CAD_MODEL=gpt-6-astra`).
Install `uv` on the Mac running the web app and chat worker, and put it on their PATH.
Prewarm the pinned runtime with:

```sh
uv run --no-project --python 3.12 --with build123d==0.9.1 --with ocpsvg==0.5.0 python -c "import build123d"
```

Geometry is evaluated inside a macOS sandbox, with exact STEP and viewport STL
exports. Zoo is disabled and no token is required. Other operating systems fail
closed until a restricted CAD worker is deployed. Missing OpenAI credentials disable
AI generation but do not disable native source editing and geometry evaluation.
See [native Python CAD](native-python-cad.md) for migration and execution limits.

## Connected engineering and collaboration

Before updating an existing database, apply the additive SQL in
`packages/db/prisma/changes/20260911-collaboration.sql` through your normal
database deployment process. New local databases get this table with `pnpm db:push`.
The table is required even if `NEXT_PUBLIC_COLLAB_URL` is unset. Web, chat worker,
and Hocuspocus must use the same database, Redis instance, and `AUTH_SECRET`.
Set `NEXT_PUBLIC_COLLAB_URL=ws://localhost:1234` for live editing.
See [the workflow runbook](connected-engineering.md) for behavior and checks.

## Troubleshooting

- Local chat uses the BullMQ queue `chat-runs`. If local and hosted services
  share Redis and Postgres, a hosted worker can take a localhost request. Keep
  every connected worker on the same code version. Separate both Redis and
  Postgres for independent development environments: changing only the queue
  is insufficient because orphan recovery scans the shared database.
- Worker startup logs and BullMQ's `processedBy` field include
  `foundry-chat-stream-v3-local-<pid>` or `foundry-chat-stream-v3-render-<pid>`.
  Use that identity to confirm which worker handled a run. Restarting an old
  hosted deployment does not update its code; deploy the fixed version first.
- Stream updates are persisted in short ordered batches for SSE replay. CAD draft
  snapshots may be coalesced while queued; tool results and source deltas remain
  ordered. Per-token Supabase broadcasts are not used. Collaborative SQL/Yjs saves
  share a finite 60-second transaction budget to include branch-lock contention
  and hosted-database round trips.
- "Invalid environment configuration" on boot: the zod validator in
  `packages/config` prints exactly which variable is missing.
- Prisma cannot reach the DB: check `docker ps` and that port 5432 is free.
- e2e tests fail immediately: they require `AUTH_MODE=local` and seeded users.
