"use client";

import { useState } from "react";
import { CadViewport } from "@/components/engineer/cad-viewport";

/** A deterministic, real kernel check. No AI, account data, or remote CAD calls. */
export function PythonCadLab() {
  const [width, setWidth] = useState(50);
  const script = `from build123d import *\nwidth = ${width}\nresult = Box(width, 35, 6) - Cylinder(8, 10)\nresult.label = "Local mounting plate"\n`;
  return (
    <main className="fixed inset-0 bg-background">
      <div className="absolute inset-x-0 top-0 z-20 flex items-center gap-4 border-b bg-background p-3 text-sm">
        <span>LOCAL / UNVERIFIED · Python → OCCT → Three.js</span>
        <button className="border px-3 py-1" onClick={() => setWidth(width === 50 ? 70 : 50)}>
          Change width · {width} mm
        </button>
      </div>
      <div className="absolute inset-x-0 top-14 bottom-0">
        <CadViewport
          script={script}
          engine="build123d"
          projectFiles={{ "main.py": script }}
          entryPath="main.py"
          modelKey="local-mounting-plate"
        />
      </div>
    </main>
  );
}
