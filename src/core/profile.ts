import {
  JUDGEMENT_LABEL,
  type AnalysisRecord,
  type Judgement,
  type MoveReview,
  type Phase,
  reviewGame,
} from "./analysis";
import { outcomeFor, playerSide, type Side } from "./stats";
import type { GameRecord } from "./types";

/**
 * エンジン解析をもとにした対局者の弱点プロファイル。
 * 「どの段階で崩れるか」「有利を活かせるか」「劣勢で粘れるか」を数字にする。
 */
export interface PhaseProfile {
  moves: number;
  averageLoss: number;
  /** 大悪手の割合 (0..1) */
  blunderRate: number;
}

export interface OpeningAccuracy {
  name: string;
  games: number;
  wins: number;
  averageLoss: number;
}

export interface WorstMove {
  gameId: string;
  opponent: string;
  startedAt?: string;
  ply: number;
  side: Side;
  phase: Phase;
  /** 指す前の局面キー (盤面表示用) */
  sfen: string;
  played: string;
  best?: string;
  cpBefore: number;
  cpAfter: number;
  swing: number;
  judgement: Judgement;
}

export interface PlayerProfile {
  name: string;
  /** 解析済みの対局数 */
  games: number;
  averageLoss: number;
  byPhase: Record<Phase, PhaseProfile>;
  /** 本人の戦法ごとの精度 */
  byOpening: OpeningAccuracy[];
  /** 相手の戦法ごとの精度 */
  byOpponentOpening: OpeningAccuracy[];
  /** 評価値 +300 以上になった対局のうち勝った割合 */
  conversionRate: number | null;
  /** 評価値 -300 以下になった対局のうち負けなかった割合 (粘り) */
  resilienceRate: number | null;
  /** 相手の大悪手に乗じて勝った割合 (相手が大悪手を指した対局のうち勝った割合) */
  punishRate: number | null;
  /** 自分が先に大悪手を指した対局の割合 */
  firstBlunderRate: number | null;
  /** 勝率で見て最も痛かった手 (降順) */
  worstMoves: WorstMove[];
}

const ADVANTAGE = 300;

function emptyPhase(): PhaseProfile {
  return { moves: 0, averageLoss: 0, blunderRate: 0 };
}

export function buildPlayerProfile(
  games: GameRecord[],
  analyses: Map<string, AnalysisRecord>,
  name: string,
  options: { worstMoves?: number } = {},
): PlayerProfile {
  const profile: PlayerProfile = {
    name,
    games: 0,
    averageLoss: 0,
    byPhase: { opening: emptyPhase(), middlegame: emptyPhase(), endgame: emptyPhase() },
    byOpening: [],
    byOpponentOpening: [],
    conversionRate: null,
    resilienceRate: null,
    punishRate: null,
    firstBlunderRate: null,
    worstMoves: [],
  };
  const phaseLoss: Record<Phase, number> = { opening: 0, middlegame: 0, endgame: 0 };
  const phaseBlunders: Record<Phase, number> = { opening: 0, middlegame: 0, endgame: 0 };
  const openings = new Map<string, OpeningAccuracy & { loss: number; moves: number }>();
  const vsOpenings = new Map<string, OpeningAccuracy & { loss: number; moves: number }>();
  let totalLoss = 0;
  let totalMoves = 0;
  let ahead = 0;
  let aheadWon = 0;
  let behind = 0;
  let behindNotLost = 0;
  let oppBlundered = 0;
  let oppBlunderedWon = 0;
  let anyBlunder = 0;
  let firstBlunder = 0;
  const worst: WorstMove[] = [];

  for (const game of games) {
    const side = playerSide(game, name);
    const analysis = analyses.get(game.id);
    if (!side || !analysis) continue;
    profile.games++;
    const review = reviewGame(game, analysis);
    const mine = review.moves.filter((m) => m.side === side);
    const theirs = review.moves.filter((m) => m.side !== side);
    const outcome = outcomeFor(game.result, side);

    for (const m of mine) {
      totalLoss += m.loss;
      totalMoves++;
      profile.byPhase[m.phase].moves++;
      phaseLoss[m.phase] += m.loss;
      if (m.judgement === "blunder") phaseBlunders[m.phase]++;
    }

    const own = side === "black" ? game.opening.blackOpening : game.opening.whiteOpening;
    const opp = side === "black" ? game.opening.whiteOpening : game.opening.blackOpening;
    const myLoss = mine.reduce((a, m) => a + m.loss, 0);
    for (const [map, key] of [
      [openings, own],
      [vsOpenings, opp],
    ] as const) {
      const e = map.get(key) ?? { name: key, games: 0, wins: 0, averageLoss: 0, loss: 0, moves: 0 };
      e.games++;
      if (outcome === "win") e.wins++;
      e.loss += myLoss;
      e.moves += mine.length;
      map.set(key, e);
    }

    // 形勢の推移 (本人視点)
    const sign = side === "black" ? 1 : -1;
    const cps = review.curve.map((c) => c.cp * sign);
    if (cps.some((cp) => cp >= ADVANTAGE)) {
      ahead++;
      if (outcome === "win") aheadWon++;
    }
    if (cps.some((cp) => cp <= -ADVANTAGE)) {
      behind++;
      if (outcome !== "loss") behindNotLost++;
    }
    if (theirs.some((m) => m.judgement === "blunder")) {
      oppBlundered++;
      if (outcome === "win") oppBlunderedWon++;
    }
    const firstBlunderMove = review.moves.find((m) => m.judgement === "blunder");
    if (firstBlunderMove) {
      anyBlunder++;
      if (firstBlunderMove.side === side) firstBlunder++;
    }

    for (const m of mine) {
      if (m.judgement === "good") continue;
      worst.push(toWorst(game, m, side));
    }
  }

  profile.averageLoss = totalMoves ? Math.round(totalLoss / totalMoves) : 0;
  for (const phase of ["opening", "middlegame", "endgame"] as const) {
    const p = profile.byPhase[phase];
    p.averageLoss = p.moves ? Math.round(phaseLoss[phase] / p.moves) : 0;
    p.blunderRate = p.moves ? phaseBlunders[phase] / p.moves : 0;
  }
  const finish = (map: Map<string, OpeningAccuracy & { loss: number; moves: number }>) =>
    Array.from(map.values())
      .map(({ loss, moves, ...rest }) => ({
        ...rest,
        averageLoss: moves ? Math.round(loss / moves) : 0,
      }))
      .sort((a, b) => b.games - a.games || a.name.localeCompare(b.name));
  profile.byOpening = finish(openings);
  profile.byOpponentOpening = finish(vsOpenings);
  profile.conversionRate = ahead ? aheadWon / ahead : null;
  profile.resilienceRate = behind ? behindNotLost / behind : null;
  profile.punishRate = oppBlundered ? oppBlunderedWon / oppBlundered : null;
  profile.firstBlunderRate = anyBlunder ? firstBlunder / anyBlunder : null;
  profile.worstMoves = worst.sort((a, b) => b.swing - a.swing).slice(0, options.worstMoves ?? 10);
  return profile;
}

function toWorst(game: GameRecord, m: MoveReview, side: Side): WorstMove {
  const w: WorstMove = {
    gameId: game.id,
    opponent: side === "black" ? game.white : game.black,
    ply: m.ply,
    side,
    phase: m.phase,
    sfen: game.positions[m.ply - 1] ?? "",
    played: m.played,
    cpBefore: m.cpBefore,
    cpAfter: m.cpAfter,
    swing: m.swing,
    judgement: m.judgement,
  };
  if (game.startedAt) w.startedAt = game.startedAt;
  if (m.best) w.best = m.best;
  return w;
}

/** プロファイルを人が読める Markdown にする (Claude のレポート作成の入力にも使う) */
export function profileToMarkdown(p: PlayerProfile): string {
  const pct = (v: number | null) => (v === null ? "-" : `${Math.round(v * 100)}%`);
  const lines = [
    `# ${p.name} の弱点プロファイル`,
    "",
    `- 解析済み: ${p.games} 局`,
    `- 1手あたり平均損失: ${p.averageLoss} cp`,
    `- 有利 (+${ADVANTAGE}) になった対局の勝率: ${pct(p.conversionRate)}`,
    `- 不利 (-${ADVANTAGE}) になった対局で負けなかった率: ${pct(p.resilienceRate)}`,
    `- 相手が大悪手を指した対局の勝率: ${pct(p.punishRate)}`,
    `- 先に大悪手を指す率: ${pct(p.firstBlunderRate)}`,
    "",
    "## 段階別",
    "",
    "| 段階 | 手数 | 平均損失 | 大悪手率 |",
    "|---|---|---|---|",
    ...(["opening", "middlegame", "endgame"] as const).map((ph) => {
      const q = p.byPhase[ph];
      return `| ${{ opening: "序盤", middlegame: "中盤", endgame: "終盤" }[ph]} | ${q.moves} | ${q.averageLoss} | ${pct(q.blunderRate)} |`;
    }),
    "",
    "## 本人の戦法別",
    "",
    "| 戦法 | 局 | 勝 | 平均損失 |",
    "|---|---|---|---|",
    ...p.byOpening.map((o) => `| ${o.name} | ${o.games} | ${o.wins} | ${o.averageLoss} |`),
    "",
    "## 相手の戦法別",
    "",
    "| 相手の戦法 | 局 | 勝 | 平均損失 |",
    "|---|---|---|---|",
    ...p.byOpponentOpening.map((o) => `| ${o.name} | ${o.games} | ${o.wins} | ${o.averageLoss} |`),
    "",
    "## 痛かった手",
    "",
    ...p.worstMoves.map(
      (w) =>
        `- ${w.startedAt?.slice(0, 10) ?? ""} vs ${w.opponent} ${w.ply}手目 ${w.played}${w.best ? ` (最善 ${w.best})` : ""}: ${w.cpBefore} → ${w.cpAfter} (${JUDGEMENT_LABEL[w.judgement]}, 勝率 -${Math.round(w.swing * 100)}%) sfen ${w.sfen}`,
    ),
    "",
  ];
  return lines.join("\n");
}
