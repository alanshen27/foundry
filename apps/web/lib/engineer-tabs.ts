/**
 * Engineer document tabs — Assembly is the pinned home; CAD / Schematic / PCB
 * open as closable tabs (Chrome / Fusion style). `code` maps `?view=code` for
 * the process-footer Repository surface (not a document tab).
 */
export type EngineerDocKind = "assembly" | "model" | "schematic" | "pcb" | "code";

export type EngineerDocTab =
  | { key: "assembly"; kind: "assembly"; label: string; pinned: true }
  | {
      key: string;
      kind: "model" | "schematic" | "pcb" | "code";
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
  }
}

/** Map legacy ?view= values onto a document tab. */
export function tabFromViewParam(
  view: string | undefined,
  partId?: string | null,
): EngineerDocTab {
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
  // sourcing / design / missing → home
  return ASSEMBLY_TAB;
}

export function viewParamForTab(tab: EngineerDocTab): string {
  return tab.kind;
}
