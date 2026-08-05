import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { Markdown } from "@/components/copilot/markdown";

describe("Markdown", () => {
  it("renders text in a paragraph by default", () => {
    const html = renderToStaticMarkup(createElement(Markdown, { text: "hello world" }));
    expect(html).toBe('<p class="my-1.5 first:mt-0 last:mb-0">hello world</p>');
  });

  it("renders markdown formatting", () => {
    const html = renderToStaticMarkup(createElement(Markdown, { text: "**bold** and _italic_" }));
    expect(html).toContain("<strong>bold</strong>");
    expect(html).toContain("<em>italic</em>");
  });

  it("renders inline without a paragraph wrapper", () => {
    const html = renderToStaticMarkup(
      createElement(Markdown, { text: "**Considering design details**", inline: true }),
    );
    expect(html).toBe('<span class="inline"><strong>Considering design details</strong></span>');
  });
});
