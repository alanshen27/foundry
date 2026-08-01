/**
 * CadPort: the only CAD/geometry surface app code may use.
 * Implementation: Zoo (KittyCAD) GPU B-Rep engine + ML text-to-CAD.
 */

/** Part / assembly KCL, or markdown assembly instructions. */
export type CadComponentKind = "part" | "assembly" | "instructions";

/** Native, neutral, mesh, drawing, and electronics project resources. */
export type CadAssetFormat =
  | "kcl"
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
  /** Imported resources. Engine-readable geometry may be referenced by KCL. */
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

/** Options for Zoo multi-file Text-to-CAD iteration (reuse existing project files). */
export type CadProjectIterateOptions = CadGenOptions & {
  /**
   * Relative Zoo path to focus edits on (e.g. `assembly/product.kcl`).
   * Sent as a whole-file source_range so parts stay stable.
   */
  focusPath?: string;
  /** Override Zookeeper tools (default: edit_kcl_code). Use text_to_cad for preview assemblies. */
  forcedTools?: Array<"edit_kcl_code" | "text_to_cad">;
};

/** Axis-aligned bbox from Zoo MCP `calculate_bounding_box_kcl` (mm by default). */
export type CadBoundingBox = {
  center: { x: number; y: number; z: number };
  dimensions: { x: number; y: number; z: number };
};

export type CadKclInput = {
  /** Inline KCL source (single file). */
  code?: string;
  /** Absolute path to a .kcl file or project directory with main.kcl. */
  projectDir?: string;
};

export interface CadPort {
  /** Generate parametric KCL from a natural-language prompt (Zoo ML). */
  textToCad(prompt: string, opts?: CadGenOptions): Promise<CadResult<{ kcl: string; id: string }>>;
  /**
   * Generate KCL from a prompt, keeping every file Zoo returns.
   *
   * Assembly prompts come back as a multi-file project (`main.kcl` importing
   * per-component files), so `textToCad`'s single-file result is unusable for
   * them: `main.kcl` alone fails to execute on its missing imports.
   */
  textToCadProject(
    prompt: string,
    opts?: CadGenOptions,
  ): Promise<CadResult<{ files: Record<string, string>; id: string }>>;
  /** Edit existing KCL with a natural-language prompt (Zoo ML). */
  iterateCad(
    kcl: string,
    prompt: string,
    opts?: CadGenOptions,
  ): Promise<CadResult<{ kcl: string; id: string }>>;
  /**
   * Iterate a multi-file KCL project with Zoo ML, keeping prior components as
   * file attachments (`POST /ml/text-to-cad/multi-file/iteration`).
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
}
