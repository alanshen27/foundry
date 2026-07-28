/**
 * End-to-end smoke test for the PCB pipeline, with no database or web server:
 * place two parts, route them, check DRC, and write real fabrication files.
 *
 * Run with:  pnpm --filter @foundry/web exec tsx scripts/pcb-demo.ts
 * Output:    apps/web/.pcb-demo/  (open the .gbr files in any Gerber viewer)
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { CircuitDoc } from "@/lib/circuit/catalog";
import { normalizePcbDoc } from "@/lib/pcb/doc";
import { buildRatsnest, padNetMap } from "@/lib/pcb/netlist";
import { runDrc } from "@/lib/pcb/drc";
import { fabricationFiles } from "@/lib/pcb/export";
import { boardPads } from "@/lib/pcb/geometry";

/**
 * Three resistors: R1.2-R2.1 is one net, R1.1-R3.1 another. Two nets meeting at
 * R1 is what makes the deliberate short in step 3 a real short — copper joining
 * pads that carry different net names.
 */
const circuit: CircuitDoc = {
  version: 2,
  parts: [
    { id: "r1", type: "wokwi-resistor", label: "R1", x: 0, y: 0 },
    { id: "r2", type: "wokwi-resistor", label: "R2", x: 200, y: 0 },
    { id: "r3", type: "wokwi-resistor", label: "R3", x: 0, y: 200 },
  ],
  wires: [
    { id: "w1", from: { part: "r1", pin: "2" }, to: { part: "r2", pin: "1" } },
    { id: "w2", from: { part: "r1", pin: "1" }, to: { part: "r3", pin: "1" } },
  ],
};

const placed = normalizePcbDoc({
  board: { widthMm: 40, heightMm: 25, thicknessMm: 1.6, cornerRadiusMm: 2 },
  footprints: [
    { id: "f1", libraryId: "R_0603", refDes: "R1", xMm: 12, yMm: 12, rotationDeg: 0, side: "front", partId: "r1" },
    { id: "f2", libraryId: "R_0603", refDes: "R2", xMm: 26, yMm: 12, rotationDeg: 0, side: "front", partId: "r2" },
    { id: "f3", libraryId: "R_0603", refDes: "R3", xMm: 12, yMm: 20, rotationDeg: 0, side: "front", partId: "r3" },
  ],
});

const pads = boardPads(placed.footprints);
const show = (label: string, doc: typeof placed) => {
  const rats = buildRatsnest(circuit, doc);
  const drc = runDrc(doc, rats);
  console.log(`\n=== ${label} ===`);
  console.log(`routed      ${rats.routedCount}/${rats.totalConnections}`);
  console.log(`airwires    ${rats.airwires.length}`);
  console.log(`DRC         ${drc.errorCount} errors, ${drc.warningCount} warnings`);
  for (const v of drc.violations) console.log(`  [${v.severity}] ${v.rule}: ${v.message}`);
  return { rats, drc };
};

console.log("Pad positions (routing must land exactly on these):");
for (const p of pads) console.log(`  ${p.refDes}.${p.pin}  x=${p.xMm}  y=${p.yMm}  ${p.layers.join("/")}`);

show("1. Placed, nothing routed", placed);

// Route both nets, landing exactly on the pad centres printed above.
const at = (refDes: string, pin: string) => {
  const p = pads.find((q) => q.refDes === refDes && q.pin === pin)!;
  return { xMm: p.xMm, yMm: p.yMm };
};

const routed = normalizePcbDoc({
  ...placed,
  tracks: [
    { id: "t1", net: "N$1", layer: "F.Cu", widthMm: 0.25, points: [at("R1", "2"), at("R2", "1")] },
    // R1.1 down to R3.1, routed around the body rather than through it.
    {
      id: "t2",
      net: "N$2",
      layer: "F.Cu",
      widthMm: 0.25,
      points: [at("R1", "1"), { xMm: 9, yMm: 12 }, { xMm: 9, yMm: 20 }, at("R3", "1")],
    },
  ],
});
show("2. Routed", routed);

// Deliberately short two nets to prove DRC catches copper it should not allow.
const shorted = normalizePcbDoc({
  ...routed,
  tracks: [
    ...routed.tracks,
    {
      id: "t3",
      layer: "F.Cu",
      widthMm: 0.25,
      // Straight across R1's own body, tying N$2 (pad 1) to N$1 (pad 2).
      points: [at("R1", "1"), at("R1", "2")],
    },
  ],
});
show("3. With a deliberate short", shorted);

// A GND pour: R1.1 and R3.1 are both on N$2, so flooding the board joins them
// without a track and clears around the N$1 copper.
const poured = normalizePcbDoc({
  ...placed,
  zones: [
    {
      id: "z1",
      net: "N$2",
      layer: "F.Cu",
      points: [
        { xMm: 1, yMm: 1 },
        { xMm: 39, yMm: 1 },
        { xMm: 39, yMm: 24 },
        { xMm: 1, yMm: 24 },
      ],
    },
  ],
  tracks: [routed.tracks[0]!],
});
show("4. N$2 poured instead of routed", poured);

const outDir = join(process.cwd(), ".pcb-demo");
mkdirSync(outDir, { recursive: true });
for (const file of fabricationFiles(poured, "demo", padNetMap(circuit, poured))) {
  writeFileSync(join(outDir, file.name), file.contents);
}
console.log(`\nFabrication files written to ${outDir}`);
