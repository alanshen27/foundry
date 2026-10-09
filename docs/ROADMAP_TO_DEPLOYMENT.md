# Roadmap to production deployment

Status as of 2026-10-09, written against branch `alan-wip-sync-2026-10-09`
(the owner's latest work in progress) plus the fixes in
`cursor/roadmap-to-deployment-7425`.

Each step is tagged:

- **[done]** — implemented and verified in this branch.
- **[owner]** — needs an account, a secret, a dashboard click, or a decision.
  Exact instructions are included.
- **[later]** — engineering work that is not required for the first
  production deployment but is required before the affected feature is
  advertised.

## 1. Current state

### Target platform: Render + Supabase (confirmed)

The repository targets **Render** for compute and **Supabase** for Postgres,
Auth, Storage, and Realtime, with an external **Redis** (Upstash). That is the
right fit, and this roadmap keeps it:

- The product needs three long-lived processes: the Next.js web app, a
  BullMQ chat/media worker, and a Hocuspocus WebSocket server. It also needs
  headless Chromium for thumbnails and viewport captures. Render runs all of
  these as ordinary containers from one Blueprint (`render.yaml`). A
  serverless host such as Vercel can't run the worker or the WebSocket server,
  and it makes Chromium awkward.
- Supabase is already wired behind typed ports (`AuthPort`,
  `ObjectStoragePort`, `RealtimePort`), and Prisma connects to its Postgres
  directly.
- A production instance already exists on this stack
  (`https://foundry-web-3wiy.onrender.com`, healthy, running an older build),
  so its database was built with `prisma db push` and needs a one-time
  migration baseline (phase 3).

| Component               | Where                                                  | Defined in                                               |
| ----------------------- | ------------------------------------------------------ | -------------------------------------------------------- |
| `foundry-web`           | Render web service (Pro, 4 GB)                         | `render.yaml`                                            |
| `foundry-chat-worker`   | Render background worker (Pro, 4 GB)                   | `render.yaml`                                            |
| `foundry-collab`        | Render web service (Starter)                           | `render.yaml`                                            |
| Postgres                | Supabase (pooled `DATABASE_URL`, session `DIRECT_URL`) | `packages/db`                                            |
| Auth, Storage, Realtime | Supabase                                               | `packages/auth`, `packages/storage`, `packages/realtime` |
| Redis                   | Upstash (`rediss://`)                                  | `REDIS_URL`                                              |
| Errors                  | Sentry (optional)                                      | `SENTRY_DSN`                                             |
| CI                      | GitHub Actions                                         | `.github/workflows/ci.yml`                               |

### What was broken (and is now fixed)

| Problem                                                                                                                                                      | Impact                                                                                                                                                                                                | Fix                                                                                                                               |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| CI on `main` had been red since 2026-09-25, failing at `format:check` before any other step ran                                                              | No signal from lint, types, tests, build, or E2E for two weeks                                                                                                                                        | Formatted the files                                                                                                               |
| `server/routers/chat.ts` called `validateUIMessages` without importing it                                                                                    | `next build` type-checks, so **Render builds of this branch would fail**; at runtime, Stop on a running copilot turn would throw                                                                      | Uses the already-imported `validateResumableUIMessages`, which also repairs interrupted tool parts                                |
| `CollaborationDocument` existed only as hand-run SQL (`prisma/changes/20260911-collaboration.sql`), not as a Prisma migration                                | `migrate deploy` produced a database missing the table every engineering editor writes to; CI's drift check failed                                                                                    | Added the idempotent migration `20260923000000_collaboration_document`, which is safe whether or not the hand SQL was already run |
| No row-level security on any table                                                                                                                           | Supabase serves the `public` schema through its Data API to the browser-visible anon key, so every table (users, sessions, chat, checkout configuration) was probably readable and writable by anyone | Migration `20260924000000_enable_row_level_security`, plus a CI guard (`pnpm db:rls:check`)                                       |
| Building a linked assembly with out-of-date boards returned "Add a manufacturing part" (400) instead of "Update CAD from boards" (409)                       | Misleading error, and a failing router test                                                                                                                                                           | The stale-board check now runs before pre-lock seating                                                                            |
| Stale tests: the CAD viewport unit test still exercised the removed Zoo WebRTC session; the E2E drove the KCL demo, which the viewport now refuses by design | Red test suite                                                                                                                                                                                        | Rewritten against the Three.js/build123d path                                                                                     |
| Env validation allowed `AUTH_MODE=local`, a missing `AUTH_SECRET`, or a missing or localhost `APP_ORIGIN` on Render                                          | Local auth in production; collaboration tokens signed with the database URL; worker screenshots and auth email links pointed at `localhost:3000`                                                      | `packages/config` now fails at boot on Render and names each bad variable (with tests)                                            |
| Migrations were never applied by deploys                                                                                                                     | A deploy that ships new models boots, then fails with `P2021`                                                                                                                                         | Every service runs `pnpm db:migrate:deploy` as its `preDeployCommand`                                                             |
| `foundry-collab` had no health check, and its build filter missed `packages/domain` and `packages/observability`                                             | Bad collab deploys went live; shared-code changes skipped collab, causing version skew                                                                                                                | `healthCheckPath: /` and a complete build filter                                                                                  |
| No readiness signal                                                                                                                                          | The only way to check DB/Redis connectivity was to use the app                                                                                                                                        | `GET /api/ready` returns 200 or 503 with per-dependency status, without leaking error details                                     |
| `OPENROUTER_API_KEY` was documented but missing from the Blueprint                                                                                           | Jev triage could not be configured from Render                                                                                                                                                        | Added to `foundry-shared`                                                                                                         |

### Verified CI-equivalent results on this branch

`pnpm install --frozen-lockfile`, `db:generate`, `format:check`, `lint`
(warnings only), `typecheck`, `db:migrate:deploy`, `db:migrate:check`,
`db:rls:check`, `db:seed`, `test` (all packages), and `build` all pass against
Postgres 16 and Redis 7. E2E status is in the PR description.

### Known product limitation

**Native CAD evaluation does not run on Render.** Python/build123d geometry
runs only inside the macOS OS sandbox (`packages/cad/src/build123d.ts`). On
Linux it fails closed by design (`docs/runbooks/native-python-cad.md`). On the
hosted deployment, CAD source editing, AI generation, imported STL/GLB, and
everything outside mechanical CAD work, but building new Python parts,
assemblies, fit checks, and STEP export do not. Phase 7 covers the options.
Do not "fix" this by running generated Python unsandboxed on a Render host.

## 2. Ordered checklist

Order matters in phases 3–5: **baseline the production database before
merging to `main`**, because Render auto-deploys `main` and the new
pre-deploy migration step fails against an unbaselined `db push` database.
A failed pre-deploy cancels the deploy and the old build keeps serving, so the
failure is safe, but nothing new ships until the baseline is done.

### Phase 1 — Green build and CI **[done]**

- [x] Install, format, lint, typecheck, unit/router tests, and production build pass.
- [x] Migration history builds the full schema; drift check passes.
- [x] CI also asserts row-level security on every table.
- [x] **[owner]** After this PR merges, protect `main`: GitHub → Settings →
      Branches → Add rule for `main` → require the `checks` status check and
      require pull requests. This keeps CI from going red unnoticed again.

### Phase 2 — Deploy configuration and runtime safety **[done]**

- [x] Pre-deploy migrations on all three services (Prisma advisory lock makes
      concurrent runs safe).
- [x] Health checks: web `/api/health` (liveness), collab `/`. `/api/ready`
      is for smoke tests and uptime monitors.
- [x] Production env guards in `packages/config`.
- [x] Collab build filter covers its full workspace dependency set.

### Phase 3 — Baseline the production database **[owner, before merging]**

The production database was built with `db push`, so it has no
`_prisma_migrations` table. Do this once, from a trusted machine with this
branch checked out and `pnpm install` done. Use the Supabase **session
pooler** URL (port 5432) for both variables: Supabase → Project Settings →
Database → Connection string → "Session pooler".

```bash
export DIRECT_URL='postgresql://postgres.<ref>:<password>@aws-0-<region>.pooler.supabase.com:5432/postgres'
export DATABASE_URL="$DIRECT_URL"

# 0. Take a backup first: Supabase → Database → Backups (or pg_dump "$DIRECT_URL" > foundry-$(date +%F).sql).

# 1. Read-only: prints the exact resolve commands for what db push already created.
pnpm db:baseline:plan

# 2. Run the printed `prisma migrate resolve --applied …` lines (they only write history rows).

# 3. Apply what is genuinely missing (graph proposals, collaboration document, RLS).
pnpm db:migrate:deploy

# 4. Both must succeed.
pnpm db:migrate:check   # "No difference detected."
pnpm db:rls:check       # "Every public table has row-level security enabled."
```

If `db:migrate:deploy` fails partway, read the error before retrying; `prisma
migrate resolve --rolled-back <name>` clears a failed record once the cause is
fixed. Never run `prisma migrate dev`, `migrate reset`, or `db push` against
production.

### Phase 4 — Supabase hardening **[owner]**

1. **Confirm the Data API exposure is closed.** After phase 3, open Supabase →
   Advisors → Security Advisor. There should be no "RLS disabled in public"
   findings. Because the tables were exposed before this change, review
   Supabase → Logs → API for unexpected `/rest/v1/` traffic. If you find any,
   rotate the keys (Project Settings → API → roll the anon and service-role
   keys) and update the `foundry-shared` group on Render.
2. **Optional, stronger:** the app never uses the Data API for tables, so you
   can remove `public` from Project Settings → API → "Exposed schemas"
   entirely. Auth, Storage, and Realtime are unaffected.
3. **Storage:** Storage → New bucket → name `artifacts`, **Private** (skip if it
   already exists).
4. **Auth URL configuration:** Authentication → URL Configuration → Site URL =
   your `APP_ORIGIN`. Redirect URLs: `APP_ORIGIN/auth/confirm` and
   `APP_ORIGIN/auth/callback`.
5. **Email:** paste `supabase/templates/confirmation.html` and
   `magic-link.html` into Authentication → Email Templates, and configure
   custom SMTP (see `docs/runbooks/auth-email.md`). The built-in sender is
   heavily rate-limited and not meant for production.

### Phase 5 — Render configuration and first deploy **[owner]**

1. **Redis:** create an Upstash Redis database (regional, same region as
   Render `oregon` → `us-west-1`/`us-west-2`) and copy the `rediss://` URL.
2. **Blueprint:** Render → Blueprints. If the existing Blueprint is linked to
   this repo, open it and click **Manual sync** after merging. Otherwise use
   **New Blueprint Instance**, select this repository, and use `render.yaml`.
3. **`foundry-shared` env group** (Render → Environment Groups). Every
   `sync: false` key needs a value:

   | Key                                                                          | Value                                                                                                        |
   | ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
   | `APP_ORIGIN`                                                                 | `https://foundry-web-3wiy.onrender.com` (or your custom domain), no trailing slash. **Required.**            |
   | `DATABASE_URL`                                                               | Supabase **transaction pooler** URL (port 6543) with `?pgbouncer=true`                                       |
   | `DIRECT_URL`                                                                 | Supabase **session pooler** URL (port 5432), used by migrations                                              |
   | `REDIS_URL`                                                                  | Upstash `rediss://…` URL. **Required.**                                                                      |
   | `NEXT_PUBLIC_SUPABASE_URL`                                                   | `https://<ref>.supabase.co`                                                                                  |
   | `NEXT_PUBLIC_SUPABASE_ANON_KEY`                                              | Project Settings → API → anon key                                                                            |
   | `SUPABASE_SERVICE_ROLE_KEY`                                                  | Project Settings → API → service-role key (secret)                                                           |
   | `NEXT_PUBLIC_COLLAB_URL`                                                     | `wss://<foundry-collab host>.onrender.com`                                                                   |
   | `OPENAI_API_KEY`                                                             | Needed for copilot, CAD generation, and image media. The account needs access to `gpt-5.6` and `gpt-6-astra` |
   | `OPENROUTER_API_KEY`                                                         | Optional. Jev triage for messages without `@AI`                                                              |
   | `V0_API_KEY`                                                                 | Optional. Without it, Sites is SIMULATED and cannot publish                                                  |
   | `MEDIA_VIDEO_MODEL`                                                          | Optional. Without it, video generation refuses                                                               |
   | `SENTRY_DSN`                                                                 | Recommended. Without it, errors are only logged                                                              |
   | `AI_WORKSPACE_DAILY_TOKEN_BUDGET`                                            | **Set before sharing any public link**, e.g. `2000000`                                                       |
   | `AI_RUNS_PER_HOUR`, `AI_MAX_OUTPUT_TOKENS`, `FOUNDRY_DEFAULT_WORKSPACE_SLUG` | Optional                                                                                                     |

   `AUTH_SECRET` is generated by the Blueprint. Do not change it after launch:
   it signs collaboration tokens and is shared by all three services.
   `ZOO_API_TOKEN` is unused and can stay empty.

4. **Deploy:** merge the PR to `main`. Render builds all three services, runs
   `pnpm db:migrate:deploy` pre-deploy (a no-op after phase 3), then starts
   them. If a service fails to boot with `Invalid environment configuration`,
   the log lists each variable to fix.
5. **Smoke test:**

   ```bash
   curl -fsS https://<APP_ORIGIN host>/api/health   # {"ok":true}
   curl -fsS https://<APP_ORIGIN host>/api/ready    # {"ok":true,"checks":{"database":"ok","redis":"ok"}}
   curl -fsS https://<foundry-collab host>/         # OK
   ```

   Then in a browser: sign up (the confirmation email arrives and its link
   lands back on `APP_ORIGIN`), create a workspace and project, edit a code
   file in two tabs (live cursors mean collab works), send an `@AI` chat
   message (the worker logs a job), and upload an artifact (Storage works).

### Phase 6 — Domain and monitoring **[owner, optional]**

1. **Custom domain:** Render → `foundry-web` → Settings → Custom Domains → add
   e.g. `app.example.com`. At your DNS provider, create a `CNAME` from `app`
   to `foundry-web-3wiy.onrender.com` (for an apex domain, use the `A` or
   `ALIAS` record Render shows on that page). Wait for Render to issue the
   certificate, then update `APP_ORIGIN`, Supabase Site URL, and redirect URLs
   (phase 4, step 4) to the new origin and redeploy. Do the same for collab
   if you want `wss://collab.example.com`, then update
   `NEXT_PUBLIC_COLLAB_URL` and **rebuild** web (`NEXT_PUBLIC_*` values are
   baked in at build time).
2. **Uptime:** point an uptime monitor (Better Stack, UptimeRobot, etc.) at
   `/api/ready` with a 1–5 minute interval.
3. **Backups:** confirm the Supabase plan includes daily backups, or enable
   PITR before onboarding real users.

### Phase 7 — Hosted CAD evaluation **[later, decision needed]**

Pick one before advertising mechanical CAD on the hosted app:

- **A. macOS CAD worker** (smallest change, matches the current sandbox):
  run the existing worker on a dedicated Mac (e.g. MacStadium or a Mac mini)
  against production Redis and Postgres. The runbook already notes the hosted
  queue consumer must stay paused while a local Mac owns that queue.
- **B. Isolated Linux worker** (the documented long-term plan): a separate
  service that runs build123d under gVisor, Firecracker, or nsjail, with the
  same limits as the macOS sandbox (no network, no credentials, CPU, memory,
  and output caps). This is security-critical new code and needs its own
  review.
- **C. Ship without hosted CAD evaluation** and label the CAD panel
  accordingly. It already fails closed with an explanatory error.

### Phase 8 — Follow-ups **[later]**

- E2E runs against `next dev`, which compiles each route on first visit and
  is slow on CI runners. Running it against `next build && next start` would
  make it faster and would also exercise the production bundle.
- 17 `no-explicit-any` lint warnings in tests.
- If Chromium ever fails with `libnss3.so` errors on Render's native runtime,
  move web and worker to a Docker runtime based on
  `mcr.microsoft.com/playwright` (see `deploy-render.md`).
