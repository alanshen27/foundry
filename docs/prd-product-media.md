# FOUNDRY — Product Media (Renders & Video) PRD

**Status:** Implementation spec for Cursor / TypeScript agents  
**Scope:** Launch marketing kit + site attachment  
**Depends on:** Phase 0 storage/auth, existing `Site` / `Release` / `Artifact`, `ObjectStoragePort`  
**Non-goals (this doc):** Production/assembly manuals (separate PRD), training custom CNNs/GANs, replacing Zoo CAD renders as engineering truth

---

## 0. Instructions to Cursor

1. Small, reviewable PRs. Schema → domain types → port → tRPC → UI.
2. Bytes live in Supabase Storage via `ObjectStoragePort`. Postgres stores **metadata + relations only**.
3. Never present AI media as verified geometry or manufacturing evidence. Use `VerificationState` / labels: `UNVERIFIED` | `SIMULATED` | `APPROVED_FOR_MARKETING`.
4. Domain packages MUST NOT import vendor SDKs (OpenAI image/video, Runway, etc.). Put adapters behind a port in `packages/media` (or extend `packages/storage` + a thin `MediaGenerationPort`).
5. Every mutating procedure checks capabilities and writes an audit event.
6. Zod at every system boundary. Prefer typed Prisma models over JSON blobs for media rows.
7. Add tests with each feature (schema helpers, router, attachment rules).

---

## 1. Problem

Today:

- Concept images hang off Ideate `designData.conceptImages` (ad hoc JSON keys).
- CAD/PCB screenshots are ephemeral tool outputs, not first-class media.
- Sites (`Site`) have no way to attach a gallery, hero still, or product video from FOUNDRY-owned assets — the builder only gets text product context.

We need a **custom media schema** so generated renders and videos are durable, queryable, releasable, and **attachable to Sites** for storefront/marketing use.

---

## 2. Goals

1. Persist marketing **stills** and **videos** as first-class rows with storage keys, mime, hash, provenance, and verification label.
2. Allow media to belong to a **Project** (and optionally pin to a **Release** snapshot).
3. Allow a **Site** to attach an ordered set of media for hero / gallery / social / video.
4. Support AI generation jobs that write into this schema (stills now; short videos next) without blocking site publish on generation failures.
5. Feed attached media URLs into `SiteProductContext` / builder revise prompts so the landing page can reference real assets.

---

## 3. Non-goals

- Using marketing media as Verify evidence or CAD authority.
- Hosting video transcoding infra in FOUNDRY (MAY use an external generator; store the resulting file or external URL + provenance).
- Full DAM (digital asset management) for arbitrary team uploads beyond product media kinds below.
- Auto-publishing media to Shopify CDN (MAY come later; Shopify listing images are out of scope for v1).

---

## 4. Domain model

### 4.1 Concepts

| Term                    | Meaning                                                               |
| ----------------------- | --------------------------------------------------------------------- |
| **ProductMedia**        | One still or video asset for a project (marketing-oriented).          |
| **SiteMediaAttachment** | Ordered join: this site uses this media in a slot (hero, gallery, …). |
| **MediaJob**            | Async generation run that produces one or more `ProductMedia` rows.   |

Engineering screenshots (copilot vision loop) MAY later promote into `ProductMedia` with `source = CAPTURE`; v1 focuses on marketing generation + attach.

### 4.2 Prisma schema (normative sketch)

```prisma
enum ProductMediaKind {
  STILL          // PNG/WebP/JPEG hero, detail, lifestyle
  VIDEO          // short MP4/WebM product clip
  TURNAROUND     // optional multi-frame still sequence metadata
}

enum ProductMediaRole {
  HERO
  GALLERY
  DETAIL
  LIFESTYLE
  SOCIAL         // OG / square crop intent
  EXPLODED
  OTHER
}

enum ProductMediaSource {
  AI_IMAGE       // text/image-to-image generator
  AI_VIDEO       // text/image-to-video generator
  CAD_CAPTURE    // /render/model3d screenshot promoted
  PCB_CAPTURE    // /render/pcb screenshot promoted
  UPLOAD         // human upload via ObjectStoragePort
  EXTERNAL       // URL-only pointer (prefer storing bytes when possible)
}

/// Marketing / launch media. Not engineering authority.
model ProductMedia {
  id                 String               @id @default(cuid())
  workspaceId        String
  projectId          String
  /// When set, this asset is tied to an immutable release (preferred for live sites).
  releaseId          String?
  kind               ProductMediaKind
  role               ProductMediaRole     @default(GALLERY)
  source             ProductMediaSource
  /// Object storage key (required unless source = EXTERNAL and externalUrl set).
  storageKey         String?
  externalUrl        String?
  mimeType           String
  sha256             String?
  sizeBytes          Int?
  width              Int?
  height             Int?
  /// Video only
  durationMs         Int?
  posterStorageKey   String?
  prompt             String?
  /// Model / adapter id that produced this asset (e.g. "openai:gpt-image-1", "simulated").
  generator          String?
  verificationState  VerificationState    @default(UNVERIFIED)
  /// True when produced by SIMULATED adapter — must never be presented as real footage.
  simulated          Boolean              @default(false)
  createdById        String
  createdAt          DateTime             @default(now())
  updatedAt          DateTime             @updatedAt

  workspace    Workspace             @relation(...)
  project      Project               @relation(...)
  release      Release?              @relation(...)
  attachments  SiteMediaAttachment[]
  job          MediaJob?             @relation(...)

  @@index([projectId, kind])
  @@index([workspaceId, projectId])
  @@index([releaseId])
}

enum SiteMediaSlot {
  HERO
  GALLERY
  VIDEO_PRIMARY
  SOCIAL
}

/// Ordered attachment of ProductMedia onto a Site for storefront use.
model SiteMediaAttachment {
  id        String        @id @default(cuid())
  siteId    String
  mediaId   String
  slot      SiteMediaSlot @default(GALLERY)
  sortOrder Int           @default(0)
  altText   String?
  createdAt DateTime      @default(now())

  site  Site         @relation(...)
  media ProductMedia @relation(...)

  @@unique([siteId, mediaId, slot])
  @@index([siteId, slot, sortOrder])
}

enum MediaJobStatus {
  PENDING
  RUNNING
  SUCCEEDED
  FAILED
  CANCELLED
}

enum MediaJobType {
  GENERATE_STILLS
  GENERATE_VIDEO
  PROMOTE_CAPTURE
}

model MediaJob {
  id          String         @id @default(cuid())
  workspaceId String
  projectId   String
  releaseId   String?
  type        MediaJobType
  status      MediaJobStatus @default(PENDING)
  /// Zod-validated request (prompt, angles, duration, seed media ids).
  input       Json
  error       String?
  createdById String
  createdAt   DateTime       @default(now())
  startedAt   DateTime?
  finishedAt  DateTime?

  media ProductMedia[]

  @@index([projectId, status])
}
```

Wire relations onto existing `Workspace`, `Project`, `Release`, `Site`. Do **not** overload `Artifact.kind` string for this — marketing media needs slots, roles, video fields, and site joins.

### 4.3 Zod contracts (`packages/domain` or `packages/media`)

```ts
export const productMediaKindSchema = z.enum(["STILL", "VIDEO", "TURNAROUND"]);
export const siteMediaSlotSchema = z.enum(["HERO", "GALLERY", "VIDEO_PRIMARY", "SOCIAL"]);

export const attachSiteMediaInputSchema = z.object({
  siteId: z.string().min(1),
  mediaId: z.string().min(1),
  slot: siteMediaSlotSchema,
  sortOrder: z.number().int().min(0).optional(),
  altText: z.string().max(200).optional(),
});

export const generateStillsInputSchema = z.object({
  projectId: z.string(),
  releaseId: z.string().optional(),
  prompt: z.string().trim().min(1).max(2000),
  roles: z
    .array(z.enum(["HERO", "GALLERY", "DETAIL", "LIFESTYLE", "SOCIAL", "EXPLODED"]))
    .min(1)
    .max(8),
  /** Optional: seed from an existing ProductMedia / concept key */
  seedMediaId: z.string().optional(),
});

export const generateVideoInputSchema = z.object({
  projectId: z.string(),
  releaseId: z.string().optional(),
  prompt: z.string().trim().min(1).max(2000),
  /** Prefer stills as first frames when present */
  seedMediaIds: z.array(z.string()).max(12).optional(),
  durationSec: z.number().int().min(2).max(30).default(6),
});
```

### 4.4 Port

```ts
// packages/media/src/port.ts
export type MediaGenerationPort = {
  generateStills(input: {
    prompt: string;
    count: number;
    aspectRatio?: "1:1" | "4:3" | "16:9" | "9:16";
  }): Promise<
    | {
        ok: true;
        data: {
          bytes: Uint8Array;
          mimeType: string;
          width?: number;
          height?: number;
          generator: string;
          simulated: boolean;
        }[];
      }
    | { ok: false; error: string }
  >;

  generateVideo(input: {
    prompt: string;
    durationSec: number;
    seedImageBytes?: Uint8Array;
  }): Promise<
    | {
        ok: true;
        data: {
          bytes: Uint8Array;
          mimeType: string;
          durationMs: number;
          posterBytes?: Uint8Array;
          generator: string;
          simulated: boolean;
        };
      }
    | { ok: false; error: string }
  >;
};
```

- **Configured adapter:** real provider when API keys present.
- **SIMULATED adapter (default unset):** returns labeled placeholder PNG/MP4 (or refuses video with clear error) — never publishable as real product footage.
- Env: validate in `packages/config` (e.g. `MEDIA_IMAGE_PROVIDER`, keys); add to `.env.example` + `turbo.json` `globalEnv`.

---

## 5. Capabilities & audit

| Action                                           | Capability                                                                                                                             |
| ------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------- |
| List media for project                           | `project.read`                                                                                                                         |
| Generate / upload / delete media                 | `site.edit` or new `media.edit` (prefer reuse `site.edit` for v1 if media is launch-only; otherwise add `media.edit` to role defaults) |
| Attach / reorder / detach on site                | `site.edit`                                                                                                                            |
| Approve for marketing (`APPROVED_FOR_MARKETING`) | `site.publish`                                                                                                                         |

Extend `VerificationState` **or** add marketing-specific enum:

```ts
// Prefer additive — do not overload VERIFIED (engineering meaning)
enum MediaApproval {
  DRAFT
  APPROVED_FOR_MARKETING
  REJECTED
}
```

If keeping `VerificationState`, map: `UNVERIFIED`/`SIMULATED`/`REJECTED` + use payload flag `approvedForMarketing` on audit. **Recommendation:** add `MediaApproval` on `ProductMedia` so engineering `VERIFIED` is never confused with “ok for hero image.”

Audit events (add to `DOMAIN_EVENT_TYPES`):

- `ProductMediaCreated`
- `ProductMediaDeleted`
- `MediaJobStarted` / `MediaJobFinished`
- `SiteMediaAttached` / `SiteMediaDetached` / `SiteMediaReordered`

---

## 6. API (tRPC)

Router: `apps/web/server/routers/media.ts` (mount on `appRouter`).

| Procedure              | Type     | Behavior                                                                         |
| ---------------------- | -------- | -------------------------------------------------------------------------------- |
| `media.list`           | query    | By `projectId`, optional `kind` / `releaseId`                                    |
| `media.get`            | query    | Signed read URL via storage port + metadata                                      |
| `media.generateStills` | mutation | Create `MediaJob`, enqueue worker (or inline if small), write `ProductMedia`     |
| `media.generateVideo`  | mutation | Same for video; SIMULATED must label                                             |
| `media.delete`         | mutation | Soft-delete MAY come later; v1 hard-delete row + storage object if FOUNDRY-owned |
| `site.media.list`      | query    | Attachments for site, ordered                                                    |
| `site.media.attach`    | mutation | Validate media.workspaceId === site.workspaceId; same project preferred          |
| `site.media.detach`    | mutation |                                                                                  |
| `site.media.reorder`   | mutation | Update `sortOrder` within slot                                                   |

**Attachment rules (MUST):**

1. `media.workspaceId === site.workspaceId`.
2. If `site.projectId` set, `media.projectId` MUST match (or allow workspace-shared later — v1: match).
3. If `site.releaseId` set and media has `releaseId`, they SHOULD match; warn in UI if media is from another release.
4. `simulated === true` media MUST NOT be the only HERO on a `PUBLISHED` site without an explicit `UNVERIFIED` / SIMULATED badge in builder context.
5. Max attachments: e.g. 1 HERO, 1 VIDEO_PRIMARY, ≤12 GALLERY, ≤3 SOCIAL (zod + server enforce).

---

## 7. Site builder integration

Extend `SiteProductContext`:

```ts
export type SiteProductContext = {
  // ...existing fields...
  media?: {
    heroUrl?: string | null;
    galleryUrls?: string[];
    videoUrl?: string | null;
    videoPosterUrl?: string | null;
    /** Echo labels into the prompt so the builder does not invent stock photos */
    labels: { slot: string; simulated: boolean; approval: string }[];
  };
};
```

`buildSiteSystemPrompt` MUST:

- Pass signed **time-limited** or public-CDN URLs only for attached media.
- Instruct the builder to use these URLs for hero/gallery/video blocks when present.
- Forbid inventing product photography when FOUNDRY media is attached.
- If any attached asset is `simulated`, require visible SIMULATED/UNVERIFIED treatment on the page (same spirit as unverified product banner).

Revise flow: when attachments change, site editor SHOULD offer “Update page with new media” → `site.revise` with refreshed system prompt (not silent overwrite of user copy).

---

## 8. Generation pipeline

```
User (Launch → Marketing kit) or copilot tool
  → media.generateStills / generateVideo
  → MediaJob PENDING
  → worker (BullMQ queue "media-jobs" OR reuse chat-worker with job type)
  → MediaGenerationPort
  → ObjectStoragePort.put(key)
  → ProductMedia rows + MediaJob SUCCEEDED
  → optional auto-attach to site (if siteId passed)
```

**Storage key convention:**

`workspaces/{workspaceId}/projects/{projectId}/media/{mediaId}/{filename}`

**Copilot (optional v1.1):** tools `generate_marketing_stills` / `generate_product_video` that call the same mutations; must not claim engineering verification.

**CAD promote (v1.1):** `media.promoteCapture({ projectId, view: "iso"|"top", kind: "CAD_CAPTURE" })` using existing `screenshotRenderPage` → upload → `ProductMedia`.

---

## 9. UI surfaces

1. **Launch → Marketing kit** (new tab/section beside Releases):
   - Generate stills / video
   - Grid of `ProductMedia` with SIMULATED badges
   - Approve for marketing / delete
2. **Sites → Editor → Media panel**:
   - Attach from project library
   - Reorder gallery
   - Set hero / primary video
3. **Site library cards:** thumbnail = HERO attachment when present

Do not put this into the PCB/CAD editors as a primary path.

---

## 10. TypeScript package layout

```
packages/media/
  src/port.ts          # MediaGenerationPort
  src/simulated.ts     # SIMULATED adapter
  src/openai-image.ts  # optional adapter
  src/index.ts
  package.json

packages/domain/src/
  media.ts             # zod enums + input schemas
  events.ts            # new audit types
  capabilities.ts      # media.edit if added

packages/db/prisma/schema.prisma   # models above

apps/web/server/routers/media.ts
apps/web/server/media-jobs/        # enqueue + execute
apps/web/components/launch/marketing-kit.tsx
apps/web/components/sites/site-media-panel.tsx
apps/web/test/media-*.test.ts
```

---

## 11. Acceptance criteria

1. Creating stills via API inserts `ProductMedia` + storage object; list returns them for the project.
2. Attaching media to a site enforces workspace/project rules and sort order; detach removes join only (media remains).
3. `buildSiteSystemPrompt` includes attached media URLs and SIMULATED labels when applicable.
4. Unset generator keys → SIMULATED adapter; simulated video/still cannot be implied as real photography in prompt rules.
5. Deleting FOUNDRY-owned media removes storage object and attachments (cascade).
6. Audit events recorded for create/attach/detach/generate finish.
7. Unit tests cover attachment validation and prompt media section; at least one router test with mocked storage + generator.

---

## 12. Build order (small PRs)

| PR     | Deliverable                                                 | Status          |
| ------ | ----------------------------------------------------------- | --------------- |
| **M0** | Prisma models + domain zod + events; `db:push`              | Done            |
| **M1** | `packages/media` port + SIMULATED adapter + OpenAI adapter  | Done            |
| **M2** | tRPC `media.*` list/generate/approve/delete + tests         | Done            |
| **M3** | `media.attach/detach/reorder` + Sites Media panel           | Done            |
| **M4** | Extend `SiteProductContext` + revise-with-media             | Done            |
| **M5** | Launch marketing media UI                                   | Done            |
| **M6** | `generateVideo` + poster frame (synchronous; no worker yet) | Done            |
| **M7** | `promoteCapture` for CAD/PCB screenshots                    | Done (API only) |

Not built yet: background job execution (generation runs inside the request,
so long video jobs are bounded by the request timeout), copilot tools for
media, turnaround sequences, and uploads from the browser.

---

## 13. Decisions taken

1. **Capability:** reused `site.edit` for generate/delete/attach and
   `site.publish` for marketing approval. No new capability.
2. **Approval:** added `MediaApproval` (`DRAFT` / `APPROVED_FOR_MARKETING` /
   `REJECTED`) instead of overloading `VerificationState`, so a hero render can
   never read as engineering evidence. Only approved, non-simulated media is
   handed to the builder.
3. **Video provider:** OpenAI video behind the port, enabled only when
   `MEDIA_VIDEO_MODEL` is set. The SIMULATED adapter refuses video rather than
   faking footage.
4. **Public URLs:** signed storage URLs (7-day TTL) for the builder; the
   in-app UI uses the authenticated `/api/files/{key}` route.
5. **Release pinning:** FK `releaseId` only; release snapshot JSON untouched.

---

## 14. Relationship to production manuals

Production/assembly manuals are a **separate** Launch artifact (steps, Gerbers, BOM, PCB/CAD figures). They MAY embed `ProductMedia` or capture-derived stills by reference, but must not use marketing lifestyle shots as fab authority. Do not block this media PRD on the manual PRD.
