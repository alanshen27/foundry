# FOUNDRY — Agent Guide

Read `Foundry_PRD_Cursor.md` before making architectural changes. It is the
product and implementation source of truth. This file summarizes the working
rules for coding agents.

## Current status

Phase 0 (repository and foundations) is implemented. Engineer > Code has a
first Yjs/Hocuspocus multiplayer Monaco slice (`apps/realtime`,
`packages/collaboration`). Later phases (Product Graph, research hub, full
Yjs surfaces, ideate pipeline, parts, electronics/mechanical collab editors,
GitHub App, agents, verify, launch/commerce) are NOT implemented. Do not
fake them.

## Hard rules

1. Small, reviewable changes. Never implement multiple phases in one pass.
2. Domain logic never imports vendor SDKs directly. All external services
   (Supabase Auth/Storage/Realtime, Zoo CAD) sit behind ports in
   `packages/auth`, `packages/storage`, `packages/realtime`, `packages/cad`.
3. Local/demo adapters are allowed but their output MUST be labeled
   `SIMULATED` or `UNVERIFIED`. Never present mocked output as verified.
4. Every mutating API procedure must check capabilities
   (`packages/domain/src/capabilities.ts`) and record an audit event.
5. Typed contracts for every service boundary. Zod at system boundaries.
6. Add tests with each feature; a rendering UI is not "done".

## Stack (Phase 0 decisions)

- pnpm + Turborepo monorepo; TypeScript strict everywhere.
- `apps/web`: Next.js App Router + tRPC (modular monolith).
- `packages/db`: Prisma + Postgres (Supabase-hosted or local Docker).
- Auth: Supabase Auth behind `AuthPort`; `AUTH_MODE=local` provides a
  clearly-labeled LOCAL credentials adapter for dev/e2e only.
- Storage: Supabase Storage behind `ObjectStoragePort` (required; no local
  filesystem adapter).
- Realtime presence: Supabase Realtime behind `RealtimePort`;
  `NEXT_PUBLIC_REALTIME_MODE=off` disables presence.
- Mechanical CAD: Zoo / KittyCAD behind `CadPort` (`packages/cad`);
  requires `ZOO_API_TOKEN`. Models are KCL; viewport is Zoo WebRTC.
  Assembly placement uses Zoo multi-file Text-to-CAD iteration (attach
  existing part KCL + prompt) then Zoo MCP `execute_kcl` / multiview
  validation via `uvx zoo-mcp` — not Foundry-heuristic or chat-LLM poses.
- Env is validated in `packages/config` (zod). Add new vars there and to
  `.env.example` and `turbo.json` `globalEnv`.

## Commands

- `pnpm install`
- `pnpm db:push` / `pnpm db:seed` (see `packages/db`)
- `pnpm dev` — run the web app
- `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm e2e`

## Layout

- `apps/web` — Next.js app; tRPC routers in `apps/web/server`
- `packages/domain` — entities, capabilities, stage/status enums, event types
- `packages/db` — Prisma schema, client, seed
- `packages/auth`, `packages/storage`, `packages/realtime`, `packages/cad` — ports + adapters
- `packages/config` — env validation
- `packages/observability` — logger + audit helpers
- `docs/` — architecture notes and runbooks
