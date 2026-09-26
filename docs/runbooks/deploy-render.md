# Runbook: deploy on Render

FOUNDRY ships a Render Blueprint at the repo root (`render.yaml`). Postgres,
Auth, and object storage stay on Supabase; Redis is your own (e.g. Upstash).
Render runs the web app, chat worker, and collaboration WebSocket service.

Shared secrets live in the **`foundry-shared`** environment group (linked to
every service). There are no per-service env vars beyond that link.

## One-shot setup

1. Push this branch to GitHub.
2. Open [Render Blueprint](https://dashboard.render.com/blueprint/new) and
   point it at the repo (file: `render.yaml`).
3. Fill every prompted (`sync: false`) secret in **foundry-shared**:
   - `APP_ORIGIN` — public web URL (`https://foundry-web-….onrender.com`)
   - `DATABASE_URL` / `DIRECT_URL` — Supabase Postgres (session/direct for DDL)
   - `REDIS_URL` — **required** Upstash `rediss://…` (TLS). If unset, the app
     defaults to `localhost:6379` and Render logs endless `ECONNREFUSED` /
     `AggregateError` until the service is SIGTERM'd.
   - `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`,
     `SUPABASE_SERVICE_ROLE_KEY`
   - `NEXT_PUBLIC_COLLAB_URL` — `wss://<foundry-collab hostname>`
   - Optional: `OPENAI_API_KEY`, `ZOO_API_TOKEN`, `V0_API_KEY`,
     `FOUNDRY_DEFAULT_WORKSPACE_SLUG`
4. Apply schema against production Postgres (`pnpm db:push` locally with
   production `DIRECT_URL`, or run Prisma from a one-off shell).
5. Create the private Supabase Storage bucket named `artifacts`.
6. Configure custom auth email (see `docs/runbooks/auth-email.md`).

For CAD generation, configure `OPENAI_API_KEY` with access to GPT-6 Astra. The
blueprint sets `CAD_MODEL=gpt-6-astra` for both the web and chat worker services.
Zoo is disabled; no token is needed. Native Python evaluation currently requires
the restricted macOS worker. The Render/Linux services cannot evaluate new CAD
until a separately isolated worker is implemented. Keep the hosted queue consumer
paused while the local Mac owns that queue; do not run generated Python directly
on a hosted web process. See `native-python-cad.md` for the runtime boundary.

## Services

| Service               | Role                                |
| --------------------- | ----------------------------------- |
| `foundry-web`         | Next.js App Router (`@foundry/web`) |
| `foundry-chat-worker` | BullMQ worker for AI chat runs      |
| `foundry-collab`      | Hocuspocus Yjs WebSocket server     |

`APP_ORIGIN` is set in `foundry-shared` to the public web URL. Auth email
redirects and screenshot tools both use it. `AUTH_SECRET` is generated once in
`foundry-shared` so web / worker / collab share the same value.

## Build notes

- Do **not** run `corepack enable` in build commands — Render's Node image
  ships pnpm on a read-only `/usr/bin`; enable fails with `EROFS`.
- Install uses `pnpm install --frozen-lockfile --prod=false` so Prisma and
  other devDependencies are present during `prisma generate` / `next build`.
- `package.json` `engines.node` is `22.x` (plus `.node-version`) so Render
  does not pick an unbounded latest Node.

### Chromium / Playwright

`foundry-web` and `foundry-chat-worker` both launch headless Chromium — the web
service for `/render/*` thumbnails, the worker for the copilot's viewport
captures and `extract_product_images`. Nothing downloads a browser implicitly:
the app depends on `playwright-core`, which never bundles binaries, and current
Playwright releases carry no postinstall hook, so `pnpm install` alone leaves
the machine browserless. Each build therefore fetches one explicitly:

```
pnpm --filter @foundry/web exec playwright install --only-shell chromium
```

Two things make this work, and both are load-bearing:

- **`PLAYWRIGHT_BROWSERS_PATH=/opt/render/project/src/.playwright`** (set in
  `foundry-shared`). Render only carries the project directory from the build
  into the runtime container. Playwright's default `$HOME/.cache/ms-playwright`
  resolves to `/opt/render/.cache/…`, which is downloaded during the build and
  then absent at start — the failure looks like
  `Executable doesn't exist at /opt/render/.cache/ms-playwright/…`.
- **`--only-shell`**, because `server/ai/render.ts` always launches
  `headless: true`. Playwright ≥1.49 maps that to `chromium-headless-shell`,
  a separate download from headful `chromium`.

Keep `playwright-core` and `@playwright/test` on the same version — the browser
revision is pinned per Playwright version, so a mismatch reinstates the same
"executable doesn't exist" error against a different revision directory.

Chromium runs fine on Render's native Node runtime (it is a normal long-lived
container, not a serverless sandbox), but the binary is ~170MB and a capture
spikes several hundred MB of RSS. `--with-deps` is not usable here — it needs
root, which build commands do not have. If a launch ever fails with
`error while loading shared libraries: libnss3.so` rather than a missing
executable, the native image is short a system library and the service needs
to move to a Docker runtime built on `mcr.microsoft.com/playwright`.

## Schema changes are not applied by the deploy

`render.yaml` builds with `db generate` and `next build` — it runs **no DDL**.
A deploy that ships new Prisma models boots fine and then fails with `P2021`
(table does not exist) on the first query that touches them.

Schema changes now ship as Prisma migrations in
`packages/db/prisma/migrations/`. Apply them against the session-pooler URL
**before** the web and worker services pick up the new code:

```bash
DIRECT_URL="postgresql://…:5432/postgres" pnpm db:migrate:deploy
```

`migrate deploy` only runs migrations that have not been applied and never
resets or prompts. Never run `prisma migrate dev` or `migrate reset` against
production — those are the commands that offer to drop the database.

### One-time: baseline production

Production was built with `db push`, so it has no migration history yet and
`migrate deploy` would try to recreate tables that already exist. Once, before
the first `migrate deploy`:

```bash
# Production already matches 0_init (everything up to the product graph).
DIRECT_URL="…" pnpm --filter @foundry/db exec dotenv -e ../../.env -- \
  prisma migrate resolve --applied 0_init

# Check what is still pending — expect exactly the product graph migration.
DIRECT_URL="…" pnpm db:migrate:status

# Apply it.
DIRECT_URL="…" pnpm db:migrate:deploy
```

If someone already ran `db:push` with the product graph schema, mark that
migration applied too (`migrate resolve --applied 20260916000000_product_graph`)
instead of deploying it, then confirm with `pnpm db:migrate:check`, which
exits non-zero if the database and `schema.prisma` disagree.

Once production is baselined, `pnpm db:migrate:deploy` can move into the
Render build or a pre-deploy command. Do not add it there before the baseline:
it would fail every deploy until then.

The Product Graph (`ProductNode`, `ProductEdge`, and four nullable power
columns on `Component`) is one such change. Existing projects need no
backfill: a branch's graph is built the first time its content is edited or
its impact panel is opened.

Locally, `pnpm db:push` and `pnpm db:seed` read `.env.local` before `.env`, so
a `.env.local` pointing at a local Postgres keeps those commands off production.

## After deploy

- Supabase Auth → URL configuration: Site URL = `APP_ORIGIN`; add
  `APP_ORIGIN/auth/confirm` and `APP_ORIGIN/auth/callback` to redirect URLs.
- Set `AUTH_MODE=supabase` (Blueprint default). Never use `AUTH_MODE=local`
  in production.
- Point DNS / custom domain at `foundry-web` if desired, then update Supabase
  Site URL and `NEXT_PUBLIC_COLLAB_URL` accordingly.

## Durable engineering collaboration rollout

Apply `packages/db/prisma/changes/20260911-collaboration.sql` before deploying this
version of the web, worker and Hocuspocus services. It creates one additive table;
existing source documents seed durable Yjs state lazily. This is required even
when `NEXT_PUBLIC_COLLAB_URL` is unset because server and AI saves preserve that
state for later reconnects. Deploy all three services together, using the same
PostgreSQL database, Redis instance, and `AUTH_SECRET`; use `wss://` for the public
collaboration URL. Existing engineering data is not rewritten by the SQL.
