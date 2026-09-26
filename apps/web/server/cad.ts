import "server-only";
import { getServerEnv } from "@foundry/config";
import { createPythonCadAdapter, type CadPort } from "@foundry/cad/server";

let python: ReturnType<typeof createPythonCadAdapter> | undefined;

/** Generation uses Astra; solid evaluation runs locally through build123d/OCCT. */
export function getPythonCad() {
  if (!python) {
    const env = getServerEnv();
    python = createPythonCadAdapter({ apiKey: env.OPENAI_API_KEY, model: env.CAD_MODEL });
  }
  return python;
}

/** Legacy entry points fail closed. An old token cannot enable paid Zoo calls. */
export function getCad(): CadPort {
  throw new Error(
    "Zoo is disabled. Convert this KCL part to Python/build123d to build it locally.",
  );
}
