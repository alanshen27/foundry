import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { CadFeatureTimeline } from "@/components/engineer/cad-feature-timeline";
import { CadTransformGizmo } from "@/components/engineer/cad-transform-gizmo";

const { createElement } = React;
(globalThis as typeof globalThis & { React: typeof React }).React = React;

describe("CAD controls accessibility", () => {
  it("labels the feature timeline and exposes the current selection", () => {
    const html = renderToStaticMarkup(
      createElement(CadFeatureTimeline, {
        features: [
          {
            id: "feature-1",
            binding: "body",
            label: "Extrude body",
            kind: "solid",
            operation: "extrude",
            isSolid: true,
            lineStart: 4,
            lineEnd: 6,
            parameterNames: [],
            source: "body = extrude(profile, length = 10)",
          },
        ],
        selectedId: "feature-1",
        onSelect: vi.fn(),
      }),
    );

    expect(html).toContain('role="region"');
    expect(html).toContain('aria-label="CAD feature timeline"');
    expect(html).toContain('aria-label="Feature 1: extrude, lines 4 through 6"');
    expect(html).toContain('aria-pressed="true"');
  });

  it("groups transform controls and labels rotation buttons", () => {
    const html = renderToStaticMarkup(
      createElement(CadTransformGizmo, {
        target: "body",
        canEdit: true,
        orientation: { yawDeg: -35, pitchDeg: 28 },
        onTranslate: vi.fn(),
        onRotate: vi.fn(),
      }),
    );

    expect(html).toContain('role="group"');
    expect(html).toContain('aria-label="Transform body"');
    expect(html).toContain('aria-label="Rotate 15 degrees around X axis"');
  });
});
