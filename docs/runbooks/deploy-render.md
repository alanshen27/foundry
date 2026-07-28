# Runbook: deploy on Render

FOUNDRY ships a Render Blueprint at the repo root (`render.yaml`). Postgres,
Auth, and object storage stay on Supabase; Redis is your own (e.g. Upstash).
Render runs the web app, chat worker, and collaboration WebSocket service.

Shared secrets live in the **`foundry-shared`** environment group (linked to
every service). Web-only vars (`NEXT_PUBLIC_COLLAB_URL`,
`FOUNDRY_DEFAULT_WORKSPACE_SLUG`) stay on `foundry-web`.

## One-shot setup

1. Push this branch to GitHub.
2. Open [Render Blueprint](https://dashboard.render.com/blueprint/new) and
   point it at the repo (file: `render.yaml`).
3. Fill every prompted (`sync: false`) secret in **foundry-shared**:
   - `DATABASE_URL` / `DIRECT_URL` — Supabase Postgres (session/direct for DDL)
   - `REDIS_URL` — external Redis (`rediss://…` for Upstash TLS)
   - `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`,
     `SUPABASE_SERVICE_ROLE_KEY`
   - Optional: `OPENAI_API_KEY`, `ZOO_API_TOKEN`, `V0_API_KEY`
4. On **foundry-web**, set `NEXT_PUBLIC_COLLAB_URL` to
   `wss://<foundry-collab hostname>`.
5. Apply schema against production Postgres (`pnpm db:push` locally with
   production `DIRECT_URL`, or run Prisma from a one-off shell).
6. Create the private Supabase Storage bucket named `artifacts`.
7. Configure custom auth email (see `docs/runbooks/auth-email.md`).

## Services

| Service               | Role                                      |
| --------------------- | ----------------------------------------- |
| `foundry-web`         | Next.js App Router (`@foundry/web`)       |
| `foundry-chat-worker` | BullMQ worker for AI chat runs            |
| `foundry-collab`      | Hocuspocus Yjs WebSocket server           |

`APP_ORIGIN` is wired from `RENDER_EXTERNAL_URL` on `foundry-web`. Auth email
redirects and screenshot tools both use it. `AUTH_SECRET` is generated once in
`foundry-shared` so web / worker / collab share the same value.

## Build notes

Install uses `pnpm install --frozen-lockfile --prod=false` so Prisma and other
devDependencies are present during `prisma generate` / `next build` even when
Render sets `NODE_ENV=production`.

## After deploy

- Supabase Auth → URL configuration: Site URL = `APP_ORIGIN`; add
  `APP_ORIGIN/auth/confirm` and `APP_ORIGIN/auth/callback` to redirect URLs.
- Set `AUTH_MODE=supabase` (Blueprint default). Never use `AUTH_MODE=local`
  in production.
- Point DNS / custom domain at `foundry-web` if desired, then update Supabase
  Site URL and `NEXT_PUBLIC_COLLAB_URL` accordingly.
