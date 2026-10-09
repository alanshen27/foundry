# Workspace interface

The homepage is the visual source of truth: `apps/web/app/page.tsx`,
`apps/web/components/home-shell.tsx`, and the shared Foundry mark. Carry its paper
(`#faf9f5`), ink (`#0c0c0c`), signal orange (`#ff5a00`), square edges and fine
rules into the workspace through the shared theme tokens. Keep dark mode and
user-selected accents coherent with those same surface and control roles.

The public page is one full-viewport split: a short sans-serif headline and one
action on the left, the live monospace glyph filling the orange panel on the right.
The four phases sit with the headline. It is not a centered column.
Workspace home leads with the workspace name, a full-width prompt aligned to
that title, then the project grid. The main column fills the pane beside the
sidebar. Do not center a narrower block inside it, and do not stack a second
poster, a full-bleed animated dot field, or another orange band on top. Workspace
pages use the static dot field.

Use monospace for labels, command chrome, engineering metadata, and the glyph
animations. Page titles and reading text stay in sans serif. Reuse the mark and
dot-matrix loading/empty states; do not add a second brand header or decorative
overlays above the geometry.

The viewport has priority. Assembly is the home surface. Other documents open
from one window menu (or Cmd+K) instead of a second stage rail. CAD commands
sit against the header, and detailed controls appear on demand.
Measurement results and actionable errors may open a compact popover. Permanent
instruction cards and large forms do not belong over the canvas. Chat
starts at 352px, respects stored width preferences within the current viewport,
and becomes an overlay below 1024px so it does not squeeze the canvas away.
The resize separator supports Left/Right arrows and Home/End.

Orange identifies selection, progress and primary actions. Icons inherit their
control's color. User messages use a neutral surface; assistant replies use
unboxed text. Errors and engineering verification labels remain explicit.

## Workspace management

The sidebar and workspace switchers open **Manage workspaces** in a dialog.
Creating or renaming a workspace keeps the current route and any open project
in place. Use **Open** to explicitly switch workspaces. Renaming only changes
the display name; workspace slugs and project URLs stay stable. Rename access
uses the workspace-wide `project.manage` capability and records an audit event.
The manager loads on demand, and the shared switcher stays independent of the
project/chat shell so workspace home does not load those dependencies.

## Design references

Reviewed via Mobbin MCP:

- [Greptile landing: one headline beside a single graphic](https://mobbin.com/screens/ddd061c9-6056-4cd2-a671-4f433c84f2de)
- [Vercel new project: quiet prompt, then the work](https://mobbin.com/screens/d14355dd-09ee-4b06-9d3a-ef8d3b227be9)
- [Linear projects: neutral sidebar and a calm list](https://mobbin.com/screens/3d3a4fae-d824-440a-961b-001c6b715a4a)
- [Framer canvas and compact property inspector](https://mobbin.com/screens/b9342420-e6c8-4183-8194-c56791fc13f8)

These inform layout and visual hierarchy. They do not replace the homepage's
typography, colors, engineering controls or industrial identity.

## Local UI checks

`/dev/workspace-ui-lab` provides a labeled simulated workspace with local geometry
and synthetic chat for deterministic UI checks. It is unavailable in production.
Its scoped dependencies avoid model, database and remote collaboration calls;
normal workspaces keep their existing production dependencies.

Compare homepage, workspace home and project chrome in the same light/dark
theme. Check desktop and narrow widths, keyboard document navigation, chat
toggling/resizing, CAD toolbar disclosure and assembly selection. Monospace
labels must not cause another toolbar row: retain tab scrolling, a reachable
window menu, truncated long project/branch names, and on-demand code panels.
Check that popovers do not obscure or clip the camera controls and that Retina
canvas CSS dimensions still match the viewport after panel resizing.

The existing `e2e/workspace-ui.spec.ts` covers viewport layout and native CAD
controls. Pure style changes need visual comparison, not new behavior tests.
A visual fixture does not verify real CAD generation, manufacturing validity
or hosted chat behavior.
