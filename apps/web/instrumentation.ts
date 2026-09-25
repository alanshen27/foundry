import type { Instrumentation } from "next";

/**
 * Boot hooks. Everything real lives in instrumentation-node.ts; see its header
 * for why the runtime check has to be written exactly like this.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { registerNode } = await import("./instrumentation-node");
    await registerNode();
  }
}

/**
 * Every uncaught error in a route handler, server component, server action or
 * middleware. Before this hook they only reached the server log.
 */
export const onRequestError: Instrumentation.onRequestError = async (...args) => {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { onRequestErrorNode } = await import("./instrumentation-node");
    await onRequestErrorNode(...args);
  }
};
