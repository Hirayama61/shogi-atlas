import { formatRating } from "./quest";
import type { GameRecord, GameResult, GameSummary } from "./types";

/** 分岐点の抽出に使う手数の範囲。序盤数手は誰でも同じなので除く。 */
const COMMON_POSITION_MIN_PLY = 6;
export const COMMON_POSITION_PLIES = 50;

export type Side = "black" | "white";

/** その対局者がどちら側か。どちらでもなければ null。 */
export function playerSide(g: GameSummary, name: string): Side | null {
  if (g.black === name) return "black";
  if (g.white === name) return "white";
  return null;
}

export type Outcome = "win" | "loss" | "draw" | "unknown";

/** 段級位 (将棋ウォーズ) が無ければレート (将棋クエスト) を表示用に使う */
function rankOf(g: GameSummary, side: Side): string | undefined {
  return side === "black"
    ? (g.blackRank ?? formatRating(g.blackRating))
    : (g.whiteRank ?? formatRating(g.whiteRating));
}

export function outcomeFor(result: GameResult, side: Side): Outcome {
  if (result === "draw") return "draw";
  if (result === "unknown") return "unknown";
  return result === side ? "win" : "loss";
}

export interface Bucket {
  name: string;
  games: number;
  wins: number;
  losses: number;
}

export interface CommonPosition {
  key: string;
  ply: number;
  /** この局面を通った対局 (この対局者の対局のみ) */
  gameIds: string[];
  /** その局面での対局者の勝ち数 */
  wins: number;
}

export interface PlayerStats {
  name: string;
  rank?: string;
  games: number;
  wins: number;
  losses: number;
  draws: number;
  asBlack: number;
  asWhite: number;
  /** 先後別の勝敗 */
  bySide: Record<Side, { games: number; wins: number; losses: number }>;
  /** 本人の戦法 */
  openings: Bucket[];
  /** 本人の囲い */
  castles: Bucket[];
  /** 相手の戦法 */
  vsOpenings: Bucket[];
  timeControls: Bucket[];
  /** 2 局以上で共通する局面のうち、そこから先が分かれるもの (分岐点) */
  commonPositions: CommonPosition[];
  latest?: string;
}

function bump(map: Map<string, Bucket>, name: string, outcome: Outcome): void {
  const b = map.get(name) ?? { name, games: 0, wins: 0, losses: 0 };
  b.games++;
  if (outcome === "win") b.wins++;
  if (outcome === "loss") b.losses++;
  map.set(name, b);
}

function sorted(map: Map<string, Bucket>): Bucket[] {
  return Array.from(map.values()).sort((a, b) => b.games - a.games || a.name.localeCompare(b.name));
}

/**
 * 対局者の成績をまとめる。positions を使うので GameRecord が必要。
 */
export function computePlayerStats(all: GameRecord[], name: string): PlayerStats {
  const games = all.filter((g) => playerSide(g, name) !== null);
  const stats: PlayerStats = {
    name,
    games: games.length,
    wins: 0,
    losses: 0,
    draws: 0,
    asBlack: 0,
    asWhite: 0,
    bySide: {
      black: { games: 0, wins: 0, losses: 0 },
      white: { games: 0, wins: 0, losses: 0 },
    },
    openings: [],
    castles: [],
    vsOpenings: [],
    timeControls: [],
    commonPositions: [],
  };
  const openings = new Map<string, Bucket>();
  const castles = new Map<string, Bucket>();
  const vsOpenings = new Map<string, Bucket>();
  const timeControls = new Map<string, Bucket>();
  let latest: { at: string; rank?: string } | undefined;

  for (const g of games) {
    const side = playerSide(g, name)!;
    const outcome = outcomeFor(g.result, side);
    if (outcome === "win") stats.wins++;
    else if (outcome === "loss") stats.losses++;
    else if (outcome === "draw") stats.draws++;
    if (side === "black") stats.asBlack++;
    else stats.asWhite++;
    const s = stats.bySide[side];
    s.games++;
    if (outcome === "win") s.wins++;
    else if (outcome === "loss") s.losses++;

    const own = side === "black" ? g.opening.blackOpening : g.opening.whiteOpening;
    const ownCastle = side === "black" ? g.opening.blackCastle : g.opening.whiteCastle;
    const theirs = side === "black" ? g.opening.whiteOpening : g.opening.blackOpening;
    bump(openings, own, outcome);
    bump(castles, ownCastle, outcome);
    bump(vsOpenings, theirs, outcome);
    bump(timeControls, g.timeControl ?? "不明", outcome);

    const rank = rankOf(g, side);
    const at = g.startedAt ?? g.importedAt;
    if (!latest || at > latest.at) latest = { at, rank: rank ?? latest?.rank };
  }

  stats.openings = sorted(openings);
  stats.castles = sorted(castles);
  stats.vsOpenings = sorted(vsOpenings);
  stats.timeControls = sorted(timeControls);
  if (latest) {
    stats.latest = latest.at;
    if (latest.rank) stats.rank = latest.rank;
  }

  stats.commonPositions = findCommonPositions(games, name);
  return stats;
}

/**
 * 2 局以上で共通する局面のうち、そこから先が分かれるもの (分岐点)。
 * `games` のうち `name` が指した対局だけを見る。条件で絞った対局集合を渡せば、その条件下の分岐点になる。
 */
export function findCommonPositions(games: GameRecord[], name: string): CommonPosition[] {
  const byPosition = new Map<string, { ply: number; gameIds: Set<string>; wins: number }>();
  for (const g of games) {
    const side = playerSide(g, name);
    if (side === null) continue;
    const outcome = outcomeFor(g.result, side);
    const end = Math.min(g.positions.length - 1, COMMON_POSITION_PLIES);
    for (let ply = COMMON_POSITION_MIN_PLY; ply <= end; ply++) {
      const key = g.positions[ply];
      if (!key) continue;
      const entry = byPosition.get(key) ?? { ply, gameIds: new Set<string>(), wins: 0 };
      if (!entry.gameIds.has(g.id)) {
        entry.gameIds.add(g.id);
        if (outcome === "win") entry.wins++;
      }
      byPosition.set(key, entry);
    }
  }

  // 同じ対局集合を持つ局面は最も深いものだけ残す (= そこから先で分かれる局面)
  const deepest = new Map<string, CommonPosition>();
  for (const [key, e] of byPosition) {
    if (e.gameIds.size < 2) continue;
    const setKey = Array.from(e.gameIds).sort().join(",");
    const cur = deepest.get(setKey);
    if (!cur || e.ply > cur.ply) {
      deepest.set(setKey, { key, ply: e.ply, gameIds: Array.from(e.gameIds).sort(), wins: e.wins });
    }
  }
  return Array.from(deepest.values()).sort(
    (a, b) => b.gameIds.length - a.gameIds.length || b.ply - a.ply,
  );
}

/**
 * 本人 (登録した対局者) の側。タグに名前が入っている側で、両方か どちらも入っていなければ null。
 * 棋譜ビューアで本人側を手前にするために使う。
 */
export function trackedSide(g: Pick<GameSummary, "black" | "white" | "tags">): Side | null {
  const black = g.tags.includes(g.black);
  const white = g.tags.includes(g.white);
  if (black === white) return null;
  return black ? "black" : "white";
}

export interface PlayerSummary {
  name: string;
  games: number;
  wins: number;
  losses: number;
  rank?: string;
  latest?: string;
  tags: string[];
  /** 自分で登録した対局者か (Issue のタイトル = 名前がタグに入っている) */
  tracked: boolean;
}

/** 全対局から対局者の一覧を作る */
export function listPlayers(games: GameSummary[]): PlayerSummary[] {
  const map = new Map<string, PlayerSummary & { latestAt: string }>();
  for (const g of games) {
    for (const side of ["black", "white"] as const) {
      const name = g[side];
      const p = map.get(name) ?? {
        name,
        games: 0,
        wins: 0,
        losses: 0,
        tags: [],
        latestAt: "",
        tracked: false,
      };
      if (g.tags.includes(name)) p.tracked = true;
      p.games++;
      const o = outcomeFor(g.result, side);
      if (o === "win") p.wins++;
      if (o === "loss") p.losses++;
      const at = g.startedAt ?? g.importedAt;
      if (at > p.latestAt) {
        p.latestAt = at;
        p.latest = at;
        const rank = rankOf(g, side);
        if (rank) p.rank = rank;
      }
      for (const t of g.tags)
        if (t === name || t === "大会相手" || t === "YouTuber") p.tags.push(t);
      map.set(name, p);
    }
  }
  return Array.from(map.values())
    .map((p) => ({ ...p, tags: Array.from(new Set(p.tags.filter((t) => t !== p.name))) }))
    .sort(
      (a, b) =>
        Number(b.tracked) - Number(a.tracked) || b.games - a.games || a.name.localeCompare(b.name),
    );
}
