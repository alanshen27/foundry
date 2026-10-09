/**
 * Does the board physically fit in the enclosure?
 *
 * Every other stage already checks itself — DRC keeps copper on the board,
 * courtyard checks keep parts from overlapping each other — but nothing asked
 * the question a mechanical engineer asks first: will this board, with these
 * parts on it, go into this box? A 70 mm board and a 68 mm cavity both look
 * fine in their own editors. They only meet at assembly, which for a hardware
 * product means after the enclosure has been printed.
 *
 * The check is arithmetic over declared dimensions, so it is deterministic and
 * runs in the fit check with no engine call:
 *
 * - The cavity comes from the enclosure part's own top-level KCL parameters —
 *   explicit `inner_width / inner_length / inner_height`, or outer
 *   `width / length / height` minus `wall_thickness` (and `floor_thickness`).
 *   These are the same parameters the model editor exposes as sliders, so a
 *   person dragging `width` down immediately changes what this reports.
 * - The board comes from the PCB outline, and its height stack from the
 *   standoff, the board thickness and the tallest seated part.
 *
 * What it refuses to do is guess. If the enclosure declares outer dimensions
 * but no wall thickness, the cavity is unknown — assuming a zero wall would
 * make a board that does not fit report as fitting, which is worse than no
 * check. Part heights are typical datasheet values, so every number derived
 * from them is labelled ESTIMATED.
 */

import { parseCadParams } from "@foundry/cad";
import { PCB_STANDOFF_MM } from "@/lib/cad/final-assembly";
import { footprintDef, type PcbSet } from "@/lib/pcb/doc";
import { cadPartKey, footprintKey } from "@/lib/graph/types";
import type { FitFinding } from "./fit-check";

/** Below this per-side gap a printed or moulded part may not close over the board. */
export const MIN_SIDE_CLEARANCE_MM = 0.5;
/** Headroom above the tallest part before it is too tight to call comfortable. */
export const MIN_TOP_CLEARANCE_MM = 1;

export type EnclosureFitInput = {
  pcb: PcbSet | null;
  cad: { path: string; name: string; kind: string; content?: string }[];
};

export type Cavity = {
  x: number;
  y: number;
  /** Null when the enclosure declares no height; XY can still be checked. */
  z: number | null;
  /** PCB standoff declared by the enclosure, if any. */
  standoff: number | null;
  /** The parameters the cavity was computed from, for the message. */
  basis: string[];
};

export type CavityResolution = { ok: true; cavity: Cavity } | { ok: false; reason: string };

const ENCLOSURE_WORDS = /(enclosure|case|housing|shell|chassis|body|box)/i;
const NOT_ENCLOSURE_WORDS =
  /(lid|cover|cap|door|window|bay|button|knob|bracket|clip|foot|feet|gasket|standoff|mount)/i;

/** KCL's `@settings(defaultLengthUnit = …)`, as a factor to millimetres. */
function lengthUnitFactor(script: string): number {
  const match = /defaultLengthUnit\s*=\s*(mm|cm|m|in|ft|yd)\b/.exec(script);
  const unit = match?.[1] ?? "mm";
  return { mm: 1, cm: 10, m: 1000, in: 25.4, ft: 304.8, yd: 914.4 }[unit] ?? 1;
}

const INNER_PREFIX = /^(inner|internal|interior|inside|cavity)_/;

/**
 * One spelling for every naming style a KCL author uses: `innerWidth`,
 * `inner_width` and `caseInnerWidth` all become `inner_width`. Zoo's own
 * generated files are camelCase and usually prefix the object's name.
 */
export function normalizeParamName(name: string): string {
  return name
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .toLowerCase()
    .replace(/^(case|enclosure|box|shell|body|housing|chassis)_/, "");
}

function numericParams(script: string): Map<string, number> {
  const factor = lengthUnitFactor(script);
  const params = new Map<string, number>();
  for (const p of parseCadParams(script)) {
    if (typeof p.value !== "number" || !Number.isFinite(p.value)) continue;
    const name = normalizeParamName(p.name);
    // First declaration wins, matching how the file reads top to bottom.
    if (!params.has(name)) params.set(name, p.value * factor);
  }
  return params;
}

function pick(
  params: Map<string, number>,
  names: string[],
): { name: string; value: number } | null {
  for (const name of names) {
    const value = params.get(name);
    if (value !== undefined && value > 0) return { name, value };
  }
  return null;
}

const fmt = (mm: number) => `${Math.round(mm * 10) / 10} mm`;

/**
 * Reads an enclosure's cavity from its declared parameters.
 * Pure: the script text in, the cavity (or the reason there is none) out.
 */
export function resolveCavity(script: string): CavityResolution {
  const params = numericParams(script);
  if (params.size === 0) {
    return { ok: false, reason: "it declares no top-level dimension parameters" };
  }

  const inner = new Map<string, number>();
  const outer = new Map<string, number>();
  for (const [name, value] of params) {
    if (INNER_PREFIX.test(name)) inner.set(name.replace(INNER_PREFIX, ""), value);
    else outer.set(name, value);
  }

  const WIDTH = ["width", "w", "size_x", "x_size"];
  const LENGTH = ["length", "l", "size_y", "y_size"];
  const HEIGHT = ["height", "h", "size_z", "z_size"];
  // "depth" means Y in some conventions and Z in others; resolve by what else
  // is declared rather than picking one and being wrong half the time.
  const axis = (source: Map<string, number>) => {
    const x = pick(source, WIDTH);
    let y = pick(source, LENGTH);
    let z = pick(source, HEIGHT);
    const depth = pick(source, ["depth", "d"]);
    if (depth && !y && z) y = depth;
    else if (depth && y && !z) z = depth;
    else if (depth && !y && !z) y = depth;
    return { x, y, z };
  };

  const standoff = pick(params, ["standoff_height", "standoff", "pcb_standoff", "standoff_h"]);
  const basis: string[] = [];
  const note = (p: { name: string; value: number }, inner = false) =>
    basis.push(`${inner ? "inner_" : ""}${p.name} = ${fmt(p.value)}`);

  const fromInner = axis(inner);
  if (fromInner.x && fromInner.y) {
    note(fromInner.x, true);
    note(fromInner.y, true);
    if (fromInner.z) note(fromInner.z, true);
    return {
      ok: true,
      cavity: {
        x: fromInner.x.value,
        y: fromInner.y.value,
        z: fromInner.z?.value ?? null,
        standoff: standoff?.value ?? null,
        basis,
      },
    };
  }

  const fromOuter = axis(outer);
  if (!fromOuter.x || !fromOuter.y) {
    return {
      ok: false,
      reason:
        "it names neither its inner cavity (inner_width, inner_length) nor its outer size (width, length)",
    };
  }
  const wall =
    pick(outer, ["wall_thickness", "wall", "wall_t", "shell_thickness"]) ??
    // A bare `thickness` on an enclosure is almost always the wall, but only
    // when it is plausibly small; a 40 mm "thickness" is an outer dimension.
    (() => {
      const t = pick(outer, ["thickness"]);
      return t && t.value < 10 ? t : null;
    })();
  if (!wall) {
    return {
      ok: false,
      reason: `it gives its outer size but no wall thickness, so the cavity cannot be computed (a zero wall would overstate it)`,
    };
  }
  const floor =
    pick(outer, ["floor_thickness", "base_thickness", "bottom_thickness", "floor"]) ?? wall;

  note(fromOuter.x);
  note(fromOuter.y);
  if (fromOuter.z) note(fromOuter.z);
  note(wall);
  if (floor !== wall) note(floor);

  return {
    ok: true,
    cavity: {
      x: fromOuter.x.value - 2 * wall.value,
      y: fromOuter.y.value - 2 * wall.value,
      // Open-topped shell: the lid is its own part, so only the floor comes off.
      z: fromOuter.z ? fromOuter.z.value - floor.value : null,
      standoff: standoff?.value ?? null,
      basis,
    },
  };
}

/** The parts that could be the enclosure, most likely first. */
export function enclosureCandidates(cad: EnclosureFitInput["cad"]) {
  return cad.filter((c) => {
    if (c.kind !== "part" || !c.content?.trim()) return false;
    const label = `${c.name} ${c.path}`;
    return ENCLOSURE_WORDS.test(label) && !NOT_ENCLOSURE_WORDS.test(label);
  });
}

export function checkEnclosureFit(input: EnclosureFitInput): FitFinding[] {
  const boards = input.pcb?.boards ?? [];
  if (boards.length === 0) return [];
  const candidates = enclosureCandidates(input.cad);
  if (candidates.length === 0) return [];

  // Several enclosure-like parts can resolve (shell and inner frame, say);
  // the board has to fit the one it goes into, which is the largest cavity.
  const resolved = candidates
    .map((part) => ({ part, result: resolveCavity(part.content ?? "") }))
    .filter(
      (r): r is { part: (typeof candidates)[number]; result: { ok: true; cavity: Cavity } } =>
        r.result.ok,
    )
    .sort((a, b) => b.result.cavity.x * b.result.cavity.y - a.result.cavity.x * a.result.cavity.y);

  if (resolved.length === 0) {
    const first = candidates[0]!;
    const reason = (resolveCavity(first.content ?? "") as { ok: false; reason: string }).reason;
    return [
      {
        domain: "MECHANICAL",
        severity: "info",
        message: `Could not check whether the board fits ${first.path}: ${reason}.`,
        hint: "Declare inner_width, inner_length and inner_height (or width, length, height and wall_thickness) at the top of the enclosure's KCL.",
        nodes: [{ refKey: cadPartKey(first.path), label: first.path }],
      },
    ];
  }

  const { part, result } = resolved[0]!;
  const cavity = result.cavity;
  const enclosureNode = { refKey: cadPartKey(part.path), label: part.path };
  const findings: FitFinding[] = [];

  for (const [boardIndex, board] of boards.entries()) {
    // "Main board" at the start of a sentence and in the middle of one; the
    // generic fallback needs its article lowered mid-sentence.
    const subject =
      board.name?.trim() || (boards.length > 1 ? `Board ${boardIndex + 1}` : "The board");
    const mid = subject === "The board" ? "the board" : subject;
    const w = board.board.widthMm;
    const h = board.board.heightMm;

    // ---- plan view: try both orientations ----
    const straight = { x: (cavity.x - w) / 2, y: (cavity.y - h) / 2 };
    const turned = { x: (cavity.x - h) / 2, y: (cavity.y - w) / 2 };
    const minGap = (g: { x: number; y: number }) => Math.min(g.x, g.y);
    const best = minGap(straight) >= minGap(turned) ? straight : turned;
    const rotated = best === turned && minGap(straight) < 0;

    if (minGap(best) < 0) {
      const shortX = Math.max(0, -2 * straight.x);
      const shortY = Math.max(0, -2 * straight.y);
      findings.push({
        domain: "MECHANICAL",
        severity: "error",
        message: `${subject} (${fmt(w)} × ${fmt(h)}) does not fit the ${fmt(cavity.x)} × ${fmt(cavity.y)} cavity of ${part.path}${
          shortX || shortY
            ? ` — it is ${[
                shortX ? `${fmt(shortX)} too wide` : "",
                shortY ? `${fmt(shortY)} too long` : "",
              ]
                .filter(Boolean)
                .join(" and ")}`
            : ""
        }, in either orientation.`,
        hint: `COMPUTED from ${result.cavity.basis.join(", ")}. Enlarge the enclosure or shrink the board outline.`,
        nodes: [enclosureNode],
      });
      continue;
    }
    if (rotated) {
      findings.push({
        domain: "MECHANICAL",
        severity: "info",
        message: `${subject} only fits ${part.path} turned 90°.`,
        nodes: [enclosureNode],
      });
    }
    if (minGap(best) < MIN_SIDE_CLEARANCE_MM) {
      findings.push({
        domain: "MECHANICAL",
        severity: "warning",
        message: `${subject} fits ${part.path} with only ${fmt(minGap(best))} per side — less than the ${fmt(MIN_SIDE_CLEARANCE_MM)} a printed or moulded part needs to close over it.`,
        hint: `COMPUTED from ${result.cavity.basis.join(", ")}.`,
        nodes: [enclosureNode],
      });
    }

    // ---- height stack ----
    const standoff = cavity.standoff ?? PCB_STANDOFF_MM;
    let tallestFront: { h: number; refDes: string } | null = null;
    let tallestBack: { h: number; refDes: string } | null = null;
    let unknownHeights = 0;
    for (const fp of board.footprints) {
      const body = fp.bodyHeightMm ?? footprintDef(fp.libraryId, board.library)?.seatedHeightMm;
      if (body === undefined) {
        unknownHeights++;
        continue;
      }
      const entry = { h: (fp.standoffMm ?? 0) + body, refDes: fp.refDes };
      if (fp.side === "back") {
        if (!tallestBack || entry.h > tallestBack.h) tallestBack = entry;
      } else if (!tallestFront || entry.h > tallestFront.h) {
        tallestFront = entry;
      }
    }
    const partNode = (t: { refDes: string }) => ({
      refKey: footprintKey(boardIndex, t.refDes),
      label: t.refDes,
    });

    if (tallestBack && tallestBack.h > standoff) {
      findings.push({
        domain: "MECHANICAL",
        severity: "error",
        message: `${tallestBack.refDes} on the back of ${mid} stands ESTIMATED ${fmt(tallestBack.h)} tall, but the board sits only ${fmt(standoff)} above the enclosure floor.`,
        hint: "Raise the standoffs, move the part to the front, or pick a lower-profile part.",
        nodes: [partNode(tallestBack), enclosureNode],
      });
    }

    if (cavity.z !== null) {
      const tallest = tallestFront?.h ?? 0;
      const stack = standoff + board.board.thicknessMm + tallest;
      const headroom = cavity.z - stack;
      const breakdown = `${fmt(standoff)} standoff + ${fmt(board.board.thicknessMm)} board${
        tallestFront ? ` + ${fmt(tallestFront.h)} ${tallestFront.refDes}` : ""
      }`;
      if (headroom < 0) {
        findings.push({
          domain: "MECHANICAL",
          severity: "error",
          message: `The height stack of ${mid} is ESTIMATED ${fmt(stack)} (${breakdown}) but the cavity of ${part.path} is ${fmt(cavity.z)} — ${fmt(-headroom)} short.`,
          hint: `COMPUTED from ${result.cavity.basis.join(", ")}. Make the enclosure taller, lower the standoffs, or choose a lower part than ${tallestFront?.refDes ?? "the tallest one"}.`,
          nodes: [...(tallestFront ? [partNode(tallestFront)] : []), enclosureNode],
        });
      } else if (headroom < MIN_TOP_CLEARANCE_MM) {
        findings.push({
          domain: "MECHANICAL",
          severity: "warning",
          message: `The height stack of ${mid} is ESTIMATED ${fmt(stack)} (${breakdown}), leaving ${fmt(headroom)} under the lid of ${part.path}.`,
          nodes: [...(tallestFront ? [partNode(tallestFront)] : []), enclosureNode],
        });
      }
    }

    if (unknownHeights > 0) {
      findings.push({
        domain: "MECHANICAL",
        severity: "info",
        message: `${unknownHeights} footprint${unknownHeights === 1 ? " has" : "s have"} no known height, so the height check for ${mid} is optimistic.`,
      });
    }
  }

  return findings;
}
