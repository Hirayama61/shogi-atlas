import { PHASE_LABEL } from "./analysis";
import type { PlayerProfile } from "./profile";

/**
 * 対局者ページのレーダーチャートの軸。弱点プロファイルの値を 0〜100 (大きいほど良い) にそろえる。
 * 値が出せない軸 (手数や該当局面が無い) は null で、チャートでは欠けとして描く。
 */
export type RadarAxisKey =
  "opening" | "middlegame" | "endgame" | "conversion" | "resilience" | "punish" | "firstBlunder";

export interface RadarAxis {
  key: RadarAxisKey;
  /** チャートに出す短い名前 */
  label: string;
  /** 0〜100。大きいほど良い。出せなければ null */
  score: number | null;
  /** 元の値の短い表記 (例: "平均損失 40", "7/10 局") */
  raw: string;
}

/** 平均損失がこれ以上なら精度の軸は 0 */
export const RADAR_LOSS_FLOOR = 300;

const clamp = (v: number) => Math.max(0, Math.min(100, Math.round(v)));

/** 平均損失を 0〜100 にする。損失 0 で 100、RADAR_LOSS_FLOOR 以上で 0 の直線 */
export function accuracyScore(averageLoss: number): number {
  return clamp(100 * (1 - averageLoss / RADAR_LOSS_FLOOR));
}

export function radarAxes(p: PlayerProfile): RadarAxis[] {
  const phases = (["opening", "middlegame", "endgame"] as const).map((ph): RadarAxis => {
    const q = p.byPhase[ph];
    return {
      key: ph,
      label: PHASE_LABEL[ph],
      score: q.moves ? accuracyScore(q.averageLoss) : null,
      raw: q.moves
        ? `平均損失 ${q.averageLoss} · 大悪手 ${Math.round(q.blunderRate * 100)}%`
        : "手数なし",
    };
  });
  const rate = (
    key: RadarAxisKey,
    label: string,
    list: PlayerProfile["rates"][keyof PlayerProfile["rates"]],
    invert = false,
  ): RadarAxis => {
    const hits = list.filter((e) => e.hit).length;
    const good = invert ? list.length - hits : hits;
    return {
      key,
      label,
      score: list.length ? clamp((good / list.length) * 100) : null,
      raw: list.length ? `${good}/${list.length} 局` : "該当なし",
    };
  };
  return [
    ...phases,
    rate("conversion", "有利を活かす", p.rates.conversion),
    rate("resilience", "粘り", p.rates.resilience),
    rate("punish", "咎める", p.rates.punish),
    rate("firstBlunder", "先に崩れない", p.rates.firstBlunder, true),
  ];
}

/** 複数人の軸の平均 (null は除く)。誰も値を持たない軸は null */
export function averageAxes(list: RadarAxis[][]): Record<RadarAxisKey, number | null> {
  const sum = new Map<RadarAxisKey, { total: number; n: number }>();
  for (const axes of list) {
    for (const a of axes) {
      if (a.score === null) continue;
      const s = sum.get(a.key) ?? { total: 0, n: 0 };
      s.total += a.score;
      s.n++;
      sum.set(a.key, s);
    }
  }
  const keys: RadarAxisKey[] = [
    "opening",
    "middlegame",
    "endgame",
    "conversion",
    "resilience",
    "punish",
    "firstBlunder",
  ];
  return Object.fromEntries(
    keys.map((k) => {
      const s = sum.get(k);
      return [k, s ? Math.round(s.total / s.n) : null];
    }),
  ) as Record<RadarAxisKey, number | null>;
}
