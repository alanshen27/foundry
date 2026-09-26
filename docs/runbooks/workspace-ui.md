# Workspace interface

The homepage is the visual source of truth: `apps/web/app/page.tsx`,
`apps/web/components/home-shell.tsx`, and the shared Foundry mark. Carry its paper
(`#faf9f5`), ink (`#0c0c0c`), signal orange (`#ff5a00`), square edges and fine
rules into the workspace through the shared theme tokens. Keep dark mode and
user-selected accents coherent with those same surface and control roles.

Use monospace for compact headings, navigation, command labels and engineering
metadata, with restrained tracking. Keep chat messages, instructions and other
reading text in sans serif. Reuse the mark and dot-matrix loading/empty states;
do not add a second brand header or decorative overlays above the geometry.

The viewport has priority. Assembly uses a compact docked component tree, CAD
commands sit against the header, and detailed controls appear on demand.
Measurement results and actionable errors may open a compact popover. Permanent
instruction cards and large forms do not belong over the canvas. Chat
starts at 352px, respects stored width preferences within the current viewport,
and becomes an overlay below 1024px so it does not squeeze the canvas away.
The resize separator supports Left/Right arrows and Home/End.

Orange identifies selection, progress and primary actions. Icons inherit their
control's color. User messages use a neutral surface; assistant replies use
unboxed text. Errors and engineering verification labels remain explicit.

## Design references

Reviewed via Mobbin MCP:

- [Framer canvas and compact property inspector](https://mobbin.com/screens/b9342420-e6c8-4183-8194-c56791fc13f8)
- [Rive hierarchy and aligned command strip](https://mobbin.com/screens/a21ef588-6033-4665-b4dc-c734fdac0220)
- [Linear neutral navigation and lightweight status treatment](https://mobbin.com/screens/fb06f720-0dcd-423f-bba9-83b54701bc4c)

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
