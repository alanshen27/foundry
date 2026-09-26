import type { Metadata } from "next";
import { EngineerDemo } from "@/components/demo/engineer-demo";

export const metadata: Metadata = {
  title: "FOUNDRY — Engineer (demo)",
};

/** Public scripted demo. Live geometry export is available in development only. */
export default function EngineerDemoPage() {
  return <EngineerDemo />;
}
