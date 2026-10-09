import "server-only";
import { z } from "zod";
import {
  PYTHON_ASSEMBLY_PATH,
  buildPythonProject,
  isPythonCadComponent,
  type CadDoc,
} from "@foundry/cad";
import { runPythonCad } from "@foundry/cad/server";
import { isHousingPart } from "@/lib/integration/seat-pcb";

/** Travel a held part must not be able to make without touching another part. */
export const LOOSE_PROBE_MM = 2;
/** Overlap below this is touching faces or kernel noise, not interference. */
export const COLLISION_MIN_MM3 = 0.5;

const CHECK_PATH = "foundry_fit_check.py";

const fitSchema = z.object({
  collisions: z.array(
    z.object({
      a: z.string(),
      b: z.string(),
      volumeMm3: z.number(),
      at: z.array(z.number()).length(3),
    }),
  ),
  loose: z.array(z.object({ part: z.string(), free: z.array(z.string()) })),
  truncated: z.boolean(),
});

export type AssemblyFit = z.infer<typeof fitSchema> & {
  status: "UNVERIFIED";
  checked: string;
};

/**
 * Interference and retention of the built assembly, measured on the exact
 * solids in the local kernel. The glass box on a display and the stem of a
 * button are ordinary solids here, so a display sunk into a lid frame shows as
 * a collision and a cap sitting in a clearance hole shows as loose.
 */
function checkerSource(probeInstanceIds: string[]): string {
  return `import json
from build123d import Box, Compound, Location, Vector
from assembly.product import result as assembly

PROBE = set(json.loads(${JSON.stringify(JSON.stringify(probeInstanceIds))}))
STEP = ${LOOSE_PROBE_MM}
MIN_VOLUME = ${COLLISION_MIN_MM3}
MAX_REPORTS = 24

def split_label(label):
    parts = (label or "").split(":", 3)
    if len(parts) == 4 and parts[0] == "foundry":
        return parts[2], parts[3]
    return None, label or "part"

# A translated Compound keeps its original child objects, so posed geometry
# comes from the instance itself; child labels only name its solids, matched in
# order and by volume.
def child_names(item, sub, out):
    kids = list(getattr(item, "children", None) or [])
    if kids:
        for kid in kids:
            child_names(kid, getattr(kid, "label", "") or sub, out)
        return
    for solid in item.solids():
        out.append((sub, solid.volume))

instances = []
for child in getattr(assembly, "children", None) or []:
    instance_id, name = split_label(getattr(child, "label", ""))
    posed = child.solids()
    names = []
    child_names(child, "", names)
    matched = len(names) == len(posed) and all(
        abs(volume - solid.volume) <= 1e-6 * max(1.0, volume) for (_, volume), solid in zip(names, posed)
    )
    solids = [
        (names[index][0] if matched else "", solid, solid.bounding_box())
        for index, solid in enumerate(posed)
    ]
    instances.append({"id": instance_id, "name": name, "solids": solids})

def overlaps(a, b, pad=0.0):
    return (a.min.X < b.max.X + pad and b.min.X < a.max.X + pad and
            a.min.Y < b.max.Y + pad and b.min.Y < a.max.Y + pad and
            a.min.Z < b.max.Z + pad and b.min.Z < a.max.Z + pad)

# Disjoint overlaps (a board on four bosses) come back as a ShapeList.
def pieces(a, b):
    try:
        common = a.intersect(b)
    except Exception:
        return []
    if common is None:
        return []
    return list(common) if isinstance(common, (list, tuple)) else [common]

def shared(a, b):
    total = 0.0
    for piece in pieces(a, b):
        try:
            total += float(piece.volume)
        except Exception:
            pass
    return total

def title(instance, sub):
    return instance["name"] + (" / " + sub if sub and sub != instance["name"] else "")

collisions = []
truncated = False
for i, first in enumerate(instances):
    for second in instances[i + 1:]:
        for sub_a, solid_a, box_a in first["solids"]:
            for sub_b, solid_b, box_b in second["solids"]:
                if not overlaps(box_a, box_b, -0.01):
                    continue
                volume = shared(solid_a, solid_b)
                if volume <= MIN_VOLUME:
                    continue
                if len(collisions) >= MAX_REPORTS:
                    truncated = True
                    continue
                center = Compound(pieces(solid_a, solid_b)).bounding_box().center()
                collisions.append({
                    "a": title(first, sub_a),
                    "b": title(second, sub_b),
                    "volumeMm3": round(volume, 2),
                    "at": [round(center.X, 2), round(center.Y, 2), round(center.Z, 2)],
                })

DIRECTIONS = {"+X": (1, 0, 0), "-X": (-1, 0, 0), "+Y": (0, 1, 0), "-Y": (0, -1, 0), "+Z": (0, 0, 1), "-Z": (0, 0, -1)}
loose = []
for instance in instances:
    if instance["id"] not in PROBE:
        continue
    others = [item for item in instances if item is not instance]
    free = []
    for name, (dx, dy, dz) in DIRECTIONS.items():
        shift = Location(Vector(dx * STEP, dy * STEP, dz * STEP))
        blocked = False
        for _, solid, box in instance["solids"]:
            moved = solid.moved(shift)
            moved_box = moved.bounding_box()
            for other in others:
                for _, other_solid, other_box in other["solids"]:
                    if not overlaps(moved_box, other_box):
                        continue
                    if shared(moved, other_solid) > 0.05:
                        blocked = True
                        break
                if blocked:
                    break
            if blocked:
                break
        if not blocked:
            free.append(name)
    if free:
        loose.append({"part": instance["name"], "free": free})

print("FOUNDRY_FIT:" + json.dumps({"collisions": collisions, "loose": loose, "truncated": truncated}), flush=True)
result = Box(1, 1, 1)
`;
}

export async function checkAssemblyFit(doc: CadDoc): Promise<AssemblyFit | { error: string }> {
  const assembly = doc.components.find((part) => part.path === PYTHON_ASSEMBLY_PATH);
  if (!assembly || !doc.assembly) return { error: "No native assembly to check." };
  const parts = new Map(doc.components.map((part) => [part.id, part]));
  const probe = doc.assembly.instances
    .filter((instance) => {
      const part = parts.get(instance.componentId);
      return (
        instance.visible &&
        !instance.fixed &&
        part !== undefined &&
        isPythonCadComponent(part) &&
        !isHousingPart(part)
      );
    })
    .map((instance) => instance.id);
  let project;
  try {
    project = buildPythonProject(doc, PYTHON_ASSEMBLY_PATH);
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Assembly source is incomplete." };
  }
  if (project.meshAssets.length) {
    return { error: "Fit check skipped: the assembly imports mesh files." };
  }
  const run = await runPythonCad({
    files: { ...project.files, [CHECK_PATH]: checkerSource(probe) },
    entryPath: CHECK_PATH,
    timeoutMs: 120_000,
  });
  if (!run.ok) return { error: `Fit check could not run: ${run.error}` };
  const line = run.data.logs
    .split("\n")
    .reverse()
    .find((entry) => entry.startsWith("FOUNDRY_FIT:"));
  if (!line) return { error: "Fit check produced no report." };
  const parsed = fitSchema.safeParse(JSON.parse(line.slice("FOUNDRY_FIT:".length)));
  if (!parsed.success) return { error: "Fit check returned an unexpected report." };
  return {
    ...parsed.data,
    status: "UNVERIFIED",
    checked: `Exact-solid interference over ${COLLISION_MIN_MM3} mm³ between instances, and whether each non-housing part can move ${LOOSE_PROBE_MM} mm in any direction without touching another part. Screws, adhesives and snaps that are not modelled do not count.`,
  };
}
