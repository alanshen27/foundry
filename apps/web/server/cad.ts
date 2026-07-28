import "server-only";
import { getServerEnv } from "@foundry/config";
import { createZooCadAdapter, type CadPort } from "@foundry/cad/server";

let instance: CadPort | undefined;

/** Zoo CAD port — ML text-to-CAD / KCL iteration / Zoo MCP. Requires ZOO_API_TOKEN. */
export function getCad(): CadPort {
  if (instance) return instance;
  const env = getServerEnv();
  const token = env.ZOO_API_TOKEN?.trim();
  if (!token) {
    throw new Error(
      "ZOO_API_TOKEN is not configured. Add it to the root .env (see .env.example).",
    );
  }
  instance = createZooCadAdapter({ token });
  return instance;
}

export { getZooEngineToken } from "./zoo-token";
