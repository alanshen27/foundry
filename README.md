# FOUNDRY

**Describe it. Code it. Engineer it. Build it. Sell it.**

FOUNDRY is a collaborative, AI-native workspace for taking a physical-product
idea from an early brief to engineering artifacts, verification, launch media,
a storefront, and commerce configuration.

**Live application:** https://foundry-web-3wiy.onrender.com/

## Product overview

Each project follows four connected stages:

1. **Ideate** — shape the product brief and requirements with an AI copilot.
2. **Engineer** — develop the assembly, mechanical CAD, schematic, PCB, code,
   repository files, and supporting design documents.
3. **Verify** — review validation checks, evidence, waivers, approvals, and
   release readiness.
4. **Launch** — prepare marketing media, generate and edit a storefront, and
   configure a Shopify-backed product listing and checkout.

The application also includes workspace membership, project folders, shared
project navigation, account profiles, invitations, capability-based access,
audit events, project chat, replies and reactions, background AI jobs, and
multiplayer engineering editing.

## Implemented capabilities

### AI-assisted product development

- Project-aware copilot with streaming responses and tool execution
- Persistent chat runs, background processing, cancellation, recovery, and
  heartbeat handling
- Authored messages, reply threads, reactions, and message actions
- AI-assisted brief, requirements, engineering, and launch workflows

### Engineering workspaces

- Opens existing projects directly in the assembly viewport; a compact workflow strip opens an optional side inspector
- Native Python mechanical CAD with Astra generation, local build123d/OpenCascade solids, and a Three.js viewport
- CAD preview assembly, entity labels, hover selection, and rendered previews
- Explicit schematic part/pin → PCB footprint/pad links, layout-preserving synchronization, and mapping-aware DRC
- All-board PCB → CAD synchronization with declared outlines/drills and linked assemblies with editable instance poses
- Monaco code editor, repository file workspace, autosave, and project files
- Durable Yjs/Hocuspocus collaboration for code, schematic, PCB, CAD, assembly metadata, and design notes; API/AI writes use the same shared document
- Streamed AI source drafts shown while generating; only completed, validated tool results update saved designs

### Verification and release

- Validation checks, status tracking, evidence, and waivers
- Approval gates and release records; engineering edits invalidate prior checks and approvals, including live edits
- Capability checks and audit events for protected mutations

### Launch, media, and commerce

- Product image and video asset library
- Asynchronous media generation jobs and provider adapters
- Separate marketing approval and engineering-verification states
- v0-powered storefront creation, preview, iterative editing, and deployment
- Site media attachments and launch context
- Shopify Storefront integration, listings, seller identity, and hosted checkout

### Platform and collaboration

- Supabase or local authentication through `AuthPort`
- Supabase object storage through `ObjectStoragePort`
- Workspace, project, branch, folder, invitation, and membership management
- Capability-based permissions and structured audit logging
- Supabase presence and Hocuspocus collaboration services
- Render deployment blueprint for web, worker, and collaboration services

See [Connected engineering](docs/runbooks/connected-engineering.md) for workflow, limits, and the required additive collaboration migration.

## Architecture

FOUNDRY is a pnpm/Turborepo TypeScript monorepo:

- **Web application:** Next.js App Router, React, tRPC, Tailwind CSS
- **Database:** PostgreSQL with Prisma
- **Authentication and storage:** Supabase behind typed ports
- **Background work:** BullMQ and Redis
- **Realtime collaboration:** Supabase Realtime plus Yjs/Hocuspocus
- **Mechanical CAD:** GPT-6 Astra for Python generation, build123d/OpenCascade for geometry, Three.js for rendering
- **AI:** OpenAI-backed copilot and media generation
- **Storefronts:** v0 Platform API
- **Commerce:** Shopify Storefront API
- **Validation:** Zod, ESLint, Prettier, Vitest, and Playwright

External services are isolated behind package-level ports. Local or demo
fallbacks remain explicitly labeled `LOCAL`, `SIMULATED`, or `UNVERIFIED`;
their output must not be presented as verified production data.

## Local setup

### Prerequisites

- Node.js 22
- pnpm 9
- PostgreSQL, either through the local Docker service or a hosted Supabase project
- Redis for background chat and media jobs
- macOS with `uv` for the sandboxed Python CAD worker (Python 3.12/build123d 0.9.1)

### Start the application

```bash
pnpm install

# Optional local PostgreSQL
docker compose -f infra/local/docker-compose.yml up -d

cp .env.example .env
# Configure the services needed for your environment.

pnpm db:generate
pnpm db:push
pnpm db:seed
pnpm dev
```

The local web application runs at http://localhost:3000. The seed creates:

- `builder@foundry.local`
- `reviewer@foundry.local`
- Password: `demo-password`

See `.env.example` for the full configuration and
`docs/runbooks/local-setup.md` for additional setup guidance.

### VS Code workflow

Open the repository root—not only `apps/web`—so VS Code can resolve every
workspace package:

```bash
code .
```

In the integrated terminal, select Node.js 22 and pnpm 9, then run the same
repository-level setup:

```bash
corepack enable
corepack prepare pnpm@9.15.4 --activate
pnpm install
cp .env.example .env
pnpm db:generate
pnpm db:push
pnpm db:seed
pnpm dev
```

Keep credentials in the ignored `.env` file rather than VS Code settings or
source files. If Explorer appears empty or workspace imports cannot resolve,
use **File → Open Folder…** and select the directory containing this
`README.md`, `package.json`, and `pnpm-workspace.yaml`.

## External service configuration

| Capability                     | Configuration                                                       |
| ------------------------------ | ------------------------------------------------------------------- |
| Database                       | `DATABASE_URL`, optionally `DIRECT_URL`                             |
| Authentication                 | `AUTH_MODE`, Supabase variables, `AUTH_SECRET` for local mode       |
| Storage                        | Supabase variables and `STORAGE_BUCKET`                             |
| AI copilot                     | OpenAI credentials, `AI_MODEL`; Jev triage via `OPENROUTER_API_KEY` |
| Background jobs                | `REDIS_URL`                                                         |
| Realtime presence              | `NEXT_PUBLIC_REALTIME_MODE`                                         |
| Collaborative engineering      | `NEXT_PUBLIC_COLLAB_URL`                                            |
| Mechanical CAD                 | `OPENAI_API_KEY`, `CAD_MODEL`; local macOS + `uv`                   |
| Media video                    | `MEDIA_VIDEO_MODEL`                                                 |
| Storefront generation          | `V0_API_KEY`                                                        |
| Public callbacks and rendering | `APP_ORIGIN`                                                        |

CAD generation uses the OpenAI Responses API with `CAD_MODEL=gpt-6-astra` by default.
Set `OPENAI_API_KEY` to an account with access to the model. Astra writes editable
Python/build123d files; a sandboxed local Python worker evaluates exact OpenCascade
solids and exports STEP plus STL. Three.js displays the STL and caches recent parts.
Geometry operations do not require OpenAI credentials. Zoo calls are disabled even
if an old token is configured. Existing KCL source is preserved and requires explicit
conversion or regeneration before native editing; imported STL/GLB still opens directly.

The local execution sandbox currently requires macOS. Other hosts fail closed;
a hosted Linux deployment needs a separately isolated CAD worker before it can build
Python models. Kernel validity does not establish manufacturability or assembly fit.
See the [native CAD runbook](docs/runbooks/native-python-cad.md) for setup, supported
imports, migration behavior, cache limits, and validation.

Shopify credentials are configured per site rather than as shared environment
variables because each workspace may sell through a different store.

## Commands

| Command                  | Purpose                                                |
| ------------------------ | ------------------------------------------------------ |
| `pnpm dev`               | Run the web app, chat worker, and collaboration server |
| `pnpm build`             | Build the monorepo                                     |
| `pnpm format:check`      | Check formatting                                       |
| `pnpm lint`              | Run ESLint                                             |
| `pnpm typecheck`         | Type-check all packages                                |
| `pnpm test`              | Run Vitest tests                                       |
| `pnpm e2e`               | Run the Playwright end-to-end journey                  |
| `pnpm db:generate`       | Generate the Prisma client                             |
| `pnpm db:push`           | Apply the schema to the database                       |
| `pnpm db:seed`           | Seed local demonstration data                          |
| `pnpm db:migrate:deploy` | Apply pending migrations (Render runs this pre-deploy) |
| `pnpm db:migrate:check`  | Fail if the database and `schema.prisma` disagree      |
| `pnpm db:rls:check`      | Fail if any public table lacks row-level security      |
| `pnpm db:baseline:plan`  | Read-only: print the baseline for a `db push` database |

Deployment targets Render + Supabase; see
[`docs/ROADMAP_TO_DEPLOYMENT.md`](docs/ROADMAP_TO_DEPLOYMENT.md) and
[`docs/runbooks/deploy-render.md`](docs/runbooks/deploy-render.md).
`GET /api/health` is liveness; `GET /api/ready` also checks Postgres and Redis.

## Repository layout

- `apps/web` — product UI, API routes, tRPC routers, render surfaces, and workers
- `apps/realtime` — Hocuspocus collaboration server
- `packages/domain` — entities, capabilities, states, and domain contracts
- `packages/db` — Prisma schema, database client, and seed
- `packages/auth` — authentication port and adapters
- `packages/storage` — object-storage port and Supabase adapter
- `packages/realtime` — presence port and adapters
- `packages/collaboration` — Yjs document and persistence helpers
- `packages/cad` — native Python CAD, Astra generation, and sandboxed OpenCascade execution
- `packages/media` — image/video generation port and adapters
- `packages/sites` — storefront builder port and v0 adapter
- `packages/commerce` — commerce port and Shopify adapter
- `packages/config` — validated environment configuration
- `packages/ui` — shared interface primitives
- `packages/observability` — logging and audit helpers
- `infra/local` — local infrastructure
- `docs` — architecture notes and operational runbooks

For the broader product background, see `Foundry_PRD_Cursor.md` and
`docs/proposal.md`. Contributor and coding-agent rules live in `AGENTS.md`.
