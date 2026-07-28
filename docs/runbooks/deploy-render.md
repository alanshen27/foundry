# Runbook: deploy on Render

FOUNDRY ships a Render Blueprint at the repo root (`render.yaml`). Postgres,
Auth, and object storage stay on Supabase; Redis is your own (e.g. Upstash).
Render runs the web app, chat worker, and collaboration WebSocket service.

## One-shot setup

1. Push this branch to GitHub.
2. Open [Render Blueprint](https://dashboard.render.com/blueprint/new) and
   point it at the repo (file: `render.yaml`).
3. Fill every prompted (`sync: false`) secret:
   - `DATABASE_URL` / `DIRECT_URL` — Supabase Postgres (session/direct for DDL)
   - `REDIS_URL` — external Redis (`rediss://…` for Upstash TLS)
   - `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`,
     `SUPABASE_SERVICE_ROLE_KEY`
   - `NEXT_PUBLIC_COLLAB_URL` — `wss://<foundry-collab hostname>`
   - Optional: `OPENAI_API_KEY`, `ZOO_API_TOKEN`, `V0_API_KEY`
4. Apply schema against production Postgres (`pnpm db:push` locally with
   production `DIRECT_URL`, or run Prisma from a one-off shell).
5. Create the private Supabase Storage bucket named `artifacts`.
6. Configure custom auth email (see `docs/runbooks/auth-email.md`).

## Services

| Service               | Role                                      |
| --------------------- | ----------------------------------------- |
| `foundry-web`         | Next.js App Router (`@foundry/web`)       |
| `foundry-chat-worker` | BullMQ worker for AI chat runs            |
| `foundry-collab`      | Hocuspocus Yjs WebSocket server           |

`APP_ORIGIN` is wired from `RENDER_EXTERNAL_URL` on `foundry-web`. Auth email
redirects and screenshot tools both use it.

## After deploy

- Supabase Auth → URL configuration: Site URL = `APP_ORIGIN`; add
  `APP_ORIGIN/auth/confirm` and `APP_ORIGIN/auth/callback` to redirect URLs.
- Set `AUTH_MODE=supabase` (Blueprint default). Never use `AUTH_MODE=local`
  in production.
- Point DNS / custom domain at `foundry-web` if desired, then update Supabase
  Site URL and `NEXT_PUBLIC_COLLAB_URL` accordingly.
