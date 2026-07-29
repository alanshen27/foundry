import type { Metadata } from "next";
import { EngineerDemo } from "@/components/demo/engineer-demo";

export const metadata: Metadata = {
  title: "FOUNDRY — Engineer (demo)",
};

/**
 * SIMULATED Engineer workspace for demo recordings. Public route with no
 * auth/DB dependencies; the chat run is scripted locally. When
 * ZOO_API_TOKEN is configured the model renders through the real Zoo
 * engine viewport; otherwise it falls back to a local three.js stand-in.
 */
export default function EngineerDemoPage() {
  const token = process.env.ZOO_API_TOKEN?.trim();
  return <EngineerDemo engine={token ? { token, baseUrl: "https://api.zoo.dev" } : null} />;
}
