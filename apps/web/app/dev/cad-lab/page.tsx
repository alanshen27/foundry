import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { CadLabClient } from "@/components/dev/cad-lab-client";
import { cadLabEnabled } from "@/lib/cad-lab";

export const metadata: Metadata = {
  title: "FOUNDRY — CAD Lab (dev)",
};

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
