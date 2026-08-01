import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { CadLabClient } from "@/components/dev/cad-lab-client";
import { cadLabEnabled } from "@/lib/cad-lab";

export const metadata: Metadata = {
  title: "FOUNDRY — CAD Lab (dev)",
};

// The gate reads CAD_LAB_ENABLED at request time; prerendering would bake a
// permanent 404 into the build output on production deploys.
export const dynamic = "force-dynamic";

/**
 * DEV-ONLY lab for exercising CAD skills/MCPs with a prompt: Zoo ML
 * text-to-CAD / iteration, Zoo MCP KCL tools, and arbitrary stdio CAD MCP
 * servers (e.g. wrappers around earthtojake/text-to-cad skills). Hidden in
 * production unless CAD_LAB_ENABLED=1.
 */
export default function CadLabPage() {
  if (!cadLabEnabled(process.env)) notFound();
  return <CadLabClient />;
}
