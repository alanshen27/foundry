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
  `parts/*` are manufacturing/fab KCL; `assembly/product.kcl` is the product
  PREVIEW. Preview generation attaches part KCL as reference and uses Zoo
  text-to-CAD (imports optional; named solids preferred), then Zoo MCP
  `execute_kcl` / multiview via `uvx zoo-mcp` when available.
- Launch media: image/video generation behind `MediaGenerationPort`
  (`packages/media`). Stills use the OpenAI Images API; video requires
  `MEDIA_VIDEO_MODEL`. Unset keys fall back to a SIMULATED adapter whose
  assets cannot be approved for marketing or attached to a site. Marketing
  approval (`MediaApproval`) is separate from `VerificationState` — a render is
  never engineering evidence.
- Storefront sites: v0 Platform API behind `SiteBuilderPort`
  (`packages/sites`); requires `V0_API_KEY`. v0 owns generation, preview
  hosting, and deployment — FOUNDRY runs no build containers and stores only
  the ids needed to resume editing. Unset falls back to a SIMULATED adapter
  that generates nothing and refuses to publish.
- Commerce: Shopify Storefront API behind `CommercePort`
  (`packages/commerce`). Credentials are per-site on
  `CheckoutConfiguration`, not env, since each workspace sells from its own
  store. Shopify owns catalog, payment, tax, and the hosted checkout; a
  listing cannot go ACTIVE without a release and a seller identity
  (`canActivateListing`, PRD 14.5 / 24.4).
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
- `packages/auth`, `packages/storage`, `packages/realtime`, `packages/cad`,
  `packages/sites`, `packages/commerce`, `packages/media` — ports + adapters
- `packages/config` — env validation
- `packages/observability` — logger + audit helpers
- `docs/` — architecture notes and runbooks
