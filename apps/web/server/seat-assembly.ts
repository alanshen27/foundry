import "server-only";
import { isPythonCadComponent, type CadAssemblyInstance, type CadDoc } from "@foundry/cad";
import { runPythonCad } from "@foundry/cad/server";
import { normalizePcbSet, type PcbSet } from "@/lib/pcb/doc";
import { displayLocalSeat, pickHousingComponent, seatPcbPose } from "@/lib/integration/seat-pcb";

/**
 * Move each upright PCB so its display top meets the housing top face.
 * Measures the housing with the local kernel. A failed measure leaves the
 * model's pose in place.
 */
export async function seatPcbInstances(
  cad: CadDoc,
  pcb: PcbSet | null,
  instances: CadAssemblyInstance[],
): Promise<{ instances: CadAssemblyInstance[]; notes: string[] }> {
  if (!pcb) return { instances, notes: [] };
  const parts = cad.components.filter((part) => part.kind === "part" && isPythonCadComponent(part));
  const housingPart = pickHousingComponent(parts);
  if (!housingPart) return { instances, notes: [] };
  const housing = instances.find(
    (instance) => instance.componentId === housingPart.id && instance.visible,
  );
  if (!housing) return { instances, notes: [] };

  const boards = new Map(
    normalizePcbSet(pcb).boards.map((board) => [board.id ?? "board-1", board]),
  );
  const targets = instances.flatMap((instance) => {
    const part = parts.find((item) => item.id === instance.componentId);
    const boardId = part?.source?.kind === "pcb" ? part.source.boardId : null;
    const board = boardId ? boards.get(boardId) : undefined;
    const display = board ? displayLocalSeat(board) : null;
    return display && part ? [{ instance, display, name: part.name }] : [];
  });
  if (!targets.length) return { instances, notes: [] };

  const files = Object.fromEntries(parts.map((part) => [part.path, part.content]));
  const measured = await runPythonCad({
    files,
    entryPath: housingPart.path,
    timeoutMs: 60_000,
  });
  if (!measured.ok) {
    return {
      instances,
      notes: [`Left PCB placement unchanged: could not measure ${housingPart.name}.`],
    };
  }
  const box = {
    center: measured.data.bbox.center,
    size: measured.data.bbox.dimensions,
  };
  const notes: string[] = [];
  const next = instances.map((instance) => {
    const target = targets.find((item) => item.instance.id === instance.id);
    if (!target) return instance;
    const seated = seatPcbPose(instance, housing, box, target.display);
    if (seated.moved) notes.push(`${target.name}: ${seated.text}`);
    return seated.instance;
  });
  return { instances: next, notes };
}
