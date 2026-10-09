import { describe, expect, it } from "vitest";
import { normalizePcbDoc, normalizeFootprintLibrary, type PcbFootprintDef } from "@/lib/pcb/doc";
import { boardPads } from "@/lib/pcb/geometry";
import { pcbMechanicalProfile } from "@/lib/pcb/mechanical";
import { pcbPartPython } from "@/lib/pcb/python";
import { parseKicadFootprint, parseSExpr } from "@/lib/pcb/kicad-footprint";
import {
  fetchFootprintSource,
  FootprintFetchError,
  kicadLibraryUrl,
} from "@/server/footprint-fetch";
import { stripCitationMarkers } from "@/components/copilot/markdown";

const SWITCH = `(footprint "SW_PUSH_6mm" (version 20240108) (layer "F.Cu")
  (descr "tactile push button, 6x6mm")
  (tags "tact sw push 6mm")
  (fp_line (start -1.25 -1.5) (end 7.75 -1.5) (layer "F.CrtYd"))
  (fp_line (start 7.75 -1.5) (end 7.75 6) (layer "F.CrtYd"))
  (fp_line (start 7.75 6) (end -1.25 6) (layer "F.CrtYd"))
  (fp_line (start -1.25 6) (end -1.25 -1.5) (layer "F.CrtYd"))
  (pad "1" thru_hole circle (at 0 0 90) (size 2 2) (drill 1.1) (layers "*.Cu" "*.Mask"))
  (pad "2" thru_hole circle (at 0 4.5) (size 2 2) (drill 1.1) (layers "*.Cu" "*.Mask"))
  (pad "1" thru_hole circle (at 6.5 0) (size 2 2) (drill 1.1) (layers "*.Cu" "*.Mask"))
  (pad "2" thru_hole circle (at 6.5 4.5) (size 2 2) (drill 1.1) (layers "*.Cu" "*.Mask"))
  (pad "" np_thru_hole circle (at 3.25 2.25) (size 1 1) (drill 1) (layers "*.Cu"))
  (pad "3" smd roundrect (at 3.25 -1 90) (size 1 0.5) (layers "F.Cu") (roundrect_rratio 0.25))
)`;

const installed = (overrides: Partial<PcbFootprintDef> = {}): PcbFootprintDef => ({
  id: "SW_PUSH_6mm",
  name: "SW_PUSH_6mm",
  category: "Installed",
  keywords: "",
  bodyWMm: 9,
  bodyHMm: 7.5,
  seatedHeightMm: 5,
  pads: [
    { pin: "1", xMm: -3.25, yMm: -2.25, wMm: 2, hMm: 2, shape: "oval", plated: true, drillMm: 1.1 },
    { pin: "2", xMm: 3.25, yMm: 2.25, wMm: 2, hMm: 2, shape: "oval", plated: true, drillMm: 1.1 },
  ],
  source: { kind: "kicad", url: "https://gitlab.com/kicad/x.kicad_mod" },
  ...overrides,
});

describe("KiCad footprint import", () => {
  it("reads pads, drills and plating, and centres them on the courtyard", () => {
    const { def, notes } = parseKicadFootprint(SWITCH, { url: "https://example.test/sw" });
    expect(def).toMatchObject({ id: "SW_PUSH_6mm", bodyWMm: 9, bodyHMm: 7.5 });
    expect(def.keywords).toContain("tact");
    expect(def.pads[0]).toMatchObject({
      pin: "1",
      xMm: -3.25,
      yMm: -2.25,
      drillMm: 1.1,
      plated: true,
      shape: "oval",
    });
    expect(def.pads[4]).toMatchObject({ pin: "", drillMm: 1 });
    expect(def.pads[4]).not.toHaveProperty("plated");
    // A 90° pad swaps its size; SMD pads carry no drill.
    expect(def.pads[5]).toMatchObject({ pin: "3", wMm: 0.5, hMm: 1, shape: "rect" });
    expect(def.pads[5]).not.toHaveProperty("drillMm");
    expect(def.source).toMatchObject({ kind: "kicad", url: "https://example.test/sw" });
    expect(notes.some((n) => n.includes("Origin moved"))).toBe(true);
  });

  it("accepts the legacy (module …) format and falls back to the pads for size", () => {
    const { def, notes } = parseKicadFootprint(
      `(module R_Test (layer F.Cu) (pad 1 smd rect (at -1 0) (size 1 1) (layers F.Cu)) (pad 2 smd rect (at 1 0) (size 1 1) (layers F.Cu)))`,
      { url: "https://example.test/r" },
    );
    expect(def.id).toBe("R_Test");
    expect(def.bodyWMm).toBe(3.5);
    expect(def.pads.map((p) => p.xMm)).toEqual([-1, 1]);
    expect(notes.join(" ")).toContain("from the pads");
  });

  it("never reuses a built-in id and rejects files that are not footprints", () => {
    const { def } = parseKicadFootprint(
      `(footprint "R_0603" (pad "1" smd rect (at 0 0) (size 1 1) (layers "F.Cu")))`,
      { url: "https://example.test/r" },
    );
    expect(def.id).toBe("kicad_R_0603");
    expect(() => parseKicadFootprint(`(symbol "x")`, { url: "https://x.test" })).toThrow();
    expect(() => parseKicadFootprint(`(footprint "x")`, { url: "https://x.test" })).toThrow(
      /no usable pads/,
    );
    expect(() => parseSExpr("(a (b)")).toThrow(/Unbalanced/);
  });
});

describe("installed footprint library", () => {
  it("keeps only sourced, bounded, non-built-in footprints", () => {
    const library = normalizeFootprintLibrary([
      installed(),
      installed({ id: "R_0603" }),
      installed({ id: "bad id!" }),
      installed({ id: "NoSource", source: { kind: "kicad", url: "http://insecure.test/x" } }),
      installed({ id: "NoPads", pads: [] }),
      installed(),
    ]);
    expect(library?.map((f) => f.id)).toEqual(["SW_PUSH_6mm"]);
  });

  it("lets a board place, pad and envelope an installed footprint", () => {
    const doc = normalizePcbDoc({
      version: 1,
      board: { widthMm: 40, heightMm: 30, thicknessMm: 1.6, cornerRadiusMm: 0 },
      library: [installed()],
      footprints: [
        { id: "sw", libraryId: "SW_PUSH_6mm", xMm: 20, yMm: 15, bodyHeightMm: 5, standoffMm: 2 },
        { id: "gone", libraryId: "NotInstalled", xMm: 5, yMm: 5 },
      ],
    });
    expect(doc.footprints.map((f) => f.id)).toEqual(["sw"]);
    expect(boardPads(doc.footprints, doc.library)).toHaveLength(2);
    expect(pcbMechanicalProfile(doc).components[0]).toMatchObject({
      widthMm: 9,
      depthMm: 7.5,
      zMm: 3.6,
    });
    expect(normalizePcbDoc({ ...doc, library: undefined }).footprints).toEqual([]);
  });

  it("keeps display glass inside the module and emits it above a shorter carrier", () => {
    const oled = (glass: unknown) =>
      installed({
        id: "OLED_MODULE",
        bodyWMm: 30,
        bodyHMm: 28,
        seatedHeightMm: 4,
        glass: glass as PcbFootprintDef["glass"],
      });
    const [kept, tooWide, tooTall] = [
      { wMm: 26, hMm: 14, heightMm: 1.5, xMm: 0, yMm: 3 },
      { wMm: 40, hMm: 14, heightMm: 1.5, xMm: 0, yMm: 0 },
      { wMm: 26, hMm: 14, heightMm: 4, xMm: 0, yMm: 0 },
    ].map((glass) => normalizeFootprintLibrary([oled(glass)])![0]!.glass);
    expect(kept).toEqual({ wMm: 26, hMm: 14, heightMm: 1.5, xMm: 0, yMm: 3 });
    // Width is clamped to the carrier; a glass as tall as the module is no glass.
    expect(tooWide?.wMm).toBe(30);
    expect(tooTall).toBeUndefined();

    const doc = normalizePcbDoc({
      version: 1,
      board: { widthMm: 40, heightMm: 30, thicknessMm: 1.6, cornerRadiusMm: 0 },
      library: [oled(kept)],
      footprints: [
        { id: "ds", libraryId: "OLED_MODULE", refDes: "DS1", xMm: 20, yMm: 15, bodyHeightMm: 4 },
      ],
    });
    expect(pcbMechanicalProfile(doc).components[0]?.glass).toEqual({
      wMm: 26,
      hMm: 14,
      heightMm: 1.5,
      xMm: 0,
      yMm: -3,
    });
    const source = pcbPartPython(doc);
    expect(source).toContain("Box(30, 28, 2.5, align=(Align.CENTER, Align.CENTER, Align.MIN))");
    expect(source).toContain(
      "Pos(0, -3, 2.5) * Box(26, 14, 1.5, align=(Align.CENTER, Align.CENTER, Align.MIN))",
    );
    expect(source).toContain('pkg.label = "DS1 glass"');
  });
});

function response(status: number, body = "", headers: Record<string, string> = {}) {
  return new Response(status >= 300 && status < 400 ? null : body, { status, headers });
}

describe("footprint downloads", () => {
  it("builds official KiCad library URLs and refuses path tricks", () => {
    expect(kicadLibraryUrl("Button_Switch_THT", "SW_PUSH_6mm")).toBe(
      "https://gitlab.com/kicad/libraries/kicad-footprints/-/raw/master/Button_Switch_THT.pretty/SW_PUSH_6mm.kicad_mod",
    );
    expect(() => kicadLibraryUrl("../secrets", "x")).toThrow(FootprintFetchError);
    expect(() => kicadLibraryUrl("Lib", "a/b")).toThrow(FootprintFetchError);
  });

  it("only fetches allowlisted hosts, including across redirects", async () => {
    const calls: string[] = [];
    const fake = (async (url: URL) => {
      calls.push(url.toString());
      if (url.hostname === "raw.githubusercontent.com" && url.pathname.includes("redirect"))
        return response(302, "", { location: "http://169.254.169.254/latest.kicad_mod" });
      return response(200, SWITCH);
    }) as unknown as typeof fetch;

    const ok = await fetchFootprintSource(
      "https://github.com/vendor/lib/blob/main/OLED.pretty/OLED.kicad_mod",
      fake,
    );
    expect(ok.url).toBe(
      "https://raw.githubusercontent.com/vendor/lib/main/OLED.pretty/OLED.kicad_mod",
    );
    await expect(fetchFootprintSource("https://evil.test/x.kicad_mod", fake)).rejects.toThrow(
      /not an allowed footprint source/,
    );
    await expect(
      fetchFootprintSource("https://gitlab.com/someone/else/-/raw/main/x.kicad_mod", fake),
    ).rejects.toThrow(/not an allowed/);
    await expect(
      fetchFootprintSource("https://raw.githubusercontent.com/a/b/redirect/x.kicad_mod", fake),
    ).rejects.toThrow(/not an allowed/);
    await expect(
      fetchFootprintSource("https://raw.githubusercontent.com/a/b/x.txt", fake),
    ).rejects.toThrow(/Only .kicad_mod/);
    expect(calls.some((c) => c.includes("169.254"))).toBe(false);
  });

  it("caps the download size", async () => {
    const big = (async () => response(200, "(".repeat(1_100_000))) as unknown as typeof fetch;
    await expect(
      fetchFootprintSource("https://raw.githubusercontent.com/a/b/c/x.kicad_mod", big),
    ).rejects.toThrow(/too large/);
  });
});

describe("chat citation markers", () => {
  it("removes web-search citation tokens", () => {
    expect(
      stripCitationMarkers("published thickness. \uE200cite\uE202turn0search0\uE201\n- Next"),
    ).toBe("published thickness.\n- Next");
  });
});
