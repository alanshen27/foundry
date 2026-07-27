import type { ReactNode } from "react";

/**
 * Screenshot targets for the copilot vision loop.
 *
 * In dev, Next injects its dev-tools badge into a `<nextjs-portal>` on every
 * page, which lands in the corner of every capture. Hiding it here keeps it
 * available on the real app instead of disabling `devIndicators` globally.
 */
const CAPTURE_CHROME_CSS = `
  nextjs-portal { display: none !important; }
  html, body { margin: 0; overflow: hidden; }
`;

export default function RenderLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: CAPTURE_CHROME_CSS }} />
      {children}
    </>
  );
}
