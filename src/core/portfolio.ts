import {
  findCommonPositions,
  outcomeFor,
  playerSide,
  type CommonPosition,
  type Side,
} from "./stats";
import type { GameRecord, GameSummary, SideStyle } from "./types";

/**
 * 戦型ポートフォリオ: 本人の先後 × 相手の戦型 (大分類 → 戦法名) ごとに、本人がどう応じたか (戦法 × 囲い)。
 * 入力は computePlayerStats と同じ GameRecord[]。戦法・囲いが「不明」の対局も「不明」として数える。
 */

/** 集計の条件。vsOpening を省くと相手の大分類だけで絞る */
export interface PortfolioCondition {
  side: Side;
  vsStyle: SideStyle;
  vsOpening?: string;
}

/** ポートフォリオの 1 行 (本人の応手) まで指定した条件 */
export interface PortfolioRowCondition extends PortfolioCondition {
  opening: string;
  castle: string;
}

export interface Tally {
  games: number;
  wins: number;
  losses: number;
}

/** 本人の応手 (戦法 × 囲い) */
export interface PortfolioResponse extends Tally {
  opening: string;
  castle: string;
  gameIds: string[];
}

/** 相手の戦法名ごとの内訳 */
export interface PortfolioOpponent extends Tally {
  vsOpening: string;
  responses: PortfolioResponse[];
}

/** 本人の先後 × 相手の大分類 */
export interface PortfolioGroup extends Tally {
  side: Side;
  vsStyle: SideStyle;
  opponents: PortfolioOpponent[];
}

interface Facts {
  side: Side;
  vsStyle: SideStyle;
  vsOpening: string;
  opening: string;
  castle: string;
}

function factsOf(g: GameSummary, name: string): Facts | null {
  const side = playerSide(g, name);
  if (side === null) return null;
  const o = g.opening;
  const black = side === "black";
  return {
    side,
    vsStyle: (black ? o.white : o.black) ?? "unknown",
    vsOpening: (black ? o.whiteOpening : o.blackOpening) || "不明",
    opening: (black ? o.blackOpening : o.whiteOpening) || "不明",
    castle: (black ? o.blackCastle : o.whiteCastle) || "不明",
  };
}

/** その対局が条件に当てはまるか (本人が対局者でなければ false) */
export function matchesPortfolio(
  g: GameSummary,
  name: string,
  cond: PortfolioCondition & Partial<Pick<PortfolioRowCondition, "opening" | "castle">>,
): boolean {
  const f = factsOf(g, name);
  if (!f) return false;
  return (
    f.side === cond.side &&
    f.vsStyle === cond.vsStyle &&
    (cond.vsOpening === undefined || f.vsOpening === cond.vsOpening) &&
    (cond.opening === undefined || f.opening === cond.opening) &&
    (cond.castle === undefined || f.castle === cond.castle)
  );
}

function tally(t: Tally, g: GameSummary, side: Side): void {
  t.games++;
  const o = outcomeFor(g.result, side);
  if (o === "win") t.wins++;
  if (o === "loss") t.losses++;
}

const SIDE_ORDER: Side[] = ["black", "white"];
const STYLE_ORDER: SideStyle[] = ["ibisha", "furibisha", "unknown"];

function byGames<T extends Tally>(key: (t: T) => string): (a: T, b: T) => number {
  return (a, b) => b.games - a.games || key(a).localeCompare(key(b));
}

export function computePortfolio(all: GameSummary[], name: string): PortfolioGroup[] {
  const groups = new Map<string, PortfolioGroup>();
  for (const g of all) {
    const f = factsOf(g, name);
    if (!f) continue;
    const gk = `${f.side}/${f.vsStyle}`;
    const group = groups.get(gk) ?? {
      side: f.side,
      vsStyle: f.vsStyle,
      games: 0,
      wins: 0,
      losses: 0,
      opponents: [],
    };
    groups.set(gk, group);
    tally(group, g, f.side);

    let opp = group.opponents.find((o) => o.vsOpening === f.vsOpening);
    if (!opp) {
      opp = { vsOpening: f.vsOpening, games: 0, wins: 0, losses: 0, responses: [] };
      group.opponents.push(opp);
    }
    tally(opp, g, f.side);

    let res = opp.responses.find((r) => r.opening === f.opening && r.castle === f.castle);
    if (!res) {
      res = { opening: f.opening, castle: f.castle, games: 0, wins: 0, losses: 0, gameIds: [] };
      opp.responses.push(res);
    }
    tally(res, g, f.side);
    res.gameIds.push(g.id);
  }

  const result = Array.from(groups.values());
  for (const group of result) {
    group.opponents.sort(byGames((o) => o.vsOpening));
    for (const opp of group.opponents) {
      opp.responses.sort(byGames((r) => `${r.opening} ${r.castle}`));
      for (const r of opp.responses) r.gameIds.sort();
    }
  }
  return result.sort(
    (a, b) =>
      SIDE_ORDER.indexOf(a.side) - SIDE_ORDER.indexOf(b.side) ||
      STYLE_ORDER.indexOf(a.vsStyle) - STYLE_ORDER.indexOf(b.vsStyle),
  );
}

/** 条件に当てはまる対局だけで出した分岐点。分岐点の定義は findCommonPositions と同じ */
export function portfolioCommonPositions(
  all: GameRecord[],
  name: string,
  cond: PortfolioCondition & Partial<Pick<PortfolioRowCondition, "opening" | "castle">>,
): CommonPosition[] {
  return findCommonPositions(
    all.filter((g) => matchesPortfolio(g, name, cond)),
    name,
  );
}
