import { afterEach, describe, expect, it, vi } from "vitest";
import React, { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  WorkspaceUiPreviewContext,
  useWorkspaceUiPreview,
  type WorkspaceUiPreview,
} from "@/components/dev/workspace-ui-preview";
import { recorderFixtureMesh } from "@/components/dev/workspace-ui-mesh";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

function PreviewState() {
  return createElement("span", null, useWorkspaceUiPreview() ? "LOCAL" : "LIVE");
}

describe("workspace UI preview isolation", () => {
  it("only allows a scoped fixture override outside production", () => {
    vi.stubGlobal("React", React);
    const preview = { meshResponse: vi.fn(), chatTransport: {} } as unknown as WorkspaceUiPreview;
    const component = createElement(
      WorkspaceUiPreviewContext.Provider,
      { value: preview },
      createElement(PreviewState),
    );
    vi.stubEnv("NODE_ENV", "development");
    expect(renderToStaticMarkup(component)).toContain("LOCAL");
    expect(renderToStaticMarkup(createElement(PreviewState))).toContain("LIVE");
    vi.stubEnv("NODE_ENV", "production");
    expect(renderToStaticMarkup(component)).toContain("LIVE");
  });

  it("provides deterministic self-contained sample meshes with labeled parts", () => {
    const mesh = recorderFixtureMesh();
    const header = new DataView(mesh.buffer);
    expect(header.getUint32(0, true)).toBe(0x46546c67);
    expect(header.getUint32(8, true)).toBe(mesh.byteLength);
    const json = JSON.parse(
      new TextDecoder().decode(mesh.slice(20, 20 + header.getUint32(12, true))),
    ) as {
      asset: { generator: string };
      nodes: Array<{ name: string }>;
      buffers: Array<{ uri?: string }>;
    };
    expect(json.asset.generator).toContain("LOCAL / UNVERIFIED");
    expect(json.nodes.map((node) => node.name)).toContain("Main PCB");
    expect(json.buffers.every((buffer) => !buffer.uri)).toBe(true);
    expect(recorderFixtureMesh()).toEqual(mesh);
    const part = recorderFixtureMesh("top");
    expect(part.length).toBeLessThan(mesh.length);
  });
});
