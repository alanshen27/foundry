import { describe, expect, it } from "vitest";
import {
  createEncoder,
  writeVarString,
  writeVarUint,
  writeVarUint8Array,
  toUint8Array,
} from "lib0/encoding";
import { readDocumentUpdate } from "../src/protocol";

function message(room: string, type: number, syncType?: number, data = Uint8Array.of(0, 0)) {
  const e = createEncoder();
  writeVarString(e, room);
  writeVarUint(e, type);
  if (syncType !== undefined) {
    writeVarUint(e, syncType);
    writeVarUint8Array(e, data);
  }
  return toUint8Array(e);
}

describe("Hocuspocus incoming update framing", () => {
  it("reads update and sync-step-2 payloads after the room prefix", () => {
    const update = Uint8Array.of(1, 3, 4, 5);
    expect(readDocumentUpdate(message("codefile:a", 0, 2, update), "codefile:a")).toEqual(update);
    expect(readDocumentUpdate(message("design:p:b:PCB", 4, 1, update), "design:p:b:PCB")).toEqual(
      update,
    );
  });
  it("leaves state-vector and awareness messages to the protocol", () => {
    expect(readDocumentUpdate(message("codefile:a", 0, 0), "codefile:a")).toBeNull();
    expect(readDocumentUpdate(message("codefile:a", 1), "codefile:a")).toBeNull();
  });
  it("rejects cross-room messages and spoofed committed broadcasts", () => {
    expect(() => readDocumentUpdate(message("codefile:b", 0, 2), "codefile:a")).toThrow("match");
    expect(() => readDocumentUpdate(message("codefile:a", 6), "codefile:a")).toThrow("broadcast");
  });
  it("rejects malformed sync and oversized payloads", () => {
    expect(() => readDocumentUpdate(message("codefile:a", 0, 99), "codefile:a")).toThrow("Unknown");
    expect(() => readDocumentUpdate(Uint8Array.of(255), "codefile:a")).toThrow();
    expect(() => readDocumentUpdate(new Uint8Array(16_000_001), "codefile:a")).toThrow("large");
  });
});
