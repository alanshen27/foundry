import {
  footprintDef,
  type PcbDoc,
} from "@/lib/pcb/doc";
import { EMPTY_CIRCUIT, type CircuitDoc } from "@/lib/circuit/catalog";
import { buildRatsnest } from "@/lib/pcb/netlist";

/**
 * Static top-down PCB view for headless copilot screenshots (/render/pcb).
 * No pan/zoom — fits the board into a fixed viewport. Airwires and routed
 * copper are both drawn so the copilot can see what it has connected and what
 * is still outstanding.
 */
export function PcbRenderView({
  doc,
  circuit = EMPTY_CIRCUIT,
}: {
  doc: PcbDoc;
  circuit?: CircuitDoc;
}) {
  const pad = 4;
  const w = doc.board.widthMm;
  const h = doc.board.heightMm;
  const viewW = w + pad * 2;
  const viewH = h + pad * 2;
  const { nets, airwires, issues, routedCount, totalConnections } = buildRatsnest(circuit, doc);

  return (
    <svg
      data-testid="pcb-render"
      viewBox={`${-pad} ${-pad} ${viewW} ${viewH}`}
      width="100%"
      height="100%"
      className="bg-neutral-950"
      role="img"
      aria-label={`PCB ${w}×${h} mm`}
    >
      <rect
        width={w}
        height={h}
        rx={doc.board.cornerRadiusMm}
        ry={doc.board.cornerRadiusMm}
        fill="#1a3d2e"
        stroke="#f0c040"
        strokeWidth={0.25}
      />
      {airwires.map((wire, i) => (
        <line
          key={`${wire.net}-${i}`}
          x1={wire.from.xMm}
          y1={wire.from.yMm}
          x2={wire.to.xMm}
          y2={wire.to.yMm}
          stroke="#d0d0d0"
          strokeWidth={0.09}
          strokeDasharray="0.4 0.3"
          opacity={0.6}
        />
      ))}
      {/* Routed copper, under the footprints so pads stay legible. */}
      {doc.tracks.map((track) => (
        <path
          key={track.id}
          d={track.points.map((p, i) => `${i === 0 ? "M" : "L"} ${p.xMm} ${p.yMm}`).join(" ")}
          fill="none"
          stroke={track.layer === "F.Cu" ? "#c04040" : "#6060d0"}
          strokeWidth={track.widthMm}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      ))}
      {doc.vias.map((via) => (
        <g key={via.id}>
          <circle cx={via.xMm} cy={via.yMm} r={via.diameterMm / 2} fill="#c8a020" />
          <circle cx={via.xMm} cy={via.yMm} r={via.drillMm / 2} fill="#1a3d2e" />
        </g>
      ))}
      {doc.footprints.map((fp) => {
        const def = footprintDef(fp.libraryId);
        if (!def) return null;
        const copper = fp.side === "front" ? "#c04040" : "#6060d0";
        return (
          <g
            key={fp.id}
            transform={`translate(${fp.xMm} ${fp.yMm}) rotate(${fp.rotationDeg})`}
          >
            <rect
              x={-def.bodyWMm / 2}
              y={-def.bodyHMm / 2}
              width={def.bodyWMm}
              height={def.bodyHMm}
              fill="rgb(232 232 224 / 0.12)"
              stroke="#e8e8e0"
              strokeWidth={0.12}
            />
            {def.pads.map((padDef, i) => (
              <rect
                key={i}
                x={padDef.xMm - padDef.wMm / 2}
                y={padDef.yMm - padDef.hMm / 2}
                width={padDef.wMm}
                height={padDef.hMm}
                rx={padDef.shape === "oval" ? Math.min(padDef.wMm, padDef.hMm) / 2 : 0.05}
                fill={copper}
              />
            ))}
            <text
              x={0}
              y={-def.bodyHMm / 2 - 0.4}
              textAnchor="middle"
              fill="#e8e8e0"
              fontSize={1.1}
              fontFamily="ui-monospace, monospace"
            >
              {fp.refDes}
            </text>
          </g>
        );
      })}
      <text
        x={w / 2}
        y={h + pad - 2.4}
        textAnchor="middle"
        fill="#a0a0a0"
        fontSize={1.4}
        fontFamily="ui-monospace, monospace"
      >
        {w}×{h}×{doc.board.thicknessMm} mm · {doc.footprints.length} footprints · {nets.length}{" "}
        nets · {routedCount}/{totalConnections} routed · {airwires.length} airwires
      </text>
      {issues.unlinkedParts.length + issues.unmappedPins.length > 0 ? (
        <text
          x={w / 2}
          y={h + pad - 0.6}
          textAnchor="middle"
          fill="#e0a040"
          fontSize={1.2}
          fontFamily="ui-monospace, monospace"
        >
          {issues.unlinkedParts.length} unplaced · {issues.unmappedPins.length} unmapped pins
        </text>
      ) : null}
    </svg>
  );
}
