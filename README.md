# FOUNDRY

Describe it. Engineer it. Build it. Sell it.

FOUNDRY is a collaborative, AI-native environment for creating complete physical
products. See `Foundry_PRD_Cursor.md` for the full product specification and
`AGENTS.md` for agent/contributor working rules.

## Status: Phase 0

This repository currently implements **Phase 0 — repository and foundations**:

- pnpm + Turborepo monorepo with strict TypeScript, ESLint, Prettier, Vitest, Playwright, CI
- Postgres (Supabase or local Docker) with Prisma migrations
- Auth behind an `AuthPort` (Supabase Auth, plus a clearly-labeled LOCAL dev adapter)
- Object storage behind an `ObjectStoragePort` (Supabase Storage, plus a SIMULATED local adapter)
- Realtime presence behind a `RealtimePort` (Supabase Realtime, or off)
- Workspace/project CRUD with capability-based permissions and audit events
- Collaborator invitations with accept flow
- The four-stage project shell (Ideate / Engineer / Verify / Launch)

Later phases (Product Graph, research hub, Yjs collaboration, concept pipeline,
parts, electronics/mechanical editors, GitHub integration, agents, verification,
releases, commerce) are **not implemented** and their surfaces are honest
placeholders.

## Local setup

Prerequisites: Node 20+, pnpm 9+, Docker (only if you don't use hosted Supabase).

```bash
pnpm install

# Option A: local Postgres (no Supabase account needed)
docker compose -f infra/local/docker-compose.yml up -d
cp .env.example .env    # defaults work as-is for local mode

# Option B: hosted Supabase
# Set DATABASE_URL, NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY,
# SUPABASE_SERVICE_ROLE_KEY in .env and switch AUTH_MODE/STORAGE_MODE to "supabase".

pnpm db:generate
pnpm db:push
pnpm db:seed            # creates builder@foundry.local / reviewer@foundry.local (demo-password)
pnpm dev                # http://localhost:3000
```

## Commands

| Command                           | Purpose                                         |
| --------------------------------- | ----------------------------------------------- |
| `pnpm dev`                        | Run the web app                                 |
| `pnpm lint` / `pnpm format:check` | Lint and formatting                             |
| `pnpm typecheck`                  | TypeScript across all packages                  |
| `pnpm test`                       | Vitest unit tests                               |
| `pnpm e2e`                        | Playwright end-to-end journey (needs DB + seed) |
| `pnpm db:push` / `pnpm db:seed`   | Apply schema / seed demo data                   |

## Layout

- `apps/web` — Next.js App Router application with tRPC routers in `apps/web/server`
- `packages/domain` — capabilities, stage/state machines, domain event contracts
- `packages/db` — Prisma schema, client, and seed
- `packages/auth` / `packages/storage` / `packages/realtime` — ports + Supabase/local adapters
- `packages/config` — zod-validated environment
- `packages/ui` — shared UI primitives
- `packages/observability` — structured logging
- `infra/local` — local Postgres compose file
- `docs/` — architecture notes and runbooks
