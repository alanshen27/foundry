/**
 * PCB board document model (Engineer > PCB). Outline, stackup metadata,
 * footprint placement, and two-layer copper routing — a KiCad-style layout
 * baseline with manual routing, DRC, and Gerber output.
 */

export type PcbSide = "front" | "back";

/** The two copper layers. Routing is two-sided; inner layers are not modelled. */
export type PcbLayer = "F.Cu" | "B.Cu";

export const PCB_LAYERS: PcbLayer[] = ["F.Cu", "B.Cu"];

/** The copper layer a footprint's SMD pads live on. */
export function sideLayer(side: PcbSide): PcbLayer {
  return side === "front" ? "F.Cu" : "B.Cu";
}

export type PcbPoint = { xMm: number; yMm: number };

export type PcbBoard = {
  /** Board outline width in millimetres (Edge.Cuts). */
  widthMm: number;
  /** Board outline height in millimetres. */
  heightMm: number;
  /** Dielectric + copper stack thickness. */
  thicknessMm: number;
  /** Corner fillet on the rectangular outline; 0 = sharp corners. */
  cornerRadiusMm: number;
};

export type PcbPadDef = {
  /**
   * Pad identity within the footprint, e.g. "1", "2", "A", "EP". Empty for
   * mechanical pads (mounting holes) that never carry a net.
   */
  pin: string;
  /** Offset from footprint origin (centre). */
  xMm: number;
  yMm: number;
  wMm: number;
  hMm: number;
  shape: "rect" | "oval";
  /** Through-hole pads span both copper layers. */
  plated?: boolean;
};

export type PcbFootprintDef = {
  id: string;
  name: string;
  category: string;
  keywords: string;
  /** Courtyard / body size drawn on the canvas. */
  bodyWMm: number;
  bodyHMm: number;
  pads: PcbPadDef[];
};

export type PcbFootprint = {
  id: string;
  /** Library footprint id, e.g. "R_0603". */
  libraryId: string;
  /** Reference designator, e.g. R1. */
  refDes: string;
  value?: string;
  xMm: number;
  yMm: number;
  /** Rotation clockwise in degrees (0 / 90 / 180 / 270 typical). */
  rotationDeg: number;
  side: PcbSide;
  /**
   * Id of the CircuitPart this footprint physically realises. Set it to pull
   * the schematic's nets onto the board (see lib/pcb/netlist.ts); unset means
   * the footprint is board-only (mounting holes, test points).
   */
  partId?: string;
  /**
   * Schematic pin name -> pad pin, for parts whose symbol pins don't match the
   * footprint's pad names (a Wokwi LED's A/C vs. an LED_0805's 1/2). Only
   * needed where the names differ.
   */
  pinMap?: Record<string, string>;
};

/**
 * A routed copper polyline. Stored as a vertex list rather than one segment per
 * record because that is how a track is drawn (click, click, click) and how it
 * is edited — splitting a corner off into its own row would make an undo of a
 * single route touch many records.
 *
 * `net` is the net name the track was started from. It is a claim, not a
 * guarantee: dragging a footprint afterwards can leave the copper touching a
 * different net, which is exactly the short DRC looks for.
 */
export type PcbTrack = {
  id: string;
  net?: string;
  layer: PcbLayer;
  widthMm: number;
  /** At least two points; collinear duplicates are removed on normalize. */
  points: PcbPoint[];
};

/**
 * A plated through-hole joining F.Cu and B.Cu. Blind/buried vias would need a
 * real stackup, so every via spans the whole board.
 */
export type PcbVia = {
  id: string;
  net?: string;
  xMm: number;
  yMm: number;
  drillMm: number;
  diameterMm: number;
};

/**
 * Manufacturing constraints. Defaults are a conservative 2-layer spec that
 * every low-cost fab (JLCPCB, PCBWay, OSH Park) accepts without review.
 */
export type PcbRules = {
  /** Minimum copper-to-copper gap between different nets. */
  clearanceMm: number;
  /** Default width for newly drawn tracks. */
  trackWidthMm: number;
  viaDiameterMm: number;
  viaDrillMm: number;
  /** Minimum copper-to-board-edge gap. */
  edgeClearanceMm: number;
};

export const DEFAULT_RULES: PcbRules = {
  clearanceMm: 0.2,
  trackWidthMm: 0.25,
  viaDiameterMm: 0.6,
  viaDrillMm: 0.3,
  edgeClearanceMm: 0.3,
};

export type PcbDoc = {
  version: 1;
  board: PcbBoard;
  footprints: PcbFootprint[];
  tracks: PcbTrack[];
  vias: PcbVia[];
  rules: PcbRules;
};

export const EMPTY_PCB: PcbDoc = {
  version: 1,
  board: {
    widthMm: 80,
    heightMm: 50,
    thicknessMm: 1.6,
    cornerRadiusMm: 1,
  },
  footprints: [],
  tracks: [],
  vias: [],
  rules: DEFAULT_RULES,
};

/** A fresh EMPTY_PCB whose nested objects/arrays are safe to mutate. */
export function emptyPcbDoc(): PcbDoc {
  return {
    version: 1,
    board: { ...EMPTY_PCB.board },
    footprints: [],
    tracks: [],
    vias: [],
    rules: { ...DEFAULT_RULES },
  };
}

/** Small built-in library — enough for placement practice, not a full KiCad lib. */
export const FOOTPRINT_LIBRARY: PcbFootprintDef[] = [
  {
    id: "R_0603",
    name: "R 0603",
    category: "Passives",
    keywords: "resistor 0603 smd",
    bodyWMm: 1.6,
    bodyHMm: 0.8,
    pads: [
      { pin: "1", xMm: -0.75, yMm: 0, wMm: 0.7, hMm: 0.8, shape: "rect" },
      { pin: "2", xMm: 0.75, yMm: 0, wMm: 0.7, hMm: 0.8, shape: "rect" },
    ],
  },
  {
    id: "R_0805",
    name: "R 0805",
    category: "Passives",
    keywords: "resistor 0805 smd",
    bodyWMm: 2.0,
    bodyHMm: 1.25,
    pads: [
      { pin: "1", xMm: -0.95, yMm: 0, wMm: 0.9, hMm: 1.2, shape: "rect" },
      { pin: "2", xMm: 0.95, yMm: 0, wMm: 0.9, hMm: 1.2, shape: "rect" },
    ],
  },
  {
    id: "C_0603",
    name: "C 0603",
    category: "Passives",
    keywords: "capacitor 0603 smd",
    bodyWMm: 1.6,
    bodyHMm: 0.8,
    pads: [
      { pin: "1", xMm: -0.75, yMm: 0, wMm: 0.7, hMm: 0.8, shape: "rect" },
      { pin: "2", xMm: 0.75, yMm: 0, wMm: 0.7, hMm: 0.8, shape: "rect" },
    ],
  },
  {
    id: "LED_0805",
    name: "LED 0805",
    category: "Passives",
    keywords: "led 0805 smd diode",
    bodyWMm: 2.0,
    bodyHMm: 1.25,
    // Pad 1 is the anode, pad 2 the cathode — Wokwi LED symbols use A/C, so
    // those parts need a pinMap.
    pads: [
      { pin: "1", xMm: -0.95, yMm: 0, wMm: 0.9, hMm: 1.2, shape: "rect" },
      { pin: "2", xMm: 0.95, yMm: 0, wMm: 0.9, hMm: 1.2, shape: "rect" },
    ],
  },
  {
    id: "SOIC-8",
    name: "SOIC-8",
    category: "ICs",
    keywords: "soic 8 ic package",
    bodyWMm: 5.0,
    bodyHMm: 4.0,
    // Pins 1-4 run left-to-right along the top row, 5-8 right-to-left along the
    // bottom — the standard counter-clockwise SOIC numbering.
    pads: Array.from({ length: 8 }, (_, i) => {
      const row = i < 4 ? -1 : 1;
      const col = i < 4 ? i : 7 - i;
      return {
        pin: String(i + 1),
        xMm: -1.905 + col * 1.27,
        yMm: row * 2.6,
        wMm: 0.6,
        hMm: 1.5,
        shape: "rect" as const,
      };
    }),
  },
  {
    id: "QFN-16-3x3",
    name: "QFN-16 3×3",
    category: "ICs",
    keywords: "qfn 16 3x3 ic",
    bodyWMm: 3.0,
    bodyHMm: 3.0,
    // 1-16 run around the package in placement order (top edge left-to-right,
    // then right, bottom, left), with "EP" for the centre exposed pad.
    pads: [
      ...Array.from({ length: 4 }, (_, i) => ({
        pin: String(i + 1),
        xMm: -1.05 + i * 0.5,
        yMm: -1.45,
        wMm: 0.25,
        hMm: 0.55,
        shape: "rect" as const,
      })),
      ...Array.from({ length: 4 }, (_, i) => ({
        pin: String(i + 5),
        xMm: 1.45,
        yMm: -1.05 + i * 0.5,
        wMm: 0.55,
        hMm: 0.25,
        shape: "rect" as const,
      })),
      ...Array.from({ length: 4 }, (_, i) => ({
        pin: String(i + 9),
        xMm: 1.05 - i * 0.5,
        yMm: 1.45,
        wMm: 0.25,
        hMm: 0.55,
        shape: "rect" as const,
      })),
      ...Array.from({ length: 4 }, (_, i) => ({
        pin: String(i + 13),
        xMm: -1.45,
        yMm: 1.05 - i * 0.5,
        wMm: 0.55,
        hMm: 0.25,
        shape: "rect" as const,
      })),
      { pin: "EP", xMm: 0, yMm: 0, wMm: 1.6, hMm: 1.6, shape: "rect" as const },
    ],
  },
  {
    id: "PinHeader_1x04",
    name: "PinHeader 1×4",
    category: "Connectors",
    keywords: "pin header 2.54 tht connector",
    bodyWMm: 2.54 * 4,
    bodyHMm: 2.54,
    pads: Array.from({ length: 4 }, (_, i) => ({
      pin: String(i + 1),
      xMm: -1.5 * 2.54 + i * 2.54,
      yMm: 0,
      wMm: 1.6,
      hMm: 1.6,
      shape: "oval" as const,
      plated: true,
    })),
  },
  {
    id: "USB_C_Receptacle",
    name: "USB-C receptacle",
    category: "Connectors",
    keywords: "usb type-c connector",
    bodyWMm: 9.0,
    bodyHMm: 7.5,
    // S1/S2 are the through-hole shield tabs; A1-A12 the signal row.
    pads: [
      { pin: "S1", xMm: -4.2, yMm: 0, wMm: 1.2, hMm: 2.2, shape: "rect", plated: true },
      { pin: "S2", xMm: 4.2, yMm: 0, wMm: 1.2, hMm: 2.2, shape: "rect", plated: true },
      ...Array.from({ length: 12 }, (_, i) => ({
        pin: `A${i + 1}`,
        xMm: -2.75 + i * 0.5,
        yMm: 2.8,
        wMm: 0.3,
        hMm: 1.2,
        shape: "rect" as const,
      })),
    ],
  },
  {
    id: "MountingHole_3.2mm",
    name: "M3 mounting hole",
    category: "Mechanical",
    keywords: "mounting hole m3 3.2mm",
    bodyWMm: 6.0,
    bodyHMm: 6.0,
    // Mechanical only — no pin, so it never joins a net.
    pads: [{ pin: "", xMm: 0, yMm: 0, wMm: 3.2, hMm: 3.2, shape: "oval" }],
  },
];

export const FOOTPRINT_IDS = FOOTPRINT_LIBRARY.map((f) => f.id);

export function footprintDef(libraryId: string): PcbFootprintDef | undefined {
  return FOOTPRINT_LIBRARY.find((f) => f.id === libraryId);
}

/** Library ids in a proposed footprint list that are not in FOOTPRINT_LIBRARY. */
export function unsupportedFootprintIds(
  footprints: { libraryId: string }[],
): string[] {
  const unknown = new Set<string>();
  for (const f of footprints) {
    if (!footprintDef(f.libraryId)) unknown.add(f.libraryId);
  }
  return [...unknown];
}

/** Pad on `libraryId` whose pin matches `pin` (exact, then case-insensitive). */
export function padByPin(libraryId: string, pin: string): PcbPadDef | undefined {
  const def = footprintDef(libraryId);
  if (!def || !pin) return undefined;
  return (
    def.pads.find((p) => p.pin === pin) ??
    def.pads.find((p) => p.pin.toLowerCase() === pin.toLowerCase())
  );
}

export function searchFootprints(query: string): PcbFootprintDef[] {
  const q = query.trim().toLowerCase();
  if (!q) return FOOTPRINT_LIBRARY;
  return FOOTPRINT_LIBRARY.filter(
    (f) =>
      f.name.toLowerCase().includes(q) ||
      f.id.toLowerCase().includes(q) ||
      f.category.toLowerCase().includes(q) ||
      f.keywords.includes(q),
  );
}

function clamp(n: number, min: number, max: number) {
  return Math.min(max, Math.max(min, n));
}

function num(raw: unknown, fallback: number, min: number, max: number): number {
  const n = typeof raw === "number" ? raw : typeof raw === "string" ? Number(raw) : NaN;
  if (!Number.isFinite(n)) return fallback;
  return clamp(n, min, max);
}

/**
 * Keeps only entries whose target names a real pad on `libraryId` — a map into
 * a pad that doesn't exist would silently drop the pin from the ratsnest, so
 * it's better reported as unmapped.
 */
function cleanPinMap(raw: unknown, libraryId: string): Record<string, string> | undefined {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const out: Record<string, string> = {};
  for (const [schematicPin, padPin] of Object.entries(raw as Record<string, unknown>)) {
    if (!schematicPin || typeof padPin !== "string") continue;
    const pad = padByPin(libraryId, padPin);
    if (pad) out[schematicPin.slice(0, 40)] = pad.pin;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

function nextRefDes(libraryId: string, existing: PcbFootprint[]): string {
  const prefix =
    libraryId.startsWith("R_") || libraryId.startsWith("C_")
      ? libraryId[0]!
      : libraryId.startsWith("LED_")
        ? "D"
        : libraryId.startsWith("PinHeader") || libraryId.startsWith("USB_")
          ? "J"
          : libraryId.startsWith("MountingHole")
            ? "H"
            : "U";
  const used = new Set(
    existing
      .map((f) => f.refDes)
      .filter((r) => r.startsWith(prefix))
      .map((r) => Number(r.slice(prefix.length)))
      .filter((n) => Number.isFinite(n)),
  );
  let i = 1;
  while (used.has(i)) i += 1;
  return `${prefix}${i}`;
}

/** Collision-resistant enough for client-side ids on a single document. */
export function pcbId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}

export function createFootprint(
  libraryId: string,
  existing: PcbFootprint[],
  at: { xMm: number; yMm: number } = { xMm: 10, yMm: 10 },
): PcbFootprint | null {
  if (!footprintDef(libraryId)) return null;
  return {
    id: pcbId("fp"),
    libraryId,
    refDes: nextRefDes(libraryId, existing),
    xMm: at.xMm,
    yMm: at.yMm,
    rotationDeg: 0,
    side: "front",
  };
}

/**
 * Drops consecutive duplicate vertices. A click that lands on the previous
 * point would otherwise store a zero-length segment, which has no direction and
 * so breaks both the DRC segment distance and the Gerber writer.
 */
function cleanPoints(raw: unknown, board: PcbBoard): PcbPoint[] {
  if (!Array.isArray(raw)) return [];
  const out: PcbPoint[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const p = item as Record<string, unknown>;
    const xMm = num(p.xMm, NaN, -500, board.widthMm + 500);
    const yMm = num(p.yMm, NaN, -500, board.heightMm + 500);
    if (!Number.isFinite(xMm) || !Number.isFinite(yMm)) continue;
    const prev = out[out.length - 1];
    if (prev && Math.abs(prev.xMm - xMm) < 1e-6 && Math.abs(prev.yMm - yMm) < 1e-6) continue;
    out.push({ xMm, yMm });
  }
  return out;
}

function normalizeTracks(raw: unknown, board: PcbBoard): PcbTrack[] {
  if (!Array.isArray(raw)) return [];
  const out: PcbTrack[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const t = item as Record<string, unknown>;
    const points = cleanPoints(t.points, board);
    // A one-point track is not copper; it is a click that never went anywhere.
    if (points.length < 2) continue;
    out.push({
      id: typeof t.id === "string" && t.id ? t.id : pcbId("tr"),
      net: typeof t.net === "string" && t.net.trim() ? t.net.trim().slice(0, 60) : undefined,
      layer: t.layer === "B.Cu" ? "B.Cu" : "F.Cu",
      widthMm: num(t.widthMm, DEFAULT_RULES.trackWidthMm, 0.05, 10),
      points,
    });
  }
  return out;
}

function normalizeVias(raw: unknown, board: PcbBoard): PcbVia[] {
  if (!Array.isArray(raw)) return [];
  const out: PcbVia[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const v = item as Record<string, unknown>;
    const diameterMm = num(v.diameterMm, DEFAULT_RULES.viaDiameterMm, 0.1, 10);
    // Drill can never reach the annular ring's outer edge or there is no ring.
    const drillMm = num(v.drillMm, DEFAULT_RULES.viaDrillMm, 0.05, Math.max(0.05, diameterMm - 0.05));
    out.push({
      id: typeof v.id === "string" && v.id ? v.id : pcbId("via"),
      net: typeof v.net === "string" && v.net.trim() ? v.net.trim().slice(0, 60) : undefined,
      xMm: num(v.xMm, board.widthMm / 2, -500, board.widthMm + 500),
      yMm: num(v.yMm, board.heightMm / 2, -500, board.heightMm + 500),
      diameterMm,
      drillMm,
    });
  }
  return out;
}

function normalizeRules(raw: unknown): PcbRules {
  const r = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  return {
    clearanceMm: num(r.clearanceMm, DEFAULT_RULES.clearanceMm, 0.02, 5),
    trackWidthMm: num(r.trackWidthMm, DEFAULT_RULES.trackWidthMm, 0.05, 10),
    viaDiameterMm: num(r.viaDiameterMm, DEFAULT_RULES.viaDiameterMm, 0.1, 10),
    viaDrillMm: num(r.viaDrillMm, DEFAULT_RULES.viaDrillMm, 0.05, 9),
    edgeClearanceMm: num(r.edgeClearanceMm, DEFAULT_RULES.edgeClearanceMm, 0, 10),
  };
}

export function normalizePcbDoc(raw: unknown): PcbDoc {
  if (!raw || typeof raw !== "object") return emptyPcbDoc();

  const obj = raw as Record<string, unknown>;
  const boardRaw =
    obj.board && typeof obj.board === "object" ? (obj.board as Record<string, unknown>) : {};

  const board: PcbBoard = {
    widthMm: num(boardRaw.widthMm, EMPTY_PCB.board.widthMm, 5, 500),
    heightMm: num(boardRaw.heightMm, EMPTY_PCB.board.heightMm, 5, 500),
    thicknessMm: num(boardRaw.thicknessMm, EMPTY_PCB.board.thicknessMm, 0.4, 6.4),
    cornerRadiusMm: num(boardRaw.cornerRadiusMm, EMPTY_PCB.board.cornerRadiusMm, 0, 50),
  };

  const footprintsRaw = Array.isArray(obj.footprints) ? obj.footprints : [];
  const footprints: PcbFootprint[] = [];
  for (const item of footprintsRaw) {
    if (!item || typeof item !== "object") continue;
    const f = item as Record<string, unknown>;
    const libraryId = typeof f.libraryId === "string" ? f.libraryId : "";
    if (!footprintDef(libraryId)) continue;
    const side = f.side === "back" ? "back" : "front";
    footprints.push({
      id: typeof f.id === "string" && f.id ? f.id : `fp_${footprints.length + 1}`,
      libraryId,
      refDes:
        typeof f.refDes === "string" && f.refDes.trim()
          ? f.refDes.trim().slice(0, 16)
          : nextRefDes(libraryId, footprints),
      value: typeof f.value === "string" ? f.value.slice(0, 64) : undefined,
      xMm: num(f.xMm, board.widthMm / 2, -50, board.widthMm + 50),
      yMm: num(f.yMm, board.heightMm / 2, -50, board.heightMm + 50),
      rotationDeg: num(f.rotationDeg, 0, 0, 359),
      side,
      partId:
        typeof f.partId === "string" && f.partId.trim()
          ? f.partId.trim().slice(0, 60)
          : undefined,
      pinMap: cleanPinMap(f.pinMap, libraryId),
    });
  }

  return {
    version: 1,
    board,
    footprints,
    tracks: normalizeTracks(obj.tracks, board),
    vias: normalizeVias(obj.vias, board),
    rules: normalizeRules(obj.rules),
  };
}
