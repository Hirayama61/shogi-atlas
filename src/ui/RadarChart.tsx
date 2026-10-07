import type { RadarAxis, RadarAxisKey } from "../core/radar";

interface Props {
  axes: RadarAxis[];
  /** 比較用に薄く重ねる値 (例: 他の対局者の平均)。無い軸は描かない */
  baseline?: Partial<Record<RadarAxisKey, number | null>>;
}

const W = 300;
const H = 250;
const CX = W / 2;
const CY = H / 2 + 2;
const R = 82;
const RINGS = [25, 50, 75, 100];

/**
 * 0〜100 の軸を並べたレーダーチャート。値が null の軸は点を打たず、線もそこで途切らせる。
 * 外周ほど良い。
 */
export function RadarChart({ axes, baseline }: Props) {
  const n = axes.length;
  const angle = (i: number) => -Math.PI / 2 + (2 * Math.PI * i) / n;
  const point = (i: number, v: number) => {
    const r = (R * Math.max(0, Math.min(100, v))) / 100;
    return [CX + r * Math.cos(angle(i)), CY + r * Math.sin(angle(i))] as const;
  };
  const fmt = (p: readonly [number, number]) => `${p[0].toFixed(1)},${p[1].toFixed(1)}`;
  const complete = axes.every((a) => a.score !== null);
  // null で途切れる折れ線 (一周を閉じる)
  const segments: string[] = [];
  for (let i = 0; i < n; i++) {
    const a = axes[i]!;
    const b = axes[(i + 1) % n]!;
    if (a.score === null || b.score === null) continue;
    segments.push(`M${fmt(point(i, a.score))} L${fmt(point((i + 1) % n, b.score))}`);
  }
  const base = baseline ? axes.map((a) => baseline[a.key] ?? null) : [];
  const baseComplete = base.length > 0 && base.every((v) => v !== null);

  return (
    <svg
      className="radar"
      viewBox={`0 0 ${W} ${H}`}
      role="img"
      aria-label={`傾向のレーダーチャート: ${axes
        .map((a) => `${a.label} ${a.score ?? "なし"}`)
        .join("、")}`}
    >
      {RINGS.map((v) => (
        <polygon
          key={v}
          points={axes.map((_, i) => fmt(point(i, v))).join(" ")}
          fill="none"
          stroke="var(--border)"
          strokeWidth={v === 100 ? 1.2 : 0.8}
        />
      ))}
      {axes.map((a, i) => {
        const [x, y] = point(i, 100);
        return (
          <line
            key={a.key}
            x1={CX}
            y1={CY}
            x2={x}
            y2={y}
            stroke="var(--border)"
            strokeWidth={0.8}
          />
        );
      })}
      {baseComplete && (
        <polygon
          className="radar-baseline"
          points={base.map((v, i) => fmt(point(i, v!))).join(" ")}
          fill="none"
          stroke="var(--muted)"
          strokeWidth={1.2}
          strokeDasharray="4 3"
        />
      )}
      {complete && (
        <polygon
          points={axes.map((a, i) => fmt(point(i, a.score!))).join(" ")}
          fill="var(--accent)"
          fillOpacity={0.18}
          stroke="none"
        />
      )}
      <path d={segments.join(" ")} fill="none" stroke="var(--accent)" strokeWidth={2} />
      {axes.map((a, i) =>
        a.score === null ? null : (
          <circle
            key={a.key}
            cx={point(i, a.score)[0]}
            cy={point(i, a.score)[1]}
            r={3}
            fill="var(--accent)"
          />
        ),
      )}
      {axes.map((a, i) => {
        const [x, y] = point(i, 122);
        const cos = Math.cos(angle(i));
        const anchor = Math.abs(cos) < 0.2 ? "middle" : cos > 0 ? "start" : "end";
        return (
          <text
            key={a.key}
            x={x}
            y={y + 4}
            fontSize={11}
            textAnchor={anchor}
            fill={a.score === null ? "var(--muted)" : "var(--text)"}
          >
            {a.label} <tspan fontWeight={700}>{a.score ?? "-"}</tspan>
          </text>
        );
      })}
    </svg>
  );
}
