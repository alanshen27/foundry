/**
 * Re-export: the KCL parameter grammar lives in `@foundry/cad` so non-web
 * consumers can share it. Kept here for the existing `@/lib/cad/params`
 * import path.
 */
export { parseCadParams, setCadParam, type CadParam } from "@foundry/cad";
