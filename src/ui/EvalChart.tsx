import { useId, useMemo, useState } from "react";
import { JUDGEMENT_LABEL, type MoveReview } from "../core/analysis";
import { fmtCp } from "./labels";

interface Props {
  curve: Array<{ ply: number; cp: number }>;
  moves: MoveReview[];
  currentPly: number;
  onSelect: (ply: number) => void;
}

const W = 600;
const H = 160;
const PAD = { top: 10, right: 12, bottom: 22, left: 40 };
/** 表示範囲。これを超える評価値は端に張り付かせる */
const LIMIT = 2000;

const MARK: Record<string, string> = { inaccuracy: "?!", mistake: "?", blunder: "??" };

/**
 * 評価値の推移 (先手視点)。1 系列の折れ線 + 0 の基準線 + 悪手の印。
 * ホバーで手数と評価値を出し、クリックでその手数に移動する。
 */
export function EvalChart({ curve, moves, currentPly, onSelect }: Props) {
  const [hover, setHover] = useState<number | null>(null);
  const clipId = useId();
  const maxPly = Math.max(1, curve.length - 1);
  const x = (ply: number) => PAD.left + (ply / maxPly) * (W - PAD.left - PAD.right);
  const y = (cp: number) => {
    const v = Math.max(-LIMIT, Math.min(LIMIT, cp));
    return PAD.top + ((LIMIT - v) / (2 * LIMIT)) * (H - PAD.top - PAD.bottom);
  };
  const path = useMemo(
    () =>
      curve
        .map((c, i) => `${i === 0 ? "M" : "L"}${x(c.ply).toFixed(1)},${y(c.cp).toFixed(1)}`)
        .join(" "),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [curve],
  );
  const marks = moves.filter((m) => m.judgement !== "good");
  const byPly = new Map(curve.map((c) => [c.ply, c.cp] as const));
  const shown = hover ?? currentPly;
  const shownCp = byPly.get(shown);
  const ticks = [-LIMIT, -1000, 0, 1000, LIMIT];

  const plyFromEvent = (e: { clientX: number; currentTarget: SVGSVGElement }) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const px = ((e.clientX - rect.left) / rect.width) * W;
    const ply = Math.round(((px - PAD.left) / (W - PAD.left - PAD.right)) * maxPly);
    return Math.max(0, Math.min(maxPly, ply));
  };

  return (
    <div className="eval-chart">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-label="評価値の推移"
        onPointerMove={(e) => setHover(plyFromEvent(e))}
        onPointerLeave={() => setHover(null)}
        onClick={(e) => onSelect(plyFromEvent(e))}
      >
        <defs>
          <clipPath id={clipId}>
            <rect
              x={PAD.left}
              y={PAD.top}
              width={W - PAD.left - PAD.right}
              height={H - PAD.top - PAD.bottom}
            />
          </clipPath>
        </defs>
        {ticks.map((t) => (
          <g key={t}>
            <line
              x1={PAD.left}
              x2={W - PAD.right}
              y1={y(t)}
              y2={y(t)}
              stroke="var(--border)"
              strokeWidth={t === 0 ? 1.5 : 1}
            />
            <text x={PAD.left - 6} y={y(t) + 3} fontSize={9} textAnchor="end" fill="var(--muted)">
              {t === LIMIT ? `+${t}` : t}
            </text>
          </g>
        ))}
        <path
          d={path}
          fill="none"
          stroke="var(--accent)"
          strokeWidth={2}
          clipPath={`url(#${clipId})`}
        />
        {marks.map((m) => (
          <text
            key={m.ply}
            x={x(m.ply)}
            y={y(byPly.get(m.ply) ?? 0) + (m.side === "black" ? 14 : -6)}
            fontSize={10}
            fontWeight={700}
            textAnchor="middle"
            fill="var(--danger)"
          >
            <title>
              {m.ply}手目 {JUDGEMENT_LABEL[m.judgement]}
            </title>
            {MARK[m.judgement]}
          </text>
        ))}
        {shownCp !== undefined && (
          <g>
            <line
              x1={x(shown)}
              x2={x(shown)}
              y1={PAD.top}
              y2={H - PAD.bottom}
              stroke="var(--muted)"
              strokeWidth={1}
            />
            <circle
              cx={x(shown)}
              cy={y(shownCp)}
              r={4}
              fill="var(--accent)"
              stroke="var(--panel)"
              strokeWidth={2}
            />
          </g>
        )}
        <text x={W - PAD.right} y={H - 6} fontSize={9} textAnchor="end" fill="var(--muted)">
          {maxPly}手
        </text>
        <text x={PAD.left} y={H - 6} fontSize={9} fill="var(--muted)">
          先手有利 ↑ / 後手有利 ↓
        </text>
      </svg>
      <div className="muted eval-readout">
        {shownCp !== undefined ? (
          <>
            <strong>{shown}手目</strong> 評価値 {fmtCp(shownCp)}
          </>
        ) : (
          "　"
        )}
      </div>
    </div>
  );
}
