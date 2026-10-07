import { outcomeFor, playerSide, type Bucket, type Side } from "./stats";
import type { GameSummary, SideStyle } from "./types";

/**
 * 対局者ページの階層の集計: 本人の戦型 × 相手の戦型 (4 区分) → 戦法 → 戦法の詳細。
 * 既存の集計 (computePlayerStats / computePortfolio) と同じ数え方で、切り口を変えて並べ直すだけ。
 */

/** 本人の戦型 × 相手の戦型。どちらかの戦型が判定できなければ unknown */
export type StyleQuadrant =
  "aiIbisha" | "ibishaVsFuri" | "furiVsIbisha" | "aiFuribisha" | "unknown";

/** 表示順。unknown は対局があるときだけ出す */
export const STYLE_QUADRANTS: readonly StyleQuadrant[] = [
  "aiIbisha",
  "ibishaVsFuri",
  "furiVsIbisha",
  "aiFuribisha",
  "unknown",
];

/** 戦法の一覧をどちらの戦法で見るか */
export type OpeningAxis = "self" | "opponent";

export interface Tally {
  games: number;
  wins: number;
  losses: number;
}

export interface QuadrantStats extends Tally {
  quadrant: StyleQuadrant;
  bySide: Record<Side, Tally>;
  /** 本人の戦法 */
  openings: Bucket[];
  /** 相手の戦法 */
  vsOpenings: Bucket[];
}

export interface OpeningDetail extends Tally {
  quadrant: StyleQuadrant;
  axis: OpeningAxis;
  opening: string;
  /** 本人の囲い */
  castles: Bucket[];
  /** axis が self なら相手の戦法、opponent なら本人の戦法 (応手) */
  counter: Bucket[];
  gameIds: string[];
}

interface Facts {
  side: Side;
  quadrant: StyleQuadrant;
  opening: string;
  vsOpening: string;
  castle: string;
}

export function quadrantOf(self: SideStyle, opponent: SideStyle): StyleQuadrant {
  if (self === "unknown" || opponent === "unknown") return "unknown";
  if (self === "ibisha") return opponent === "ibisha" ? "aiIbisha" : "ibishaVsFuri";
  return opponent === "ibisha" ? "furiVsIbisha" : "aiFuribisha";
}

function factsOf(g: GameSummary, name: string): Facts | null {
  const side = playerSide(g, name);
  if (side === null) return null;
  const o = g.opening;
  const black = side === "black";
  return {
    side,
    quadrant: quadrantOf(black ? o.black : o.white, black ? o.white : o.black),
    opening: (black ? o.blackOpening : o.whiteOpening) || "不明",
    vsOpening: (black ? o.whiteOpening : o.blackOpening) || "不明",
    castle: (black ? o.blackCastle : o.whiteCastle) || "不明",
  };
}

/** その対局の区分 (本人が対局者でなければ null) */
export function styleQuadrantOf(g: GameSummary, name: string): StyleQuadrant | null {
  return factsOf(g, name)?.quadrant ?? null;
}

/** 区分 (と戦法) に当てはまるか。opening を省くと区分だけで絞る */
export function matchesStyle(
  g: GameSummary,
  name: string,
  quadrant: StyleQuadrant,
  axis: OpeningAxis = "self",
  opening?: string,
): boolean {
  const f = factsOf(g, name);
  if (!f || f.quadrant !== quadrant) return false;
  return opening === undefined || (axis === "self" ? f.opening : f.vsOpening) === opening;
}

function emptyTally(): Tally {
  return { games: 0, wins: 0, losses: 0 };
}

function count(t: Tally, g: GameSummary, side: Side): void {
  t.games++;
  const o = outcomeFor(g.result, side);
  if (o === "win") t.wins++;
  if (o === "loss") t.losses++;
}

function bump(map: Map<string, Bucket>, key: string, g: GameSummary, side: Side): void {
  const b = map.get(key) ?? { name: key, ...emptyTally() };
  count(b, g, side);
  map.set(key, b);
}

function sorted(map: Map<string, Bucket>): Bucket[] {
  return Array.from(map.values()).sort((a, b) => b.games - a.games || a.name.localeCompare(b.name));
}

/**
 * 4 区分 (と判定できなかった対局の「不明」) ごとの局数・勝敗・先後の内訳・戦法。
 * 4 区分は対局が無くても常に返し、不明は対局があるときだけ返す。合計は本人の全対局数。
 */
export function computeStyleQuadrants(all: GameSummary[], name: string): QuadrantStats[] {
  const acc = new Map(
    STYLE_QUADRANTS.map((q) => [
      q,
      {
        tally: emptyTally(),
        bySide: { black: emptyTally(), white: emptyTally() },
        openings: new Map<string, Bucket>(),
        vsOpenings: new Map<string, Bucket>(),
      },
    ]),
  );
  for (const g of all) {
    const f = factsOf(g, name);
    if (!f) continue;
    const a = acc.get(f.quadrant)!;
    count(a.tally, g, f.side);
    count(a.bySide[f.side], g, f.side);
    bump(a.openings, f.opening, g, f.side);
    bump(a.vsOpenings, f.vsOpening, g, f.side);
  }
  return STYLE_QUADRANTS.map((quadrant) => {
    const a = acc.get(quadrant)!;
    return {
      quadrant,
      ...a.tally,
      bySide: a.bySide,
      openings: sorted(a.openings),
      vsOpenings: sorted(a.vsOpenings),
    };
  }).filter((q) => q.quadrant !== "unknown" || q.games > 0);
}

/** 区分の中の 1 つの戦法 (本人の戦法、または相手の戦法) の内訳 */
export function computeOpeningDetail(
  all: GameSummary[],
  name: string,
  quadrant: StyleQuadrant,
  axis: OpeningAxis,
  opening: string,
): OpeningDetail {
  const tally = emptyTally();
  const castles = new Map<string, Bucket>();
  const counter = new Map<string, Bucket>();
  const gameIds: string[] = [];
  for (const g of all) {
    const f = factsOf(g, name);
    if (!f || f.quadrant !== quadrant) continue;
    if ((axis === "self" ? f.opening : f.vsOpening) !== opening) continue;
    count(tally, g, f.side);
    bump(castles, f.castle, g, f.side);
    bump(counter, axis === "self" ? f.vsOpening : f.opening, g, f.side);
    gameIds.push(g.id);
  }
  return {
    quadrant,
    axis,
    opening,
    ...tally,
    castles: sorted(castles),
    counter: sorted(counter),
    gameIds: gameIds.sort(),
  };
}
