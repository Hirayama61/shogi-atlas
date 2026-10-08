import type { AnalysisRecord } from "./analysis";
import { createReviewLookup } from "./branches";
import { collectCandidates, type BranchCandidate } from "./branchStudy";
import {
  COMMON_POSITION_MIN_PLY,
  COMMON_POSITION_PLIES,
  outcomeFor,
  playerSide,
  type Side,
} from "./stats";
import type { CounterBucket } from "./styles";
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

/** 違う手を指してもこの手数以内に同じ局面に戻れば、手順前後 (合流) とみなす */
export const MERGE_PLIES = 8;

/** 共通局面の分類。differs は学ぶ価値のある分岐、merged は数手以内に合流する分岐、same は一致 */
export type BranchKind = "differs" | "merged" | "same";

export interface CompareBranch extends ComparePosition {
  /** この局面を通った対局で最も多い本人の戦法 */
  opening: string;
  kind: BranchKind;
}

export interface OpeningBranches {
  opening: string;
  /** 手数の早い順 */
  branches: CompareBranch[];
}

/** 相手の戦法 1 つに対する、2 人の応手 (本人の戦法 × 囲い) */
export interface CounterComparison {
  vsOpening: string;
  self: CounterBucket[];
  other: CounterBucket[];
  /** 最も多い応手が 2 人で違う */
  differs: boolean;
}

/** 局面 `ply` から先 MERGE_PLIES 手の局面キー */
function aheadKeys(g: GameRecord, ply: number): string[] {
  return g.positions.slice(ply + 1, ply + 1 + MERGE_PLIES);
}

/**
 * 手が違う局面が、数手以内に合流するか。片方にしか無い手を指した対局がすべて、
 * もう片方の誰かの対局と MERGE_PLIES 手以内に同じ局面を通れば合流とみなす。
 */
function mergesBack(p: ComparePosition, byId: Map<string, GameRecord>): boolean {
  const at = (ids: string[]) =>
    ids.flatMap((id) => {
      const g = byId.get(id);
      const ply = g ? g.positions.indexOf(p.key) : -1;
      return g && ply >= 0 && g.positions[ply + 1] ? [{ g, ply, next: g.positions[ply + 1]! }] : [];
    });
  const self = at(p.self.gameIds);
  const other = at(p.other.gameIds);
  const covered = (xs: typeof self, ys: typeof self): boolean => {
    const nexts = new Set(ys.map((y) => y.next));
    return xs
      .filter((x) => !nexts.has(x.next))
      .every((x) => {
        const mine = new Set(aheadKeys(x.g, x.ply));
        return ys.some((y) => aheadKeys(y.g, y.ply).some((k) => mine.has(k)));
      });
  };
  return covered(self, other) && covered(other, self);
}

function mostCommonOpening(ids: { id: string; name: string }[], byId: Map<string, GameRecord>) {
  const m = new Map<string, number>();
  for (const { id, name } of ids) {
    const g = byId.get(id);
    const side = g ? playerSide(g, name) : null;
    if (!g || side === null) continue;
    const o = ownOpening(g, side) || "不明";
    m.set(o, (m.get(o) ?? 0) + 1);
  }
  return (
    Array.from(m.entries()).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0] ??
    "不明"
  );
}

/**
 * `comparePlayers` の共通局面を本人の戦法ごとにまとめ、各局面を分岐・合流・一致に分ける。
 * まとまりは分岐の多い順 (同数なら局面の多い順、戦法名順)。
 */
export function groupByOpening(
  c: Comparison,
  games: GameRecord[],
  selfName: string,
  otherName: string,
): OpeningBranches[] {
  const byId = new Map(games.map((g) => [g.id, g] as const));
  const groups = new Map<string, CompareBranch[]>();
  for (const p of c.positions) {
    const opening = mostCommonOpening(
      [
        ...p.self.gameIds.map((id) => ({ id, name: selfName })),
        ...p.other.gameIds.map((id) => ({ id, name: otherName })),
      ],
      byId,
    );
    const kind: BranchKind = !p.differs ? "same" : mergesBack(p, byId) ? "merged" : "differs";
    const list = groups.get(opening) ?? [];
    list.push({ ...p, opening, kind });
    groups.set(opening, list);
  }
  const differs = (bs: CompareBranch[]) => bs.filter((b) => b.kind === "differs").length;
  return Array.from(groups, ([opening, branches]) => ({ opening, branches })).sort(
    (a, b) =>
      differs(b.branches) - differs(a.branches) ||
      b.branches.length - a.branches.length ||
      a.opening.localeCompare(b.opening),
  );
}

/**
 * 相手の戦法ごとに、2 人がどの戦法 × 囲いで応じたか (局数・勝敗)。2 人とも当たったことのある相手の戦法だけ、
 * 2 人の合計局数の多い順。`options.opening` は comparePlayers と同じく本人の戦法で絞る。
 */
export function compareCounters(
  games: GameRecord[],
  selfName: string,
  otherName: string,
  options: CompareOptions = {},
): CounterComparison[] {
  const tally = (name: string) => {
    const rows = new Map<string, Map<string, CounterBucket>>();
    for (const g of games) {
      const side = playerSide(g, name);
      if (side === null) continue;
      const opening = ownOpening(g, side) || "不明";
      if (options.opening !== undefined && opening !== options.opening) continue;
      const black = side === "black";
      const vs = (black ? g.opening.whiteOpening : g.opening.blackOpening) || "不明";
      const castle = (black ? g.opening.blackCastle : g.opening.whiteCastle) || "不明";
      const row = rows.get(vs) ?? new Map<string, CounterBucket>();
      const label = `${opening} · ${castle}`;
      const b = row.get(label) ?? { name: label, opening, castle, games: 0, wins: 0, losses: 0 };
      b.games++;
      const o = outcomeFor(g.result, side);
      if (o === "win") b.wins++;
      if (o === "loss") b.losses++;
      row.set(label, b);
      rows.set(vs, row);
    }
    return rows;
  };
  const sorted = (m: Map<string, CounterBucket>) =>
    Array.from(m.values()).sort((a, b) => b.games - a.games || a.name.localeCompare(b.name));
  const total = (bs: CounterBucket[]) => bs.reduce((n, b) => n + b.games, 0);
  const a = tally(selfName);
  const b = tally(otherName);
  const out: CounterComparison[] = [];
  for (const [vsOpening, row] of a) {
    const theirs = b.get(vsOpening);
    if (!theirs) continue;
    const self = sorted(row);
    const other = sorted(theirs);
    out.push({ vsOpening, self, other, differs: self[0]!.name !== other[0]!.name });
  }
  return out.sort(
    (x, y) =>
      total(y.self) + total(y.other) - (total(x.self) + total(x.other)) ||
      x.vsOpening.localeCompare(y.vsOpening),
  );
}
