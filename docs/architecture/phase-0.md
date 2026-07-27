# Phase 0 architecture

Scope: repository foundations only (PRD section 25, Phase 0). This note records
the decisions Phase 0 committed to and the boundaries later phases must respect.

## Decisions

- **Modular monolith.** `apps/web` hosts UI and the tRPC API. Service
  boundaries from PRD 19.2 exist as modules (`server/routers/*`,
  `packages/*`), not deployables. Splitting out `apps/api`, workers, and the
  realtime server happens when their phases need them.
- **Supabase** provides Postgres, Auth, Storage, and Realtime presence. Every
  Supabase surface is wrapped by a port so it can be replaced:
  - `AuthPort` (`packages/auth`) — Supabase Auth or LOCAL (dev/e2e; HMAC
    session cookie + scrypt password, never for production).
  - `ObjectStoragePort` (`packages/storage`) — Supabase Storage.
  - `RealtimePort` (`packages/realtime`) — Supabase Realtime presence or a
    no-op "off" adapter. This is NOT the Yjs layer; Phase 2 will add document
    collaboration with its own persistence (ADR required).
- **Capability-based permissions.** Role defaults + `CapabilityGrant` rows,
  checked by `requireWorkspaceCapability` on every mutating procedure.
  Grants extend but never reduce role defaults.
- **Audit events.** Every mutation records an `AuditEvent` row using the
  domain event envelope (type, workspace/project/branch, actor, causation/
  correlation, schema version, payload). Phase 1 builds the dependency/
  invalidation engine on this foundation.
- **Stage state machine.** Phase 0 only permits `NOT_STARTED -> DRAFT`
  (opening a stage). All gate transitions are rejected in
  `packages/domain/src/stages.ts` until their phases ship, so nothing can
  claim approval it doesn't have.
- **Artifacts.** Metadata rows in Postgres; bytes in object storage keyed by
  `workspaceId/projectId/uuid-name`, hashed with sha256, and always created
  `UNVERIFIED`.

## Non-goals honored

No product graph, research, concepts, EDA/CAD, GitHub, agents, validation, or
commerce code exists. Stage surfaces are labeled placeholders.
