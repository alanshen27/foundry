/**
 * Workspace documents. Single-instance surfaces (Assembly / PCB / Checks /
 * Repository / Ideate / Verify / Launch / Renders) are permanent top-bar
 * buttons; only multi-component surfaces (CAD / Schematic) open as closable
 * tabs.
 */
export type EngineerDocKind =
  | "assembly"
  | "model"
  | "schematic"
  | "pcb"
  | "code"
  | "checks"
  | "ideate"
  | "verify"
  | "launch"
  | "renders";

export type EngineerDocTab =
  | { key: "assembly"; kind: "assembly"; label: string; pinned: true }
  | {
      key: string;
      kind: Exclude<EngineerDocKind, "assembly">;
      label: string;
      pinned?: false;
      /** CadDoc component id when kind === "model". */
      componentId?: string;
    };

export const ASSEMBLY_TAB: EngineerDocTab = {
  key: "assembly",
  kind: "assembly",
  label: "Assembly",
  pinned: true,
};

export function tabKeyFor(
  kind: Exclude<EngineerDocKind, "assembly">,
  componentId?: string,
): string {
  if (kind === "model" && componentId) return `model:${componentId}`;
  return kind;
}

export function labelForKind(kind: EngineerDocKind): string {
  switch (kind) {
    case "assembly":
      return "Assembly";
    case "model":
      return "CAD";
    case "schematic":
      return "Schematic";
    case "pcb":
      return "PCB";
    case "code":
      return "Repository";
    case "checks":
      return "Checks";
    case "ideate":
      return "Ideate";
    case "verify":
      return "Verify";
    case "launch":
      return "Launch";
    case "renders":
      return "Renders";
  }
}

/** Map legacy ?view= values onto a document tab. */
export function tabFromViewParam(view: string | undefined, partId?: string | null): EngineerDocTab {
  if (view === "model") {
    return {
      key: tabKeyFor("model", partId ?? undefined),
      kind: "model",
      label: partId ? "CAD" : "CAD",
      componentId: partId ?? undefined,
    };
  }
  if (view === "pcb") {
    return { key: "pcb", kind: "pcb", label: "PCB" };
  }
  if (view === "schematic") {
    return { key: "schematic", kind: "schematic", label: "Schematic" };
  }
  if (view === "code") {
    return { key: "code", kind: "code", label: "Repository" };
  }
  if (view === "checks") {
    return { key: "checks", kind: "checks", label: "Checks" };
  }
  if (view === "ideate" || view === "verify" || view === "launch" || view === "renders") {
    return { key: view, kind: view, label: labelForKind(view) };
  }
  // sourcing / design / missing → home
  return ASSEMBLY_TAB;
}

export function viewParamForTab(tab: EngineerDocTab): string {
  return tab.kind;
}
