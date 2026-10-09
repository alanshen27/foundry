# Connected engineering

Opening the signed-in home returns to the last accessible project in Assembly.
If there is no remembered project, it opens the newest project in the home
workspace. An empty workspace still offers project creation. Explicit deep links
continue to open their requested document. Workspace navigation remains available.

The workflow strip stays 36 px high. Its inspector opens over the right edge
without resizing the canvas. Review links focus the affected document; Placement
shows one selected assembly instance at a time. Close it or press Escape to
return to the canvas.

## Schematic → PCB → CAD → assembly

1. In PCB, use **Update PCB from schematic**. Choose physical packages explicitly
   where no supported assignment exists. Existing IDs, placement, copper, sibling
   boards, and known package metadata are preserved.
2. Inspect a footprint to link its schematic part and map wired pins to pads.
   DRC and workflow readiness report missing parts, mappings, and inconsistent nets.
3. Set real board dimensions, corner radius, mounting holes, and known package
   heights. Unknown heights stay unknown. Drill export uses declared drill sizes.
4. In the workflow inspector, **Update CAD from boards** synchronizes every board
   to a stable generated CAD part: substrate, drills, and UNVERIFIED package
   envelopes for footprints with known body heights. Edited generated files report
   conflicts instead of being overwritten. Renaming a board does not change its
   generated path.
5. **Build linked assembly** imports actual manufacturing parts, including those
   board mockups, and writes the product assembly with labeled instances so
   Assembly can highlight a clicked component. Existing instance poses are
   retained; missing instances start at the origin. Use Placement or the copilot
   to set millimetres and global XYZ rotations — place each PCB in its pocket,
   not stacked at the origin with housings. Duplicate instances clone the source
   solid before transforms.
6. Review readiness, run appropriate engineering checks, and approve through
   Verify. A synchronized document is not proof of physical fit.

Linked assemblies do not solve mates, automatically design an enclosure, or
certify manufacturing tolerances. PCB CAD parts include declared outlines, holes,
and package envelopes when heights are known; those envelopes are still
UNVERIFIED. Envelopes sit on the board surface unless the footprint declares a
standoff (header pins, spacers, a display module); set it in the PCB inspector
or `save_pcb` and sync again to raise that body without moving the whole board.
The linked board solid alone does not prove enclosure clearance.

Parts outside the small built-in footprint library (display modules, tactile
switches, sensors) are installed per board with the copilot's
`install_pcb_footprint` tool, from one of three sources:

- the official KiCad library (`gitlab.com/kicad/libraries/kicad-footprints`);
- a `.kicad_mod` file on `raw.githubusercontent.com` / `github.com`;
- pads and outline read from a datasheet drawing, with its URL.

Downloads are limited to those hosts (each redirect re-checked), 1 MB, and
10 s. KiCad files carry no body height, so the seated height comes from the
datasheet. Installed footprints are stored in the board's `library`, labelled
UNVERIFIED with their source in the PCB inspector, and flow through DRC, Gerber
export and CAD envelopes like built-ins.
Optional Astra product previews are artistic previews and may differ from
manufacturing parts.

## Live edits and AI streaming

Code uses Y.Text; schematic, PCB, CAD/assembly metadata and design notes use stable
shared entity maps, arrays, and text fields. Each accepted websocket edit commits
the durable Yjs state, SQL read model, audit event, and verification invalidation
before broadcast. Reconnect uses the same CRDT identities. Redis wakes live rooms
for API/worker saves; a five-second reconciliation recovers missed notifications.
Membership and project-scoped permissions are rechecked on messages. Human writes
pause during an active branch AI lease. Disconnected editors pause until synced.

The copilot streams source drafts for CAD generation and code/design write tools.
Drafts are transient, visible to chat subscribers, and expandable on the canvas.
Incomplete Python/JSON never replaces saved geometry or triggers an engine export
per token. Successful tool completion applies validated content through the shared
state bridge. This is final-result collaboration plus live draft streaming, not
execution of partial tool arguments.

Without a collaboration URL, editors use local autosave through the same durable
bridge. Presence, chat, comments, verification and releases keep their existing
server/presence transports. They are not editable Yjs design documents. The shared
site prompt remains ephemeral. Geometry/media assets remain storage objects;
references to them are shared with the design.

## Required database update

Before deploying this version, apply:

`packages/db/prisma/changes/20260911-collaboration.sql`

This additive, idempotent SQL creates `CollaborationDocument`. It is required even
in local autosave mode. Do not deploy an older whole-document persistence server
alongside the new bridge. Web, worker and realtime must share database, Redis and
`AUTH_SECRET`. New local databases include the table via the normal Prisma push.

## Latency choices

Product-image extraction first reads bounded HTML metadata; a short cache avoids
repeat requests. It starts a browser only if metadata is insufficient, without a
fixed post-load wait. Public hosts and redirects are validated and DNS is pinned.
Images and extra camera views are optional context. Deterministic board/assembly
updates do not require a generation call. Geometry execution and final visual
checks remain available; renders do not stand in for engineering verification.

## Validation

Run the repository format, lint, typecheck and test scripts. The realtime package
includes protocol tests; collaboration tests cover concurrent fields/text,
persistence, authorization and first-edit seeding. The web tests cover electrical
mapping, preserved copper, all-board sync, assembly source protection, streaming,
and verification gates.

`apps/web/scripts/check-collaboration.mts` runs two actual websocket clients against
a disposable local database. It refuses a non-local database or one not named
`foundry_test`. Push the schema into that empty test database, start realtime with
the same environment, then run `pnpm --filter @foundry/web exec tsx scripts/check-collaboration.mts`.
It exercises code/PCB merges, stale-baseline API edits, pub/sub, reconnect, access
checks, AI lease rejection, and invalidation of old verification evidence.

The `/dev/engineering-lab` route uses synthetic in-memory data and is unavailable
in production. Its Playwright tests cover the connected UI and confirm opening the
inspector leaves canvas height unchanged. The Three.js test covers real GLB loading,
body picking, orbit controls, and screenshot capture using synthetic geometry.
