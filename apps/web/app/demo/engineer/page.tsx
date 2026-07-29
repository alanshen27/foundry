import type { Metadata } from "next";
import { EngineerDemo } from "@/components/demo/engineer-demo";

export const metadata: Metadata = {
  title: "FOUNDRY — Engineer (demo)",
};

/**
 * SIMULATED Engineer workspace for demo recordings. Public route with no
 * auth/DB/Zoo dependencies; everything shown is local, hardcoded demo data.
 */
export default function EngineerDemoPage() {
  return <EngineerDemo />;
}
