import {
  footprintDef,
  type PcbDoc,
} from "@/lib/pcb/doc";

/**
 * Static top-down PCB view for headless copilot screenshots (/render/pcb).
 * No pan/zoom — fits the board into a fixed viewport.
 */
export function PcbRenderView({ doc }: { doc: PcbDoc }) {
  const pad = 4;
  const w = doc.board.widthMm;
  const h = doc.board.heightMm;
  const viewW = w + pad * 2;
  const viewH = h + pad * 2;

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
        y={h + pad - 0.8}
        textAnchor="middle"
        fill="#a0a0a0"
        fontSize={1.4}
        fontFamily="ui-monospace, monospace"
      >
        {w}×{h}×{doc.board.thicknessMm} mm · {doc.footprints.length} footprints
      </text>
    </svg>
  );
}
