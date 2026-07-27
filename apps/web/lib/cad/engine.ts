/**
 * CAD document helpers for Zoo KCL models. Geometry evaluation runs in the
 * Zoo engine (browser WebRTC via @kittycad/lib, or ML APIs server-side).
 */
export {
  DEFAULT_KCL as DEFAULT_SCRIPT,
  DEFAULT_ASSEMBLY_KCL,
  DEFAULT_INSTRUCTIONS_MD,
  cadDoc,
  normalizeCadDoc,
  getActiveComponent,
  listComponentsByKind,
  setActiveComponent,
  updateComponentContent,
  addCadComponent,
  addCadComponents,
  upsertPartScript,
  upsertPartScripts,
  upsertCadContent,
  slugifyCadName,
  cadAssetFormatFromName,
  importAssetPath,
  kclForForeignImport,
  parseForeignImports,
  isForeignImportOnlyScript,
  parseKclModuleImports,
  partModuleAlias,
  insertPartIntoAssembly,
  buildKclProject,
  addCadAsset,
  importMeshAsPart,
  type CadDoc,
  type CadComponent,
  type CadComponentKind,
  type CadAsset,
  type CadAssetFormat,
  type KclProjectBuild,
} from "@foundry/cad";

export type CadView = "orbit" | "iso" | "front" | "top" | "right";
