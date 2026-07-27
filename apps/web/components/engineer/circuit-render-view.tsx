"use client";

import dynamic from "next/dynamic";

// The inner view registers Lit web components, which only exist client-side.
export const CircuitRenderView = dynamic(
  () => import("./circuit-render-inner").then((m) => m.CircuitRenderInner),
  { ssr: false },
);
