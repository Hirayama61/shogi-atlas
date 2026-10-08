import { baselineValues, closedEdges, type RadarAxis, type RadarAxisKey } from "../core/radar";

interface Props {
  axes: RadarAxis[];
  /** 比較用に点線で重ねる値 (例: 他の対局者の平均)。無い軸で線を途切らせる */
  baseline?: Partial<Record<RadarAxisKey, number | null>>;
  /** 色。既定は画面の CSS 変数。画像に書き出すときは CSS が効かないので実際の色を渡す */
  palette?: RadarPalette;
}

export interface RadarPalette {
  border: string;
  muted: string;
  text: string;
  accent: string;
}

const CSS_PALETTE: RadarPalette = {
  border: "var(--border)",
  muted: "var(--muted)",
  text: "var(--text)",
  accent: "var(--accent)",
};

const W = 300;
const H = 250;
const CX = W / 2;
const CY = H / 2 + 2;
const R = 82;
const RINGS = [25, 50, 75, 100];

const angleOf = (i: number, n: number) => -Math.PI / 2 + (2 * Math.PI * i) / n;
const pointOf = (i: number, n: number, v: number) => {
  const r = (R * Math.max(0, Math.min(100, v))) / 100;
  return [CX + r * Math.cos(angleOf(i, n)), CY + r * Math.sin(angleOf(i, n))] as const;
};
const fmt = (p: readonly [number, number]) => `${p[0].toFixed(1)},${p[1].toFixed(1)}`;

/** 一周を閉じる折れ線を M/L で返す。null の軸で途切れる */
function segmentsOf(values: (number | null)[]): string[] {
  const n = values.length;
  return closedEdges(values).map(
    ([i, j]) => `M${fmt(pointOf(i, n, values[i]!))} L${fmt(pointOf(j, n, values[j]!))}`,
  );
}

/**
 * 0〜100 の軸を並べたレーダーチャート。値が null の軸は点を打たず、線もそこで途切らせる。
 * 外周ほど良い。
 */
export function RadarChart({ axes, baseline, palette = CSS_PALETTE }: Props) {
  const c = palette;
  const n = axes.length;
  const angle = (i: number) => angleOf(i, n);
  const point = (i: number, v: number) => pointOf(i, n, v);
  const complete = axes.every((a) => a.score !== null);
  const segments = segmentsOf(axes.map((a) => a.score));
  const baseSegments = baseline ? segmentsOf(baselineValues(axes, baseline)) : [];

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
          stroke={c.border}
          strokeWidth={v === 100 ? 1.2 : 0.8}
        />
      ))}
      {axes.map((a, i) => {
        const [x, y] = point(i, 100);
        return (
          <line key={a.key} x1={CX} y1={CY} x2={x} y2={y} stroke={c.border} strokeWidth={0.8} />
        );
      })}
      {baseSegments.length > 0 && (
        <path
          className="radar-baseline"
          d={baseSegments.join(" ")}
          fill="none"
          stroke={c.muted}
          strokeWidth={1.2}
          strokeDasharray="4 3"
        />
      )}
      {complete && (
        <polygon
          points={axes.map((a, i) => fmt(point(i, a.score!))).join(" ")}
          fill={c.accent}
          fillOpacity={0.18}
          stroke="none"
        />
      )}
      <path d={segments.join(" ")} fill="none" stroke={c.accent} strokeWidth={2} />
      {axes.map((a, i) =>
        a.score === null ? null : (
          <circle
            key={a.key}
            cx={point(i, a.score)[0]}
            cy={point(i, a.score)[1]}
            r={3}
            fill={c.accent}
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
            fill={a.score === null ? c.muted : c.text}
          >
            {a.label} <tspan fontWeight={700}>{a.score ?? "-"}</tspan>
          </text>
        );
      })}
    </svg>
  );
}
