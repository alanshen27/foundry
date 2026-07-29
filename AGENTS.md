# FOUNDRY — Agent Guide

This file defines the working rules for coding agents contributing to FOUNDRY.
Read `README.md` for the current product surface and `Foundry_PRD_Cursor.md` for
the broader product and implementation context before making architectural
changes.

## Current status

FOUNDRY is implemented as an end-to-end, four-stage physical-product workspace:

- **Ideate:** project brief, requirements, and AI-assisted planning
- **Engineer:** assembly, CAD, schematic, PCB, code, repository files, and
  collaborative editing
- **Verify:** validation checks, evidence, waivers, approvals, and releases
- **Launch:** product media, storefront creation and editing, listings, and
  Shopify checkout configuration

The platform also includes workspaces, projects, branches, folders, invitations,
capability-based permissions, audit events, account profiles, project chat,
background AI/media jobs, Sites management, and deployment configuration.

When changing an existing feature, follow its current domain model, router,
adapter, UI, and test patterns. Keep the current product semantics intact unless
the task explicitly changes them.

## Hard rules

1. Keep changes small, coherent, and reviewable.
2. Domain logic must not import vendor SDKs directly. External services belong
   behind typed ports in their corresponding packages.
3. Local/demo adapters are allowed, but their output must be labeled `LOCAL`,
   `SIMULATED`, or `UNVERIFIED`. Never present fallback output as verified.
4. Marketing-media approval is separate from engineering verification. A render
   is not engineering evidence.
5. Every protected mutating procedure must check capabilities through
   `packages/domain/src/capabilities.ts` and record an audit event.
6. Use typed contracts at service boundaries and Zod at system boundaries.
7. Add or update tests with each behavioral change. Rendering a UI is not enough
   to consider the behavior complete.
8. Preserve user data and existing worktree changes. Avoid destructive Git or
   database operations unless the user explicitly requests them.
9. Add environment variables to `packages/config`, `.env.example`, and
   `turbo.json` `globalEnv`.
10. Run the smallest relevant checks while developing, then the full validation
    chain before final handoff.

## Current architecture

- pnpm + Turborepo monorepo with strict TypeScript
- `apps/web`: Next.js App Router and tRPC modular monolith
- `apps/realtime`: Yjs/Hocuspocus collaboration service
- `packages/db`: Prisma and PostgreSQL
- `packages/domain`: capabilities, states, entities, and shared contracts
- `packages/auth`: Supabase and local authentication adapters
- `packages/storage`: Supabase object storage
- `packages/realtime`: Supabase presence
- `packages/collaboration`: Yjs persistence and document helpers
- `packages/cad`: Zoo/KittyCAD and KCL integration
- `packages/media`: product image/video generation
- `packages/sites`: v0 storefront generation and deployment
- `packages/commerce`: Shopify Storefront integration
- `packages/config`: Zod-validated environment configuration
- `packages/observability`: structured logging and audit helpers
- `packages/ui`: shared UI components

## Service boundaries

### Authentication and storage

- Production authentication uses Supabase Auth behind `AuthPort`.
- `AUTH_MODE=local` is only for development and E2E.
- Object storage uses Supabase Storage behind `ObjectStoragePort`.

### Realtime and collaboration

- Presence uses Supabase Realtime behind `RealtimePort`.
- `NEXT_PUBLIC_REALTIME_MODE=off` disables remote presence.
- Engineer > Code uses Yjs/Hocuspocus multiplayer Monaco.
- Without `NEXT_PUBLIC_COLLAB_URL`, the editor falls back to single-player
  autosave.

### AI and background jobs

- Project chat and AI workflows run through typed server boundaries.
- BullMQ/Redis workers handle persistent chat and media jobs.
- Preserve cancellation, heartbeat, retry, and idempotency behavior when
  changing job execution.

### Mechanical CAD

- Zoo/KittyCAD is isolated behind `CadPort`; live use requires `ZOO_API_TOKEN`.
- KCL is the source representation for parts and assemblies.
- `parts/*` contains manufacturing/fabrication KCL.
- `assembly/product.kcl` is the product preview.
- Assembly generation may use Zoo MCP through `uvx zoo-mcp`.

### Launch media

- Image/video generation is isolated behind `MediaGenerationPort`.
- Stills use the OpenAI Images API.
- Video requires `MEDIA_VIDEO_MODEL`.
- Missing credentials fall back to an explicitly `SIMULATED` adapter.
- Simulated assets cannot be approved for marketing or attached to a site.

### Sites and commerce

- Storefront work is isolated behind `SiteBuilderPort` and the v0 Platform API.
- v0 owns generation, preview hosting, and deployment.
- Missing `V0_API_KEY` uses a simulated adapter that cannot publish.
- Shopify is isolated behind `CommercePort`.
- Shopify credentials are stored per site in `CheckoutConfiguration`.
- Shopify owns catalog, payment, tax, and hosted checkout.
- A listing requires a release and seller identity before becoming active.

## Development commands

```bash
pnpm install
pnpm db:generate
pnpm db:push
pnpm db:seed
pnpm dev
```

Validation:

```bash
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm e2e
```

The supported runtime is Node.js 22 with pnpm 9.

## Change checklist

Before handing off a change:

1. Confirm the implementation follows the relevant package port and domain
   boundary.
2. Confirm capability checks and audit events for protected mutations.
3. Confirm simulated or unverified output remains visibly labeled.
4. Add or update unit, router, and E2E coverage as appropriate.
5. Run formatting, lint, type-checking, tests, and E2E in proportion to the
   change.
6. Update `README.md`, `.env.example`, and runbooks when setup or behavior
   changes.
