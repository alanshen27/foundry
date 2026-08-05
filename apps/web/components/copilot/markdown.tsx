"use client";

import { memo } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";

/**
 * Compact markdown renderer for copilot chat bubbles. Styled inline (rather
 * than via the typography plugin) so it stays tight at chat sizes.
 */

const components: Components = {
  p: ({ children }) => <p className="my-1.5 first:mt-0 last:mb-0">{children}</p>,
  a: ({ href, children }) => (
    <a
      href={href}
      target="_blank"
      rel="noreferrer noopener"
      className="text-primary underline underline-offset-2 hover:opacity-80"
    >
      {children}
    </a>
  ),
  ul: ({ children }) => (
    <ul className="my-1.5 list-disc space-y-1 pl-4 first:mt-0 last:mb-0">{children}</ul>
  ),
  ol: ({ children }) => (
    <ol className="my-1.5 list-decimal space-y-1 pl-4 first:mt-0 last:mb-0">{children}</ol>
  ),
  li: ({ children }) => <li className="[&>p]:my-0">{children}</li>,
  h1: ({ children }) => <p className="mt-3 mb-1 text-sm font-semibold first:mt-0">{children}</p>,
  h2: ({ children }) => <p className="mt-3 mb-1 text-sm font-semibold first:mt-0">{children}</p>,
  h3: ({ children }) => <p className="mt-2.5 mb-1 font-semibold first:mt-0">{children}</p>,
  h4: ({ children }) => <p className="mt-2 mb-0.5 font-semibold first:mt-0">{children}</p>,
  blockquote: ({ children }) => (
    <blockquote className="border-border my-1.5 border-l-2 pl-2.5 italic opacity-90">
      {children}
    </blockquote>
  ),
  hr: () => <hr className="border-border my-2" />,
  code: ({ className, children }) => {
    // Block code gets a language class from react-markdown; inline does not.
    const isBlock = /language-/.test(className ?? "");
    if (isBlock) {
      return <code className="block font-mono text-[11px] leading-relaxed">{children}</code>;
    }
    return (
      <code className="bg-background/70 rounded border px-1 py-px font-mono text-[11px]">
        {children}
      </code>
    );
  },
  pre: ({ children }) => (
    <pre className="bg-background/70 my-1.5 overflow-x-auto rounded-none border p-2.5 first:mt-0 last:mb-0">
      {children}
    </pre>
  ),
  table: ({ children }) => (
    <div className="my-1.5 overflow-x-auto first:mt-0 last:mb-0">
      <table className="w-full border-collapse text-xs">{children}</table>
    </div>
  ),
  th: ({ children }) => (
    <th className="border-border border-b px-2 py-1 text-left font-semibold">{children}</th>
  ),
  td: ({ children }) => <td className="border-border/50 border-b px-2 py-1">{children}</td>,
};

function getMarkdownComponents(inline?: boolean): Components {
  if (!inline) return components;
  return { ...components, p: ({ children }) => <span className="inline">{children}</span> };
}

export const Markdown = memo(function Markdown({
  text,
  inline,
}: {
  text: string;
  inline?: boolean;
}) {
  return (
    <ReactMarkdown remarkPlugins={[remarkGfm]} components={getMarkdownComponents(inline)}>
      {text}
    </ReactMarkdown>
  );
});
