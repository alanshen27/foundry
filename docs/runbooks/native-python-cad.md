# Native Python CAD

Foundry generates editable Python with Astra and evaluates it locally with
build123d 0.9.1 / OpenCascade. Three.js displays the resulting STL. STEP exports
come from the exact solid, not a reconstruction of the display mesh. No application
CAD entry point calls Zoo, even if an old `ZOO_API_TOKEN` remains configured.

## Local runtime

The web process and chat worker need macOS and `uv` on their PATH. Prewarm once:

```sh
uv run --no-project --python 3.12 --with build123d==0.9.1 --with ocpsvg==0.5.0 python -c "import build123d"
```

`OPENAI_API_KEY` and `CAD_MODEL=gpt-6-astra` are needed only for generation. Geometry
evaluation is local. The first build resolves the pinned runtime; subsequent builds
reuse it, though Python/OpenCascade startup and solid operations still take time.
This is not an instant browser geometry kernel.

Generated source runs under the macOS OS sandbox, with no network, no child
processes, no application credentials, and no access to the host project or home
files. The pinned runtime is read-only; each job gets its own writable directory.
Limits include 60 seconds CPU, a 120-second default wall timeout, 64 MiB per output
file, 128 KB of logs, and a sampled 2 GiB resident-memory watchdog. The memory
watchdog is not a hard container memory limit. Cancelled jobs terminate their
process group and clean up the temporary directory.

Non-macOS hosts fail closed. A Linux/Render deployment requires a separately
restricted CAD worker; do not replace this with unsandboxed generated Python.
Keep the existing hosted queue worker paused when using the local-only worker.

## Source and collaboration

Use identifier-safe paths such as `parts/recorder_base/main.py`. Assign the final
build123d `Shape` or `Builder` to `result`; units are millimetres. Name the dimensions
that users will adjust. Linked assemblies use `assembly/product.py` and import
the actual part modules with explicit placements. They do not solve mating
constraints, collisions, or manufacturing tolerances.

After each `build_linked_assembly`, a local fit check runs in the same sandbox
outside the design lock (a few seconds for a small enclosure). It reports exact
solid overlaps above 0.5 mm³ between instances, named down to the PCB package
(`Board / DS1 glass`), and every non-housing, non-fixed part that can move 2 mm
in some direction without touching another part. The copilot must fix these by
changing geometry. The report is `UNVERIFIED`: fasteners that are not modelled
do not count, and an empty report is not a tolerance analysis. Assemblies that
import mesh files are skipped. Display modules installed with `glass` are drawn
as a carrier with a smaller glass box on top, so a lid window sized to the
glass shows the carrier as a collision until the frame underside is pocketed.

Python source stays in the same Yjs/SQL document as other engineering state.
Generation streams drafts without evaluating partial code. Generated geometry is
checked locally before saving; invalid or cancelled generation leaves previous
source intact. Manual code edits can temporarily be invalid and remain editable.
The viewport keeps the previous geometry on screen while rebuilding the same part
and does not substitute an unrelated placeholder box.

Display colour comes only from build123d `shape.color` (`Color(r, g, b[, a])` or
a named colour) on `result` or on children of a `Compound`; children and solids
inherit their parent's colour. The driver packs one RGBA value per solid into the
labeled mesh (`FDRYMSH2`), and uncoloured solids render neutral grey. Colour is a
display finish, not engineering evidence.

The native loader includes transitive local Python modules and literal CAD asset
imports. STEP/BREP import preserves exact geometry. STL/GLB imports can display
directly as meshes; importing a mesh does not create editable manufacturing solids.
Private assets require the owning project's authorization before cache access.

Existing KCL files remain preserved. Convert or regenerate selected parts into new
`.py` files before native editing. Native linked assemblies exclude legacy KCL and
report it in readiness; an explicit legacy assembly instance requires conversion.
There is no automatic, lossless KCL translator. The source-managed PCB synchronizer
also reports a conflict rather than overwriting an existing KCL/custom board.

## Preview and export

The browser caches recent scenes; the server deduplicates identical in-flight
builds and caches successful STL/STEP snapshots for five minutes, up to 32 entries
and 50 MB. Cache keys include project, source, dependency files, and asset references.
Authorization is checked on every request. Cancelling one viewer does not stop a
build still used by another viewer. Failed/cancelled jobs are not cached.

Use the CAD editor's Measure and Export controls for local bounding dimensions and
STEP/STL downloads. The code editor loads only when opened. Generated solids must
be nonempty and valid with positive volume; these checks do not prove electrical
correctness, assembly fit, safety, or manufacturability.

## Verification

`/dev/python-cad-lab` uses synthetic source and the real sandboxed kernel, with a
dimension toggle. `/dev/workspace-ui-lab` is a synthetic UI fixture and does not
measure kernel performance. Both routes are development-only.

```sh
# From apps/web; opt in to executing known synthetic source locally.
RUN_PYTHON_CAD_INTEGRATION=1 pnpm exec vitest run --no-cache test/python-cad-integration.test.ts
```

References: [build123d](https://build123d.readthedocs.io/en/latest/),
[imports and exact exports](https://build123d.readthedocs.io/en/latest/import_export.html),
[joint placement semantics](https://build123d.readthedocs.io/en/latest/joints.html).
