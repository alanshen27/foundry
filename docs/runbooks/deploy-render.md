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

## After deploy

- Supabase Auth → URL configuration: Site URL = `APP_ORIGIN`; add
  `APP_ORIGIN/auth/confirm` and `APP_ORIGIN/auth/callback` to redirect URLs.
- Set `AUTH_MODE=supabase` (Blueprint default). Never use `AUTH_MODE=local`
  in production.
- Point DNS / custom domain at `foundry-web` if desired, then update Supabase
  Site URL and `NEXT_PUBLIC_COLLAB_URL` accordingly.
