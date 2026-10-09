import { describe, expect, it, vi } from "vitest";
import { buildLinkedAssembly, pythonCadDoc, upsertPartScript, type CadDoc } from "@foundry/cad";

vi.mock("server-only", () => ({}));

const LID = `from build123d import Box, Cylinder, Align
# 40 x 40 plate, 2 mm thick, with a 9 mm hole at the centre.
result = Box(40, 40, 2, align=(Align.CENTER, Align.CENTER, Align.MIN)) - Cylinder(4.5, 2, align=(Align.CENTER, Align.CENTER, Align.MIN))
`;
const CAP = `from build123d import Cylinder, Align
result = Cylinder(4.1, 4, align=(Align.CENTER, Align.CENTER, Align.MIN))
`;
const FLANGED_CAP = `from build123d import Cylinder, Pos, Align
result = Cylinder(4.1, 4, align=(Align.CENTER, Align.CENTER, Align.MIN)) + Pos(0, 0, -1) * Cylinder(6, 1, align=(Align.CENTER, Align.CENTER, Align.MIN))
`;
const BLOCK = `from build123d import Box
result = Box(6, 6, 6)
`;
const BOARD = `from build123d import Box, Compound, Pos, Align
board = Box(10, 10, 1, align=(Align.CENTER, Align.CENTER, Align.MIN))
board.label = "board"
chip = Pos(0, 0, 1) * Box(2, 2, 2, align=(Align.CENTER, Align.CENTER, Align.MIN))
chip.label = "U1"
result = Compound(children=[board, chip])
`;

const TWO_BOSS_BASE = `from build123d import Box, Cylinder, Pos, Align
floor = Box(40, 40, 2, align=(Align.CENTER, Align.CENTER, Align.MIN))
bosses = [Pos(x, 0, 2) * Cylinder(2.5, 6, align=(Align.CENTER, Align.CENTER, Align.MIN)) for x in (-15, 15)]
result = floor + bosses[0] + bosses[1]
`;
const PLAIN_BOARD = `from build123d import Box, Align
result = Box(36, 10, 1.6, align=(Align.CENTER, Align.CENTER, Align.MIN))
`;

type Placed = { name: string; source: string; x?: number; z: number; fixed?: boolean };

function product(parts: Placed[]): CadDoc {
  let doc = pythonCadDoc();
  for (const part of parts) doc = upsertPartScript(doc, part.name, part.source);
  return buildLinkedAssembly(
    doc,
    parts.map((part) => ({
      id: `i-${part.name}`,
      componentId: doc.components.find((c) => c.name === part.name)!.id,
      translationMm: { x: part.x ?? 0, y: 0, z: part.z },
      rotationDeg: { x: 0, y: 0, z: 0 },
      visible: true,
      fixed: part.fixed ?? false,
    })),
  );
}

async function fitOf(parts: Placed[]) {
  const { checkAssemblyFit } = await import("@/server/assembly-fit");
  const fit = await checkAssemblyFit(product(parts));
  if ("error" in fit) throw new Error(fit.error);
  return fit;
}

const lid: Placed = { name: "enclosure_lid", source: LID, z: 0, fixed: true };

// Opt-in local kernel check. No model APIs, project storage, or database are used.
describe.skipIf(process.env.RUN_PYTHON_CAD_INTEGRATION !== "1")("assembly fit check", () => {
  it("reports a block sunk into the lid and a cap with nothing holding it", async () => {
    const fit = await fitOf([
      lid,
      { name: "button_cap", source: CAP, z: 0 },
      { name: "spacer_block", source: BLOCK, x: 12, z: 1 },
    ]);
    expect(fit.status).toBe("UNVERIFIED");
    expect(fit.collisions).toEqual([
      expect.objectContaining({ a: "enclosure_lid", b: "spacer_block" }),
    ]);
    expect(fit.collisions[0]!.volumeMm3).toBeGreaterThan(10);
    const cap = fit.loose.find((entry) => entry.part === "button_cap");
    expect(cap?.free.sort()).toEqual(["+Z", "-Z"]);
    expect(fit.loose.some((entry) => entry.part === "enclosure_lid")).toBe(false);
  }, 130_000);

  it("stops reporting +Z once a flange traps the cap under the face", async () => {
    const fit = await fitOf([lid, { name: "button_cap", source: FLANGED_CAP, z: 0 }]);
    expect(fit.collisions).toEqual([]);
    // Only the switch below (not modelled here) would stop it pressing in.
    expect(fit.loose.find((entry) => entry.part === "button_cap")?.free).toEqual(["-Z"]);
  }, 130_000);

  it("treats a board resting on two separate bosses as supported from below", async () => {
    // Pushing the board down meets both bosses: the overlap comes back in two pieces.
    const fit = await fitOf([
      { name: "enclosure_base", source: TWO_BOSS_BASE, z: 0, fixed: true },
      { name: "sensor_board", source: PLAIN_BOARD, z: 8 },
    ]);
    expect(fit.collisions).toEqual([]);
    expect(fit.loose.find((entry) => entry.part === "sensor_board")?.free).not.toContain("-Z");
  }, 130_000);

  it("checks a board's labelled children at the posed height, not the source height", async () => {
    const raised = await fitOf([lid, { name: "sensor_board", source: BOARD, x: 12, z: 20 }]);
    expect(raised.collisions).toEqual([]);
    const sunk = await fitOf([lid, { name: "sensor_board", source: BOARD, x: 12, z: 1.5 }]);
    // Posed at 1.5 mm the chip starts at 2.5 mm, above the 2 mm lid; unposed it would hit too.
    expect(sunk.collisions.map((hit) => `${hit.a} x ${hit.b}`)).toEqual([
      "enclosure_lid x sensor_board / board",
    ]);
  }, 130_000);
});
