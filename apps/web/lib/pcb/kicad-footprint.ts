/**
 * KiCad `.kicad_mod` footprint files → PcbFootprintDef.
 *
 * Reads pads (position, size, shape, drill, plating) and the courtyard, which
 * is all the board editor, DRC, Gerber export and CAD envelope need. KiCad
 * footprints carry no body height — only a 3D model reference — so the
 * seated height must come from the part's datasheet.
 *
 * KiCad places a footprint's origin wherever its author chose (often pin 1);
 * FOUNDRY footprints are centred on their body, so pads are shifted to the
 * courtyard centre.
 */

import {
  footprintDef,
  INSTALLED_FOOTPRINT_ID,
  MAX_INSTALLED_PADS,
  type PcbFootprintDef,
  type PcbPadDef,
} from "@/lib/pcb/doc";

type SExpr = string | SExpr[];

export class KicadFootprintError extends Error {}

const MAX_SOURCE_CHARS = 1_000_000;

export function parseSExpr(source: string): SExpr {
  if (source.length > MAX_SOURCE_CHARS) throw new KicadFootprintError("File is too large");
  let i = 0;
  const stack: SExpr[][] = [];
  let root: SExpr | undefined;
  const push = (value: SExpr) => {
    const top = stack[stack.length - 1];
    if (top) top.push(value);
    else if (root === undefined) root = value;
  };
  while (i < source.length) {
    const ch = source[i]!;
    if (ch === "(") {
      if (stack.length > 64) throw new KicadFootprintError("File nests too deeply");
      stack.push([]);
      i++;
    } else if (ch === ")") {
      const list = stack.pop();
      if (!list) throw new KicadFootprintError("Unbalanced parentheses");
      push(list);
      i++;
    } else if (ch === '"') {
      let out = "";
      i++;
      while (i < source.length && source[i] !== '"') {
        if (source[i] === "\\" && i + 1 < source.length) i++;
        out += source[i];
        i++;
      }
      i++;
      push(out);
    } else if (/\s/.test(ch)) {
      i++;
    } else {
      const start = i;
      while (i < source.length && !/[\s()"]/.test(source[i]!)) i++;
      push(source.slice(start, i));
    }
  }
  if (stack.length) throw new KicadFootprintError("Unbalanced parentheses");
  if (!Array.isArray(root)) throw new KicadFootprintError("Not a KiCad footprint");
  return root;
}

const isList = (e: SExpr): e is SExpr[] => Array.isArray(e);
const head = (e: SExpr) => (isList(e) && typeof e[0] === "string" ? e[0] : "");
const child = (e: SExpr[], name: string) =>
  e.find((c) => isList(c) && head(c) === name) as SExpr[] | undefined;
const children = (e: SExpr[], name: string) =>
  e.filter((c): c is SExpr[] => isList(c) && head(c) === name);
const nums = (e: SExpr[] | undefined) =>
  (e ?? [])
    .slice(1)
    .flatMap((v) => (typeof v === "string" && Number.isFinite(Number(v)) ? [Number(v)] : []));
const text = (e: SExpr[] | undefined) => (e && typeof e[1] === "string" ? e[1] : undefined);

type Box = { minX: number; minY: number; maxX: number; maxY: number };
const emptyBox = (): Box => ({ minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity });
function extend(box: Box, x: number, y: number) {
  box.minX = Math.min(box.minX, x);
  box.minY = Math.min(box.minY, y);
  box.maxX = Math.max(box.maxX, x);
  box.maxY = Math.max(box.maxY, y);
}
const boxOk = (box: Box) => Number.isFinite(box.minX) && box.maxX > box.minX && box.maxY > box.minY;

function layerOf(e: SExpr[]): string {
  return text(child(e, "layer")) ?? "";
}

/** Bounding box of graphics on the given layers. */
function graphicsBox(fp: SExpr[], layers: string[]): Box {
  const box = emptyBox();
  for (const g of fp) {
    if (!isList(g) || !layers.includes(layerOf(g))) continue;
    const kind = head(g);
    if (kind === "fp_line" || kind === "fp_rect") {
      for (const key of ["start", "end"]) {
        const [x, y] = nums(child(g, key));
        if (x !== undefined && y !== undefined) extend(box, x, y);
      }
    } else if (kind === "fp_circle") {
      const [cx, cy] = nums(child(g, "center"));
      const [ex, ey] = nums(child(g, "end"));
      if ([cx, cy, ex, ey].every((v) => v !== undefined)) {
        const r = Math.hypot(ex! - cx!, ey! - cy!);
        extend(box, cx! - r, cy! - r);
        extend(box, cx! + r, cy! + r);
      }
    } else if (kind === "fp_poly") {
      for (const xy of children(child(g, "pts") ?? [], "xy")) {
        const [x, y] = nums(xy);
        if (x !== undefined && y !== undefined) extend(box, x, y);
      }
    } else if (kind === "fp_arc") {
      for (const key of ["start", "mid", "end"]) {
        const [x, y] = nums(child(g, key));
        if (x !== undefined && y !== undefined) extend(box, x, y);
      }
    }
  }
  return box;
}

export type ParsedKicadFootprint = {
  def: PcbFootprintDef;
  /** Things the conversion approximated, for the tool result. */
  notes: string[];
};

/** A library-safe id, never one of the built-ins. */
export function installedFootprintId(name: string): string {
  let id = name
    .replace(/[^A-Za-z0-9_.+-]+/g, "_")
    .replace(/^[^A-Za-z0-9]+/, "")
    .slice(0, 64);
  if (!id) id = "footprint";
  if (footprintDef(id)) id = `kicad_${id}`.slice(0, 64);
  return INSTALLED_FOOTPRINT_ID.test(id) ? id : "footprint";
}

export function parseKicadFootprint(
  source: string,
  meta: { url: string; fetchedAt?: string },
): ParsedKicadFootprint {
  const root = parseSExpr(source);
  if (!isList(root) || (head(root) !== "footprint" && head(root) !== "module"))
    throw new KicadFootprintError("Not a KiCad footprint (expected (footprint …) or (module …))");
  const name = typeof root[1] === "string" ? root[1] : "footprint";
  const notes: string[] = [];

  const raw: PcbPadDef[] = [];
  let skipped = 0;
  for (const pad of children(root, "pad")) {
    const [, pinRaw, typeRaw, shapeRaw] = pad;
    const type = typeof typeRaw === "string" ? typeRaw : "";
    const shape = typeof shapeRaw === "string" ? shapeRaw : "";
    const [x, y, angle = 0] = nums(child(pad, "at"));
    let [w, h] = nums(child(pad, "size"));
    if (x === undefined || y === undefined || w === undefined || h === undefined) {
      skipped++;
      continue;
    }
    const quarter = Math.round((((angle % 360) + 360) % 360) / 90) % 4;
    if (quarter % 2 === 1) [w, h] = [h, w];
    if (angle % 90 !== 0)
      notes.push(`Pad ${String(pinRaw)} is rotated ${angle}°; its box is axis-aligned.`);
    const drill = nums(child(pad, "drill"))[0];
    const pin = typeof pinRaw === "string" ? pinRaw.slice(0, 16) : "";
    raw.push({
      pin: type === "np_thru_hole" ? "" : pin,
      xMm: x,
      yMm: y,
      wMm: Math.max(0.05, w),
      hMm: Math.max(0.05, h),
      shape: shape === "circle" || shape === "oval" ? "oval" : "rect",
      ...(type === "thru_hole" ? { plated: true } : {}),
      ...((type === "thru_hole" || type === "np_thru_hole") && drill && drill > 0
        ? { drillMm: drill }
        : {}),
    });
    if (raw.length >= MAX_INSTALLED_PADS) {
      notes.push(`Only the first ${MAX_INSTALLED_PADS} pads were kept.`);
      break;
    }
  }
  if (skipped)
    notes.push(`${skipped} pad${skipped === 1 ? "" : "s"} without position or size skipped.`);
  if (raw.length === 0) throw new KicadFootprintError("Footprint has no usable pads");

  let box = graphicsBox(root, ["F.CrtYd", "B.CrtYd"]);
  if (!boxOk(box)) {
    box = graphicsBox(root, ["F.Fab", "B.Fab"]);
    if (boxOk(box)) notes.push("No courtyard; body size taken from the fabrication outline.");
  }
  if (!boxOk(box)) {
    box = emptyBox();
    for (const p of raw) {
      extend(box, p.xMm - p.wMm / 2 - 0.25, p.yMm - p.hMm / 2 - 0.25);
      extend(box, p.xMm + p.wMm / 2 + 0.25, p.yMm + p.hMm / 2 + 0.25);
    }
    notes.push("No courtyard or fabrication outline; body size taken from the pads.");
  }
  const cx = (box.minX + box.maxX) / 2;
  const cy = (box.minY + box.maxY) / 2;
  const round = (v: number) => Math.round(v * 1000) / 1000;
  const pads = raw.map((p) => ({ ...p, xMm: round(p.xMm - cx), yMm: round(p.yMm - cy) }));
  if (Math.abs(cx) > 0.01 || Math.abs(cy) > 0.01)
    notes.push(
      `Origin moved to the body centre (KiCad origin was offset ${round(-cx)}, ${round(-cy)} mm).`,
    );

  const descr = text(child(root, "descr")) ?? "";
  const tags = text(child(root, "tags")) ?? "";
  return {
    def: {
      id: installedFootprintId(name),
      name: name.slice(0, 80),
      category: "Installed",
      keywords: `${tags} ${descr}`.toLowerCase().slice(0, 200),
      bodyWMm: round(box.maxX - box.minX),
      bodyHMm: round(box.maxY - box.minY),
      pads,
      source: {
        kind: "kicad",
        url: meta.url,
        ...(meta.fetchedAt ? { fetchedAt: meta.fetchedAt } : {}),
      },
    },
    notes,
  };
}
