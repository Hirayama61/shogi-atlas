import { formatUsiMove, usiMoves } from "./branches";
import { COMMON_POSITION_PLIES, outcomeFor, playerSide } from "./stats";
import type { GameRecord } from "./types";

/**
 * 本人が繰り返している手順 (幹と分岐)。条件で絞った本人の対局集合を、開始局面からの手順の木にする。
 * 2 局以上が通った手だけを残すので、1 局しかない先は出ない。読み出し時に計算し、GameRecord には何も足さない。
 */

export interface LineNode {
  /** この手を指した後の手数 (= 局面の手数)。開始局面は 0 */
  ply: number;
  /** この手を指した後の局面キー */
  key: string;
  /** 指した手 (USI)。開始局面は "" */
  usi: string;
  /** 表示用 (例: ▲7六歩)。開始局面は "" */
  label: string;
  /** ここまで同じ手順だった対局 (この対局者の対局のみ) */
  gameIds: string[];
  /** そのうち対局者の勝ち数 */
  wins: number;
  /** 次の手。2 局以上が通ったものだけ、局数の多い順 (同数なら USI 順) */
  children: LineNode[];
}

interface Building {
  key: string;
  usi: string;
  gameIds: string[];
  wins: number;
  children: Map<string, Building>;
}

function finish(b: Building, ply: number, parentKey: string): LineNode {
  const children = Array.from(b.children.values())
    .filter((c) => c.gameIds.length >= 2)
    .sort((x, y) => y.gameIds.length - x.gameIds.length || x.usi.localeCompare(y.usi))
    .map((c) => finish(c, ply + 1, b.key));
  return {
    ply,
    key: b.key,
    usi: b.usi,
    label: b.usi ? formatUsiMove(parentKey, b.usi) : "",
    gameIds: b.gameIds,
    wins: b.wins,
    children,
  };
}

/**
 * `games` のうち `name` が指した対局から、繰り返している手順の木を作る。
 * 開始局面ごとに 1 本で、2 局以上が同じ開始局面から始まるものだけを局数の多い順に返す。手数は分岐点と同じ 50 手まで。
 */
export function findRepeatedLines(games: GameRecord[], name: string): LineNode[] {
  const roots = new Map<string, Building>();
  for (const g of games) {
    const side = playerSide(g, name);
    if (side === null) continue;
    const start = g.positions[0];
    if (!start) continue;
    const win = outcomeFor(g.result, side) === "win" ? 1 : 0;
    const moves = usiMoves(g.usi);
    const root = roots.get(start) ?? {
      key: start,
      usi: "",
      gameIds: [],
      wins: 0,
      children: new Map(),
    };
    roots.set(start, root);
    let node: Building = root;
    node.gameIds.push(g.id);
    node.wins += win;
    const end = Math.min(g.positions.length - 1, moves.length, COMMON_POSITION_PLIES);
    for (let ply = 1; ply <= end; ply++) {
      const key = g.positions[ply];
      const usi = moves[ply - 1];
      if (!key || !usi) break;
      const next: Building = node.children.get(key) ?? {
        key,
        usi,
        gameIds: [],
        wins: 0,
        children: new Map(),
      };
      node.children.set(key, next);
      next.gameIds.push(g.id);
      next.wins += win;
      node = next;
    }
  }
  return Array.from(roots.values())
    .filter((r) => r.gameIds.length >= 2)
    .sort((a, b) => b.gameIds.length - a.gameIds.length)
    .map((r) => finish(r, 0, r.key));
}

/** 幹: 各手で局数の最も多い手をたどった手順 (開始局面は含まない) */
export function trunkOf(root: LineNode): LineNode[] {
  const out: LineNode[] = [];
  let node = root.children[0];
  while (node) {
    out.push(node);
    node = node.children[0];
  }
  return out;
}

/** `node` から分岐が無い限り 1 本道でたどった手順 (`node` を含む)。最後の手の children が分岐 (または空) */
export function straightFrom(node: LineNode): LineNode[] {
  const out = [node];
  let cur = node;
  while (cur.children.length === 1) {
    cur = cur.children[0]!;
    out.push(cur);
  }
  return out;
}
