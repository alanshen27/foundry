/**
 * The copilot's project tools.
 *
 * The tools themselves live in ./project-tools, one module per domain —
 * project state, electronics, CAD, renders, verification and code — so each
 * group can be read, changed and tested on its own. This file keeps the
 * import path every caller already uses.
 */

export { buildProjectTools, withToolLogging, type ToolContext } from "./project-tools";
