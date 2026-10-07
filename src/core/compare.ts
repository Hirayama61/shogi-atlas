import type { AnalysisRecord } from "./analysis";
import { createReviewLookup } from "./branches";
import { collectCandidates, type BranchCandidate } from "./branchStudy";
import { COMMON_POSITION_MIN_PLY, COMMON_POSITION_PLIES, playerSide, type Side } from "./stats";
import type { GameRecord } from "./types";

/**
 * 2 人の対局者 (自分と参考にしている人) が同じ局面で何を指したかを並べる。
 * 局面キーは盤面・手番・持ち駒だけなので、先後が逆の対局でも同じキーになりうる。
 * 比べるのは同じ先後で、その人の手番の局面だけにする (相手の手を比べても意味が無いため)。
 * 読み出し時に計算し、GameRecord には何も足さない。
 */

export interface CompareSide {
  /** この局面を通った対局 (その人がこの局面の手番の側だったもの) */
  gameIds: string[];
  /** 指した手 (回数の多い順、同数なら USI 順) と判定 */
  moves: BranchCandidate[];
}

export interface ComparePosition {
  key: string;
  /** この局面になった最も早い手数 */
  ply: number;
  /** 2 人の側 (= この局面の手番) */
  side: Side;
  self: CompareSide;
  other: CompareSide;
  /** 2 人の指した手の集合が違う */
  differs: boolean;
}

export interface Comparison {
  /** 共通局面 (手数の早い順) */
  positions: ComparePosition[];
  /** 比べた対局の数 (先後別)。共通局面が無いときの理由に使う */
  games: Record<Side, { self: number; other: number }>;
}

export interface CompareOptions {
  /** 2 人とも本人の戦法がこれだった対局だけ比べる */
  opening?: string;
}

function ownOpening(g: GameRecord, side: Side): string {
  return side === "black" ? g.opening.blackOpening : g.opening.whiteOpening;
}

function turnOf(key: string): Side {
  return key.split(/\s+/)[1] === "w" ? "white" : "black";
}

/** 2 人がそれぞれ本人の戦法として指したことのある戦法 (両方にあるもの、合計局数の多い順) */
export function compareOpenings(
  games: GameRecord[],
  selfName: string,
  otherName: string,
): string[] {
  const count = (name: string) => {
    const m = new Map<string, number>();
    for (const g of games) {
      const side = playerSide(g, name);
      if (side === null) continue;
      const o = ownOpening(g, side);
      m.set(o, (m.get(o) ?? 0) + 1);
    }
    return m;
  };
  const a = count(selfName);
  const b = count(otherName);
  return Array.from(a.keys())
    .filter((o) => b.has(o))
    .sort((x, y) => a.get(y)! + b.get(y)! - (a.get(x)! + b.get(x)!) || x.localeCompare(y));
}

/**
 * 自分 (`selfName`) と参考の人 (`otherName`) の共通局面ごとに、2 人の手の分布と判定を返す。
 * 局面は `COMMON_POSITION_MIN_PLY` 〜 `COMMON_POSITION_PLIES` 手目で、その人の手番のものだけ。
 * 通った対局の組み合わせが同じ局面は最も深いものだけ残す (= 2 人の手順が分かれる直前の局面)。
 * 片方しか通っていない局面と、どちらかの手が無い (そこで終局した) 局面は出さない。
 */
export function comparePlayers(
  games: GameRecord[],
  analyses: Map<string, AnalysisRecord>,
  selfName: string,
  otherName: string,
  options: CompareOptions = {},
): Comparison {
  const counts: Comparison["games"] = {
    black: { self: 0, other: 0 },
    white: { self: 0, other: 0 },
  };
  const byId = new Map<string, GameRecord>();
  const entries = new Map<
    string,
    { key: string; ply: number; side: Side; self: Set<string>; other: Set<string> }
  >();
  for (const [who, name] of [
    ["self", selfName],
    ["other", otherName],
  ] as const) {
    for (const g of games) {
      const side = playerSide(g, name);
      if (side === null) continue;
      if (options.opening !== undefined && ownOpening(g, side) !== options.opening) continue;
      counts[side][who]++;
      byId.set(g.id, g);
      // 次の手がある局面だけ (終局した局面では比べる手が無い)
      const end = Math.min(g.positions.length - 2, COMMON_POSITION_PLIES);
      for (let ply = COMMON_POSITION_MIN_PLY; ply <= end; ply++) {
        const key = g.positions[ply];
        if (!key || turnOf(key) !== side) continue;
        const id = `${side}|${key}`;
        const e = entries.get(id) ?? { key, ply, side, self: new Set(), other: new Set() };
        e.ply = Math.min(e.ply, ply);
        e[who].add(g.id);
        entries.set(id, e);
      }
    }
  }

  // 同じ対局の組み合わせを持つ局面は最も深いものだけ残す
  const deepest = new Map<
    string,
    { key: string; ply: number; side: Side; self: string[]; other: string[] }
  >();
  for (const e of entries.values()) {
    if (e.self.size === 0 || e.other.size === 0) continue;
    const self = Array.from(e.self).sort();
    const other = Array.from(e.other).sort();
    const setKey = `${e.side}|${self.join(",")}|${other.join(",")}`;
    const cur = deepest.get(setKey);
    if (!cur || e.ply > cur.ply)
      deepest.set(setKey, { key: e.key, ply: e.ply, side: e.side, self, other });
  }

  const reviewOf = createReviewLookup(analyses);
  const sideOf = (ids: string[], key: string): CompareSide => ({
    gameIds: ids,
    moves: collectCandidates(
      key,
      ids.map((id) => byId.get(id)!),
      reviewOf,
    ),
  });
  const positions: ComparePosition[] = [];
  for (const d of deepest.values()) {
    const self = sideOf(d.self, d.key);
    const other = sideOf(d.other, d.key);
    if (self.moves.length === 0 || other.moves.length === 0) continue;
    const a = new Set(self.moves.map((m) => m.usi));
    const b = new Set(other.moves.map((m) => m.usi));
    const differs = a.size !== b.size || Array.from(a).some((u) => !b.has(u));
    positions.push({ key: d.key, ply: d.ply, side: d.side, self, other, differs });
  }
  positions.sort(
    (x, y) => x.ply - y.ply || x.side.localeCompare(y.side) || x.key.localeCompare(y.key),
  );
  return { positions, games: counts };
}
