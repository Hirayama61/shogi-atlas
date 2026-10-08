import type { ReactNode } from "react";
import type { PlayerProfile } from "../core/profile";
import { averageAxes, hasBaselineLine, radarAxes } from "../core/radar";
import type { Bucket, PlayerStats } from "../core/stats";
import { shownRank } from "./labels";
import { RadarChart, type RadarPalette } from "./RadarChart";
import { digestLines, textWidth, wrapText } from "./shareText";

/**
 * 対局者ページの「対策 1 枚」。今の対局者ページに出ている内容 (カード・レーダー・戦法と囲いの上位・レポートの要点) を
 * 縦長の SVG 1 枚に並べ、PNG にして共有シートかダウンロードに渡す。
 * 画像にすると CSS もウェブフォントも効かないので、色と文字の大きさはここで決め打ちにする。
 */

const W = 540;
const PAD = 28;
const FONT =
  '"Hiragino Sans", "Hiragino Kaku Gothic ProN", "Noto Sans JP", "Yu Gothic", system-ui, sans-serif';
const COLORS = {
  bg: "#ffffff",
  text: "#1c1917",
  muted: "#78716c",
  border: "#d6d3d1",
  accent: "#b45309",
  soft: "#fef3c7",
};
const RADAR: RadarPalette = {
  border: COLORS.border,
  muted: COLORS.muted,
  text: COLORS.text,
  accent: COLORS.accent,
};
/** 戦法・囲いは上位いくつまで載せるか */
const TOP = 3;
/** 要点は折り返したあと何行まで載せるか */
const DIGEST_LINES = 14;

export interface ShareCardProps {
  stats: PlayerStats;
  profile: PlayerProfile | null;
  others: PlayerProfile[];
  /** 対策レポートの Markdown。無ければ要点の欄を出さない */
  report?: string | null;
  /** 画像に入れる日付 (YYYY-MM-DD) */
  date: string;
}

function pct(wins: number, games: number): string {
  return games ? `${Math.round((wins / games) * 100)}%` : "-";
}

function bucketLine(b: Bucket): string {
  return `${b.name}  ${b.games} 局 · 勝率 ${pct(b.wins, b.wins + b.losses)}`;
}

/** 1 枚の SVG。高さは載せる中身で決まる */
export function ShareCard({ stats, profile, others, report, date }: ShareCardProps) {
  const els: ReactNode[] = [];
  let y = PAD;
  const text = (
    s: string,
    size: number,
    opts: { bold?: boolean; color?: string; x?: number; gap?: number } = {},
  ) => {
    // 名前や戦法名が長くても右端からはみ出さないように折り返す
    const x = opts.x ?? PAD;
    for (const line of wrapText(s, W - PAD - x, size)) {
      y += size;
      els.push(
        <text
          key={els.length}
          x={x}
          y={y}
          fontSize={size}
          fontWeight={opts.bold ? 700 : 400}
          fill={opts.color ?? COLORS.text}
        >
          {line}
        </text>,
      );
      y += opts.gap ?? size * 0.5;
    }
  };
  const section = (title: string) => {
    y += 10;
    els.push(
      <line
        key={els.length}
        x1={PAD}
        x2={W - PAD}
        y1={y}
        y2={y}
        stroke={COLORS.border}
        strokeWidth={1}
      />,
    );
    y += 12;
    text(title, 17, { bold: true, color: COLORS.accent, gap: 10 });
  };

  text(`対策メモ · ${date} 時点`, 13, { color: COLORS.muted, gap: 8 });
  const rank = shownRank(stats.name, stats.rank);
  text(rank ? `${stats.name}  ${rank}` : stats.name, 28, { bold: true, gap: 16 });

  const decided = stats.wins + stats.losses;
  const side = (s: "black" | "white") => {
    const b = stats.bySide[s];
    return `${s === "black" ? "先手" : "後手"} ${pct(b.wins, b.wins + b.losses)} (${b.games} 局 ${b.wins} 勝 ${b.losses} 敗)`;
  };
  text(
    `${stats.games} 局 · 解析済み ${profile?.games ?? 0} 局${profile ? ` · 平均損失 ${profile.averageLoss}` : ""}`,
    16,
  );
  text(
    `勝率 ${pct(stats.wins, decided)} (${stats.wins} 勝 ${stats.losses} 敗${stats.draws ? ` ${stats.draws} 分` : ""})`,
    16,
  );
  text(`${side("black")} / ${side("white")}`, 15, { gap: 4 });

  const axes = profile ? radarAxes(profile) : null;
  if (axes) {
    const baseline = others.length ? averageAxes(others.map(radarAxes)) : undefined;
    const rw = W - PAD * 2;
    const rh = (rw * 250) / 300;
    els.push(
      <svg key={els.length} x={PAD} y={y} width={rw} height={rh} viewBox="0 0 300 250">
        <RadarChart axes={axes} baseline={baseline} palette={RADAR} />
      </svg>,
    );
    y += rh;
    if (hasBaselineLine(axes, baseline))
      text("点線は登録している他の対局者の平均", 12, { color: COLORS.muted });
  } else {
    y += 8;
    text("解析待ち: エンジン解析の済んだ対局がまだありません", 14, { color: COLORS.muted });
  }

  const buckets = (title: string, rows: Bucket[]) => {
    if (rows.length === 0) return;
    section(title);
    for (const r of rows.slice(0, TOP)) text(bucketLine(r), 16);
  };
  buckets(`採用戦法 (上位 ${TOP})`, stats.openings);
  buckets(`囲い (上位 ${TOP})`, stats.castles);

  const digest = report ? digestLines(report) : [];
  if (digest.length > 0) {
    section("対策の要点");
    const size = 15;
    let count = 0;
    outer: for (const l of digest) {
      const x = PAD + l.indent * 16;
      for (const w of wrapText(l.text, W - PAD - x, size)) {
        if (count === DIGEST_LINES) {
          text("…", size, { color: COLORS.muted });
          break outer;
        }
        text(w, size, { bold: l.bold, x, gap: 7 });
        count++;
      }
    }
  }

  y += 14;
  text("shogi-atlas", 12, { color: COLORS.muted, x: W - PAD - textWidth("shogi-atlas", 12) });
  const h = Math.ceil(y + PAD - 8);

  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={W}
      height={h}
      viewBox={`0 0 ${W} ${h}`}
      fontFamily={FONT}
      className="share-card"
    >
      <rect width={W} height={h} fill={COLORS.bg} />
      <rect width={W} height={6} fill={COLORS.accent} />
      {els}
    </svg>
  );
}
