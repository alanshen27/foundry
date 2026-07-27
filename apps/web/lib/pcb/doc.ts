/**
 * PCB board document model (Engineer > PCB). Outline, stackup metadata, and
 * footprint placement — a KiCad-style layout baseline, not a full router.
 */

export type PcbSide = "front" | "back";

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

export type PcbDoc = {
  version: 1;
  board: PcbBoard;
  footprints: PcbFootprint[];
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
};

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

export function createFootprint(
  libraryId: string,
  existing: PcbFootprint[],
  at: { xMm: number; yMm: number } = { xMm: 10, yMm: 10 },
): PcbFootprint | null {
  if (!footprintDef(libraryId)) return null;
  return {
    id: `fp_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`,
    libraryId,
    refDes: nextRefDes(libraryId, existing),
    xMm: at.xMm,
    yMm: at.yMm,
    rotationDeg: 0,
    side: "front",
  };
}

export function normalizePcbDoc(raw: unknown): PcbDoc {
  if (!raw || typeof raw !== "object") return { ...EMPTY_PCB, board: { ...EMPTY_PCB.board } };

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

  return { version: 1, board, footprints };
}
