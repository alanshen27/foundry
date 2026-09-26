import { describe, expect, it } from "vitest";
import {
  ASSEMBLY_STARTER_KCL,
  DEFAULT_ASSEMBLY_KCL,
  DEFAULT_KCL,
  cadDoc,
  isCadStarterComponent,
  normalizeCadDoc,
  pickCadAssemblyPreview,
  selectCadComponentId,
  setActiveComponent,
  updateComponentContent,
  upsertCadContent,
  upsertPartScript,
} from "../src/doc";

const SAVED_PART = DEFAULT_KCL.replace("width = 60", "width = 64");
const SAVED_ASSEMBLY = DEFAULT_ASSEMBLY_KCL.replace("assyWidth = 120", "assyWidth = 128");

describe("starter geometry previews", () => {
  it("does not present new or persisted stock boxes as a product, without rewriting their source", () => {
    for (const doc of [normalizeCadDoc(null), normalizeCadDoc(cadDoc(DEFAULT_KCL))]) {
      const before = JSON.stringify(doc);
      expect(
        doc.components.filter((part) => part.kind !== "instructions").every(isCadStarterComponent),
      ).toBe(true);
      expect(pickCadAssemblyPreview(doc)).toBeNull();
      expect(JSON.stringify(doc)).toBe(before);
    }
  });

  it("recognizes only exact shipped sources and keeps custom rectangular designs drawable", () => {
    expect(isCadStarterComponent({ kind: "part", content: `\n${DEFAULT_KCL}\n` })).toBe(true);
    expect(isCadStarterComponent({ kind: "part", content: SAVED_PART })).toBe(false);
    expect(isCadStarterComponent({ kind: "assembly", content: SAVED_ASSEMBLY })).toBe(false);
    expect(
      isCadStarterComponent({
        kind: "assembly",
        content: "assemblyEnvelope = extrude(myCustomProfile, length = 40)",
      }),
    ).toBe(false);
    expect(isCadStarterComponent({ kind: "instructions", content: DEFAULT_KCL })).toBe(false);
  });

  it("previews an actual saved part when the product assembly is stock, blank, or a comment starter", () => {
    const doc = upsertPartScript(cadDoc(DEFAULT_KCL), "recorder-base", SAVED_PART);
    const assembly = doc.components.find((component) => component.kind === "assembly")!;
    const before = JSON.stringify(doc);
    for (const content of [DEFAULT_ASSEMBLY_KCL, ASSEMBLY_STARTER_KCL, " "]) {
      const input = updateComponentContent(doc, assembly.id, content);
      const preview = pickCadAssemblyPreview(input);
      expect(preview?.mode).toBe("part");
      expect(preview?.component.name).toBe("recorder-base");
      expect(preview?.component.content.trim()).toBe(SAVED_PART.trim());
    }
    expect(JSON.stringify(doc)).toBe(before);
  });

  it("keeps a genuine saved assembly authoritative even when an individual part is active", () => {
    let doc = upsertPartScript(cadDoc(DEFAULT_KCL), "recorder-base", SAVED_PART);
    const partId = doc.activeId;
    doc = setActiveComponent(upsertCadContent(doc, "assembly/product.kcl", SAVED_ASSEMBLY), partId);
    const preview = pickCadAssemblyPreview(doc);
    expect(preview?.mode).toBe("assembly");
    expect(preview?.component.content).toBe(SAVED_ASSEMBLY);
  });

  it("allows imported mesh parts to be the preview before assembly is built", () => {
    const doc = upsertPartScript(
      cadDoc(DEFAULT_KCL),
      "base-mesh",
      'import "imports/base.stl" as base\nbase\n',
    );
    expect(pickCadAssemblyPreview(doc)?.component.path).toBe("parts/base-mesh/main.kcl");
  });
});

describe("CAD selection after saved geometry arrives", () => {
  it("moves off an untouched starter but honors an explicit component link", () => {
    const initial = cadDoc(DEFAULT_KCL);
    const starterId = initial.activeId;
    const next = upsertPartScript(initial, "recorder-base", SAVED_PART);
    expect(selectCadComponentId(next, starterId)).toBe(next.activeId);
    expect(selectCadComponentId(next, starterId, starterId)).toBe(starterId);
  });

  it("preserves a genuine selected part when another generated part is saved", () => {
    const initial = cadDoc(SAVED_PART);
    const selectedId = initial.activeId;
    const next = upsertPartScript(initial, "lid", "lidHeight = 2\n");
    expect(selectCadComponentId(next, selectedId)).toBe(selectedId);
    expect(selectCadComponentId(next, selectedId, next.activeId)).toBe(next.activeId);
  });

  it("finds a real part when the document still points to the starter or generated instructions", () => {
    const initial = cadDoc(DEFAULT_KCL);
    const starterId = initial.activeId;
    const saved = upsertPartScript(initial, "recorder-base", SAVED_PART);
    const partId = saved.activeId;
    const instructionsId = saved.components.find(
      (component) => component.kind === "instructions",
    )!.id;
    for (const activeId of [starterId, instructionsId]) {
      const doc = setActiveComponent(saved, activeId);
      expect(selectCadComponentId(doc, starterId)).toBe(partId);
      expect(selectCadComponentId(doc, "deleted-component")).toBe(partId);
    }
    expect(selectCadComponentId(saved, instructionsId)).toBe(instructionsId);
  });
});
