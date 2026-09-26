/**
 * Client-safe @foundry/cad entry. Do NOT export Zoo MCP / Node child_process
 * adapters here — those live in `@foundry/cad/server`.
 */
export type {
  CadAsset,
  CadAssetFormat,
  CadAssemblyInstance,
  CadLinkedAssembly,
  CadBoundingBox,
  CadComponent,
  CadComponentKind,
  CadDoc,
  CadKclInput,
  CadPort,
  CadResult,
  CadGenOptions,
  CadProjectIterateOptions,
} from "./port";
export { isPlausibleZooOpId } from "./op-id";
export { stableCadHash, buildLinkedAssembly, linkedAssemblyStatus } from "./linked-assembly";
export type { LinkedAssemblyStatus } from "./linked-assembly";
export {
  planAssemblyPlacements,
  renderAssemblyKcl,
  chooseZooOrientation,
  kclWithOrientation,
  scoreOrientedBbox,
  seedAssemblyKcl,
  seedAssemblyPreviewKcl,
  defaultAssemblyIteratePrompt,
  ORIENTATION_CANDIDATES,
  ASSEMBLY_LAYOUT_GAP_MM,
  type AssemblyPlacement,
  type AssemblyRotationDeg,
} from "./assembly-layout";
export {
  DEFAULT_KCL,
  DEFAULT_ASSEMBLY_KCL,
  DEFAULT_INSTRUCTIONS_MD,
  PRODUCT_ASSEMBLY_PATH,
  cadDoc,
  normalizeCadDoc,
  getActiveComponent,
  isCadStarterComponent,
  selectCadComponentId,
  pickCadAssemblyPreview,
  listComponentsByKind,
  setActiveComponent,
  assemblyDropTargetId,
  updateComponentContent,
  removeCadComponents,
  addCadComponent,
  addCadComponents,
  upsertPartScript,
  upsertPartScripts,
  upsertCadContent,
  slugifyCadName,
  cadAssetFormatFromName,
  cadAssetImportMode,
  isEngineCadAssetFormat,
  importAssetPath,
  kclForForeignImport,
  parseForeignImports,
  isForeignImportOnlyScript,
  parseKclModuleImports,
  partModuleAlias,
  displayNameFromCadPath,
  toZooKclPath,
  fromZooKclPath,
  rewriteKclModuleImportPaths,
  insertPartIntoAssembly,
  buildKclProject,
  meshPartProxyKcl,
  ASSEMBLY_STARTER_KCL,
  addCadAsset,
  importMeshAsPart,
} from "./doc";
export type { CadAssetImportMode, KclProjectBuild } from "./doc";
export { parseCadParams, setCadParam, type CadParam } from "./params";
export { pythonCadDoc, upsertPythonPart, upsertPythonParts, upsertPythonCadContent } from "./doc";
export {
  PYTHON_ASSEMBLY_PATH,
  PYTHON_PART_STARTER,
  PYTHON_ASSEMBLY_STARTER,
  isPythonCadComponent,
  pythonPartPath,
  pythonModuleName,
  isPythonProjectPath,
  pythonProjectDependencies,
  buildPythonProject,
} from "./python-project";
export type { PythonProjectBuild } from "./python-project";
