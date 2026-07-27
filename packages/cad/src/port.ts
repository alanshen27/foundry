/**
 * CadPort: the only CAD/geometry surface app code may use.
 * Implementation: Zoo (KittyCAD) GPU B-Rep engine + ML text-to-CAD.
 */

/** Part / assembly KCL, or markdown assembly instructions. */
export type CadComponentKind = "part" | "assembly" | "instructions";

/** Mesh / B-Rep files referenced by KCL foreign `import` statements. */
export type CadAssetFormat = "stl" | "step" | "stp" | "obj" | "gltf" | "glb" | "ply";

export type CadAsset = {
  id: string;
  name: string;
  /** Workspace-relative path, e.g. `imports/bracket.stl`. */
  path: string;
  format: CadAssetFormat;
  /** Object-storage key under `projects/{projectId}/…`. */
  storageKey: string;
  sizeBytes: number;
  /** Length unit for unitless formats (STL/OBJ/PLY). Default mm. */
  lengthUnit?: "mm" | "cm" | "m" | "in" | "ft" | "yd";
};

export type CadComponent = {
  id: string;
  name: string;
  /** Workspace-relative path, e.g. `parts/enclosure.kcl`. */
  path: string;
  kind: CadComponentKind;
  /** KCL for part/assembly; markdown for instructions. */
  content: string;
};

/**
 * Multi-component mechanical workspace persisted as DesignDoc MODEL3D.
 * `script` mirrors the active executable component for older callers.
 */
export type CadDoc = {
  version: 5;
  engine: "zoo";
  activeId: string;
  components: CadComponent[];
  /** Foreign mesh/B-Rep files for KCL `import "…"`. */
  assets?: CadAsset[];
  /** Executable KCL for the active part/assembly (compat mirror). */
  script: string;
};

export type CadResult<T> = { ok: true; data: T } | { ok: false; error: string };

export type CadGenOptions = {
  projectName?: string;
  /** Cancel Zoo polling early (chat stop / run cancel). */
  signal?: AbortSignal;
  /**
   * Resume or fetch an existing Zoo text-to-CAD operation instead of creating
   * a new one (e.g. after timeout, worker restart, or cancel once Zoo finished).
   */
  existingOpId?: string;
};

export interface CadPort {
  /** Generate parametric KCL from a natural-language prompt (Zoo ML). */
  textToCad(prompt: string, opts?: CadGenOptions): Promise<CadResult<{ kcl: string; id: string }>>;
  /** Edit existing KCL with a natural-language prompt (Zoo ML). */
  iterateCad(kcl: string, prompt: string, opts?: CadGenOptions): Promise<CadResult<{ kcl: string; id: string }>>;
}
