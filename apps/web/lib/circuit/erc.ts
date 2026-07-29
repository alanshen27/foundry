import type { CircuitDoc } from "@/lib/circuit/catalog";

export type CircuitErcIssue = {
  severity: "error" | "warning";
  code:
    | "missing_part"
    | "missing_pin"
    | "self_connection"
    | "duplicate_wire"
    | "conflicting_net_label"
    | "unconnected_part";
  message: string;
  wireId?: string;
  partId?: string;
};

const endpointKey = (part: string, pin: string) => `${part}\0${pin}`;

/**
 * Topology-level electrical rules checking.
 *
 * Component-specific voltage/current rules require a richer symbol library,
 * but these checks stop invalid graph edits before simulation or PCB netlist
 * generation and provide a useful KiCad-style ERC feedback loop.
 */
export function runCircuitErc(doc: CircuitDoc): CircuitErcIssue[] {
  const issues: CircuitErcIssue[] = [];
  const partIds = new Set(doc.parts.map((part) => part.id));
  const connectedParts = new Set<string>();
  const seenWires = new Set<string>();
  const parent = new Map<string, string>();

  const find = (key: string): string => {
    const current = parent.get(key);
    if (!current || current === key) return key;
    const root = find(current);
    parent.set(key, root);
    return root;
  };
  const touch = (key: string) => {
    if (!parent.has(key)) parent.set(key, key);
  };
  const union = (a: string, b: string) => {
    touch(a);
    touch(b);
    const rootA = find(a);
    const rootB = find(b);
    if (rootA !== rootB) parent.set(rootA, rootB);
  };

  for (const wire of doc.wires) {
    const from = wire.from;
    const to = wire.to;
    if (!partIds.has(from.part) || !partIds.has(to.part)) {
      issues.push({
        severity: "error",
        code: "missing_part",
        wireId: wire.id,
        message: `Wire ${wire.id} references a part that is not on this sheet.`,
      });
      continue;
    }
    connectedParts.add(from.part);
    connectedParts.add(to.part);

    if (!from.pin.trim() || !to.pin.trim()) {
      issues.push({
        severity: "error",
        code: "missing_pin",
        wireId: wire.id,
        message: `Wire ${wire.id} has an endpoint without a pin.`,
      });
      continue;
    }

    const a = endpointKey(from.part, from.pin);
    const b = endpointKey(to.part, to.pin);
    if (a === b) {
      issues.push({
        severity: "error",
        code: "self_connection",
        wireId: wire.id,
        message: `Wire ${wire.id} connects a pin back to itself.`,
      });
      continue;
    }

    const pair = [a, b].sort().join("\u0001");
    if (seenWires.has(pair)) {
      issues.push({
        severity: "warning",
        code: "duplicate_wire",
        wireId: wire.id,
        message: `Wire ${wire.id} duplicates an existing connection.`,
      });
    } else {
      seenWires.add(pair);
    }
    union(a, b);
  }

  const labelsByRoot = new Map<string, Set<string>>();
  for (const wire of doc.wires) {
    const label = wire.label?.trim();
    if (!label) continue;
    const key = endpointKey(wire.from.part, wire.from.pin);
    if (!parent.has(key)) continue;
    const root = find(key);
    const labels = labelsByRoot.get(root) ?? new Set<string>();
    labels.add(label);
    labelsByRoot.set(root, labels);
  }
  for (const labels of labelsByRoot.values()) {
    if (labels.size < 2) continue;
    issues.push({
      severity: "error",
      code: "conflicting_net_label",
      message: `Connected wires have conflicting net labels: ${[...labels].sort().join(", ")}.`,
    });
  }

  for (const part of doc.parts) {
    if (connectedParts.has(part.id)) continue;
    issues.push({
      severity: "warning",
      code: "unconnected_part",
      partId: part.id,
      message: `${part.label ?? part.id} has no connected pins.`,
    });
  }

  return issues;
}
