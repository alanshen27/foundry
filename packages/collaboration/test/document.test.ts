import * as Y from "yjs";
import { describe, expect, it } from "vitest";
import {
  applyDesignSnapshot,
  applyTextSnapshot,
  readDesignDocument,
  MAX_DESIGN_TEXT_LENGTH,
} from "../src/document";

const source = "width = 40\nlength = 50\nheight = 10\nwall = 2\nhole = 3\n";
const baseline = {
  version: 5,
  board: { width: 60, height: 40 },
  components: [
    {
      id: "housing",
      name: "Housing",
      content: source,
      source: { kind: "pcb", boardId: "board1", sourceHash: "a", generatedHash: "b" },
    },
    { id: "lid", name: "Lid", content: "lid = 1\n" },
  ],
  instances: [
    {
      id: "body-instance",
      componentId: "housing",
      translationMm: { x: 0, y: 0, z: 0 },
      fixed: false,
    },
  ],
};
function pair() {
  const a = new Y.Doc();
  applyDesignSnapshot(a, null, baseline);
  const b = new Y.Doc();
  Y.applyUpdate(b, Y.encodeStateAsUpdate(a));
  return { a, b };
}
function exchange(a: Y.Doc, b: Y.Doc) {
  const first = Y.encodeStateAsUpdate(a),
    second = Y.encodeStateAsUpdate(b);
  Y.applyUpdate(a, second);
  Y.applyUpdate(b, first);
  expect(readDesignDocument(a)).toEqual(readDesignDocument(b));
}
function snapshot(doc: Y.Doc) {
  return readDesignDocument(doc) as typeof baseline;
}

describe("structured shared design snapshots", () => {
  it("omits optional object fields while rejecting invalid values before any write", () => {
    const doc = new Y.Doc();
    applyDesignSnapshot(doc, null, {
      parts: [{ id: "board", bodyHeightMm: undefined }],
      notes: undefined,
    });
    expect(readDesignDocument(doc)).toEqual({ parts: [{ id: "board" }] });
    applyDesignSnapshot(
      doc,
      { parts: [{ id: "board", bodyHeightMm: undefined }] },
      { parts: [{ id: "board", bodyHeightMm: 4 }] },
    );
    const saved = readDesignDocument(doc);
    for (const invalid of [{ parts: [undefined] }, { x: NaN }, { x: () => 1 }]) {
      expect(() => applyDesignSnapshot(doc, saved, invalid)).toThrow();
      expect(readDesignDocument(doc)).toEqual(saved);
    }
  });

  it("seeds once and rehydrates the same normalized document", () => {
    const { a, b } = pair();
    expect(snapshot(a)).toEqual(baseline);
    applyDesignSnapshot(b, null, { ...baseline, version: 99 });
    expect(snapshot(b)).toEqual(baseline);
    const restored = new Y.Doc();
    Y.applyUpdate(restored, Y.encodeStateAsUpdate(a));
    expect(snapshot(restored)).toEqual(baseline);
  });

  it("merges concurrent physical placement and source metadata edits on the same entity", () => {
    const { a, b } = pair();
    const human = structuredClone(baseline),
      ai = structuredClone(baseline);
    human.instances[0]!.translationMm.x = 20;
    human.components[0]!.name = "New housing";
    ai.instances[0]!.translationMm.z = 12;
    ai.components[0]!.source!.sourceHash = "updated";
    applyDesignSnapshot(a, baseline, human);
    applyDesignSnapshot(b, baseline, ai);
    exchange(a, b);
    expect(snapshot(a).instances[0]!.translationMm).toEqual({ x: 20, y: 0, z: 12 });
    expect(snapshot(a).components[0]).toMatchObject({
      name: "New housing",
      source: { sourceHash: "updated" },
    });
  });

  it("rebases a stale snapshot without writing back its unchanged stale fields", () => {
    const { a } = pair();
    const human = structuredClone(baseline);
    human.board.width = 90;
    applyDesignSnapshot(a, baseline, human);
    const ai = structuredClone(baseline);
    ai.board.height = 70;
    applyDesignSnapshot(a, baseline, ai);
    expect(snapshot(a).board).toEqual({ width: 90, height: 70 });
  });

  it("preserves both disjoint middle-line human and AI text changes", () => {
    const { a, b } = pair();
    const human = structuredClone(baseline),
      ai = structuredClone(baseline);
    human.components[0]!.content = source.replace("height = 10", "height = 18");
    ai.components[0]!.content = source
      .replace("length = 50", "length = 62")
      .replace("wall = 2", "wall = 3.5");
    applyDesignSnapshot(a, baseline, human);
    applyDesignSnapshot(b, baseline, ai);
    exchange(a, b);
    expect(snapshot(a).components[0]!.content).toBe(
      "width = 40\nlength = 62\nheight = 18\nwall = 3.5\nhole = 3\n",
    );
    // The same intent applied after the remote edit has arrived must also merge.
    const sequential = pair().a;
    applyDesignSnapshot(sequential, baseline, human);
    applyDesignSnapshot(sequential, baseline, ai);
    expect(snapshot(sequential).components[0]!.content).toBe(snapshot(a).components[0]!.content);
  });

  it("converges on one scalar label when the same property is edited concurrently", () => {
    const { a, b } = pair();
    const left = structuredClone(baseline),
      right = structuredClone(baseline);
    left.components[0]!.name = "A";
    right.components[0]!.name = "B";
    applyDesignSnapshot(a, baseline, left);
    applyDesignSnapshot(b, baseline, right);
    exchange(a, b);
    expect(["A", "B"]).toContain(snapshot(a).components[0]!.name);
    const restored = new Y.Doc();
    Y.applyUpdate(restored, Y.encodeStateAsUpdate(b));
    expect(snapshot(restored)).toEqual(snapshot(a));
  });

  it("deleting an entity wins over concurrent and subsequently stale edits without ghosts", () => {
    const { a, b } = pair();
    const deleted = structuredClone(baseline);
    deleted.components.shift();
    const edited = structuredClone(baseline);
    edited.components[0]!.content = "custom = 1\n";
    applyDesignSnapshot(a, baseline, deleted);
    applyDesignSnapshot(b, baseline, edited);
    exchange(a, b);
    expect(snapshot(a).components.map((c) => c.id)).toEqual(["lid"]);
    applyDesignSnapshot(a, baseline, edited);
    expect(snapshot(a).components.map((c) => c.id)).toEqual(["lid"]);
  });

  it("keeps independent additions and a reorder plus source edit without duplicates", () => {
    const { a, b } = pair();
    const left = structuredClone(baseline),
      right = structuredClone(baseline);
    left.components.reverse();
    left.components.push({ id: "screw-a", name: "Screw A", content: "a=1" });
    right.components[0]!.source!.sourceHash = "revised";
    right.components.push({ id: "screw-b", name: "Screw B", content: "b=1" });
    applyDesignSnapshot(a, baseline, left);
    applyDesignSnapshot(b, baseline, right);
    exchange(a, b);
    const ids = snapshot(a).components.map((c) => c.id);
    expect(new Set(ids).size).toBe(4);
    expect(ids.indexOf("lid")).toBeLessThan(ids.indexOf("housing"));
    expect(snapshot(a).components.find((c) => c.id === "housing")!.source!.sourceHash).toBe(
      "revised",
    );
  });

  it("deduplicates concurrent insertion of the same stable entity ID", () => {
    const { a, b } = pair();
    const next = structuredClone(baseline);
    next.components.push({ id: "same", name: "Same", content: "x=1" });
    applyDesignSnapshot(a, baseline, next);
    applyDesignSnapshot(b, baseline, next);
    exchange(a, b);
    expect(snapshot(a).components.filter((c) => c.id === "same")).toHaveLength(1);
  });

  it("rejects malformed/oversized snapshots before applying any field", () => {
    const { a } = pair();
    for (const invalid of [
      { ...baseline, board: { width: NaN, height: 3 } },
      { ...baseline, components: [baseline.components[0], baseline.components[0]] },
      {
        ...baseline,
        board: { width: 99, height: 44 },
        script: "x".repeat(MAX_DESIGN_TEXT_LENGTH + 1),
      },
      { ...baseline, callback: () => 1 },
    ]) {
      expect(() => applyDesignSnapshot(a, baseline, invalid)).toThrow();
      expect(snapshot(a)).toEqual(baseline);
    }
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    expect(() => applyDesignSnapshot(a, baseline, cyclic)).toThrow("cycles");
    const malformed = new Y.Doc();
    malformed.getMap("design").set("value", new Y.Map());
    expect(() => readDesignDocument(malformed)).toThrow();
  });
});

describe("shared code text", () => {
  it("rebases multiple edits around an inserted human line and keeps Unicode intact", () => {
    const doc = new Y.Doc(),
      text = doc.getText("content");
    const before = "one = 1\ntwo = 2\nthree = 3\nfour = 4\n";
    text.insert(0, before);
    text.insert(before.indexOf("three"), "// human 💡\n");
    const after = before.replace("two = 2", "two = 20").replace("four = 4", "four = 40");
    applyTextSnapshot(text, before, after);
    expect(text.toString()).toBe("one = 1\ntwo = 20\n// human 💡\nthree = 3\nfour = 40\n");
    const expected = text.toString();
    applyTextSnapshot(text, before, after);
    expect(text.toString()).toBe(expected);
  });

  it("does not delete another author's inserted text when removing baseline characters", () => {
    const doc = new Y.Doc(),
      text = doc.getText("content");
    text.insert(0, "hello world");
    text.insert(6, "new ");
    applyTextSnapshot(text, "hello world", "hello WORLD");
    expect(text.toString()).toBe("hello new WORLD");
  });
});
