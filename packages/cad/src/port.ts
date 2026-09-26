/**
 * CadPort: the only CAD/geometry surface app code may use.
 * Implementation: Astra KCL generation + Zoo (KittyCAD) GPU B-Rep geometry.
 */

/** Part / assembly KCL, or markdown assembly instructions. */
export type CadComponentKind = "part" | "assembly" | "instructions";

/** Native, neutral, mesh, drawing, and electronics project resources. */
export type CadAssetFormat =
  | "kcl"
  | "py"
  | "brep"
  | "stl"
  | "step"
  | "stp"
  | "ste"
  | "obj"
  | "gltf"
  | "glb"
  | "ply"
  | "fbx"
  | "sat"
  | "sab"
  | "smb"
  | "smt"
  | "catpart"
  | "catproduct"
  | "prt"
  | "asm"
  | "g"
  | "neu"
  | "ipt"
  | "iam"
  | "x_t"
  | "x_b"
  | "sldprt"
  | "sldasm"
  | "f3d"
  | "cam360"
  | "ige"
  | "iges"
  | "igs"
  | "3mf"
  | "3dm"
  | "skp"
  | "dwg"
  | "dxf"
  | "svg"
  | "jt"
  | "tsm"
  | "wire"
  | "123dx"
  | "sch"
  | "brd"
  | "kicad_sch"
  | "kicad_pcb"
  | "kicad_pro"
  | "kicad_prl";

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
  /** Provenance of a generated board part; fingerprints never authorize writes. */
  source?: {
    kind: "pcb";
    boardId: string;
    sourceHash: string;
    generatedHash: string;
  };
};

/** Explicit, unsolved placement in CAD millimetres. Rotation is global X, then Y, then Z. */
export type CadAssemblyInstance = {
  id: string;
  componentId: string;
  translationMm: { x: number; y: number; z: number };
  rotationDeg: { x: number; y: number; z: number };
  visible: boolean;
  /** Locks interactive placement; it is not a solved mate or engineering approval. */
  fixed: boolean;
};

export type CadLinkedAssembly = {
  version: 1;
  instances: CadAssemblyInstance[];
  sourceHash: string;
  generatedHash: string;
};

/**
 * Multi-component mechanical workspace persisted as DesignDoc MODEL3D.
 * `script` mirrors the active executable component for older callers.
 */
export type CadDoc = {
  version: 5;
  engine: "zoo" | "build123d";
  activeId: string;
  components: CadComponent[];
  /** Imported resources. Engine-readable geometry may be referenced by KCL. */
  assets?: CadAsset[];
  /** Present only after an explicit linked-assembly build. */
  assembly?: CadLinkedAssembly;
  /** Executable KCL for the active part/assembly (compat mirror). */
  script: string;
};

export type CadResult<T> = { ok: true; data: T } | { ok: false; error: string };

export type CadGenOptions = {
  projectName?: string;
  /** Cancel generation early (chat stop / run cancel). */
  signal?: AbortSignal;
  /**
   * Hard ceiling for the whole turn. Generations can run for minutes, so a
   * caller holding a request open needs its own bound rather than the
   * adapter's default.
   */
  timeoutMs?: number;
  /**
   * Progress of a long generation. Lets a caller show the current phase
   * instead of an unbounded spinner.
   */
  onProgress?: (note: string) => void;
  /** Incomplete, unvalidated source for live display only. Never execute or save a draft. */
  onDraft?: (file: { path: string; content: string }) => void;
  /**
   * @deprecated Legacy Zoo operation resume only. Astra rejects this option;
   * issue a new generation with a prompt instead.
   */
  existingOpId?: string;
};

/** Options for multi-file KCL iteration (reuse existing project files). */
export type CadProjectIterateOptions = CadGenOptions & {
  /**
   * Relative project path to focus edits on (e.g. `assembly/product.kcl`).
   * Other files remain read-only references for Astra.
   */
  focusPath?: string;
  /** @deprecated Legacy Zookeeper tool selection; ignored by Astra. */
  forcedTools?: Array<"edit_kcl_code" | "text_to_cad">;
};

/** Axis-aligned bbox from Zoo MCP `calculate_bounding_box_kcl` (mm by default). */
export type CadBoundingBox = {
  center: { x: number; y: number; z: number };
  dimensions: { x: number; y: number; z: number };
};

export type CadKclInput = {
  /** Cancel geometry execution or export when the caller stops waiting. */
  signal?: AbortSignal;
  /** Inline KCL source (single file). */
  code?: string;
  /** Absolute path to a .kcl file or project directory with main.kcl. */
  projectDir?: string;
};

export interface CadPort {
  /** Generate parametric KCL from a natural-language prompt. */
  textToCad(prompt: string, opts?: CadGenOptions): Promise<CadResult<{ kcl: string; id: string }>>;
  /**
   * Generate KCL from a prompt, keeping every returned file.
   *
   * Assembly prompts come back as a multi-file project (`main.kcl` importing
   * per-component files), so `textToCad`'s single-file result is unusable for
   * them: `main.kcl` alone fails to execute on its missing imports.
   */
  textToCadProject(
    prompt: string,
    opts?: CadGenOptions,
  ): Promise<CadResult<{ files: Record<string, string>; id: string }>>;
  /** Edit existing KCL with a natural-language prompt. */
  iterateCad(
    kcl: string,
    prompt: string,
    opts?: CadGenOptions,
  ): Promise<CadResult<{ kcl: string; id: string }>>;
  /**
   * Iterate a multi-file KCL project, keeping prior components as references.
   * Returns the full project outputs map (path → KCL).
   */
  iterateCadProject(
    files: Record<string, string>,
    prompt: string,
    opts?: CadProjectIterateOptions,
  ): Promise<CadResult<{ files: Record<string, string>; id: string }>>;
  /** Zoo MCP: execute KCL and return compile/runtime issues. */
  executeKcl(input: CadKclInput): Promise<CadResult<{ message: string }>>;
  /** Zoo MCP: axis-aligned bounding box of executed KCL. */
  boundingBoxKcl(input: CadKclInput & { unit?: string }): Promise<CadResult<CadBoundingBox>>;
  /** Zoo MCP: front/right/top/iso collage JPEG of executed KCL. */
  multiviewSnapshotKcl(input: CadKclInput): Promise<CadResult<{ jpeg: Buffer }>>;
  /** Zoo MCP: execute KCL and export geometry for the Three.js viewport. */
  exportGlb(input: CadKclInput): Promise<CadResult<{ glb: Buffer }>>;
}
