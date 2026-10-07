import type { PortfolioRowCondition } from "../core/portfolio";
import type { Side } from "../core/stats";
import type { GameShape, SideStyle } from "../core/types";

/** 戦法・囲いをどちらの側で見るか。self / opponent は対局者を指定したときだけ効く */
export type SideFilter = "black" | "white" | "self" | "opponent";

/** 勝敗。other は引き分け・不明。win / loss は対局者を指定したときだけ効く */
export type ResultFilter = "black" | "white" | "other" | "win" | "loss";

/** 棋譜一覧の絞り込み。項目は独立していて、指定したものすべてを満たす対局を出す */
export interface ListQuery {
  player?: string;
  service?: "wars" | "quest";
  shape?: GameShape;
  opening?: string;
  /** 省くと先手・後手どちらでも */
  openingSide?: SideFilter;
  castle?: string;
  castleSide?: SideFilter;
  result?: ResultFilter;
}

/** 対局者ページの集計行 (採用戦法・囲い・相手の戦法) */
export type GameFilterField = "opening" | "castle" | "vsOpening";

/** 戦型ポートフォリオの 1 行 (先後 × 相手の戦型 → 本人の戦法 × 囲い) の対局 */
export interface PortfolioFilter {
  player: string;
  condition: PortfolioRowCondition;
}

export type Route =
  | { kind: "list"; query?: ListQuery; portfolio?: PortfolioFilter }
  | { kind: "players" }
  | { kind: "settings" }
  | { kind: "updates" }
  | { kind: "game"; id: string; ply?: number }
  | { kind: "player"; name: string }
  /** 分岐点の学習画面。key は分岐点の局面キー */
  | { kind: "branch"; name: string; key: string };

const SIDE_FILTERS: readonly SideFilter[] = ["black", "white", "self", "opponent"];
const RESULTS: readonly ResultFilter[] = ["black", "white", "other", "win", "loss"];
const SERVICES = ["wars", "quest"] as const;
const SHAPES: readonly GameShape[] = ["aiIbisha", "taikokei", "aiFuribisha", "unknown"];
/** URL に出す順 */
const QUERY_KEYS = [
  "player",
  "service",
  "shape",
  "opening",
  "openingSide",
  "castle",
  "castleSide",
  "result",
] as const satisfies readonly (keyof ListQuery)[];

/** 対局者ページの集計行の条件 (#/player/<名前>/games/<field>/<値> と同じ意味) */
export function fieldQuery(player: string, field: GameFilterField, value: string): ListQuery {
  if (field === "castle") return { player, castle: value, castleSide: "self" };
  return { player, opening: value, openingSide: field === "opening" ? "self" : "opponent" };
}

function pick<T extends string>(v: string | null, allowed: readonly T[]): T | undefined {
  return v !== null && (allowed as readonly string[]).includes(v) ? (v as T) : undefined;
}

export function parseQuery(search: string): ListQuery {
  const p = new URLSearchParams(search);
  const q: ListQuery = {
    player: p.get("player") || undefined,
    service: pick(p.get("service"), SERVICES),
    shape: pick(p.get("shape"), SHAPES),
    opening: p.get("opening") || undefined,
    openingSide: pick(p.get("openingSide"), SIDE_FILTERS),
    castle: p.get("castle") || undefined,
    castleSide: pick(p.get("castleSide"), SIDE_FILTERS),
    result: pick(p.get("result"), RESULTS),
  };
  return compactQuery(q);
}

/** 値の無い項目を落とす (URL と比較のため) */
export function compactQuery(q: ListQuery): ListQuery {
  const out: ListQuery = {};
  for (const k of QUERY_KEYS) {
    const v = q[k];
    if (v) (out as Record<string, string>)[k] = v;
  }
  return out;
}

export function queryString(q: ListQuery): string {
  const p = new URLSearchParams();
  for (const k of QUERY_KEYS) {
    const v = q[k];
    if (v) p.set(k, v);
  }
  return p.toString();
}

function listRoute(query: ListQuery, portfolio?: PortfolioFilter): Route {
  const route: Route = { kind: "list" };
  if (Object.keys(query).length > 0) route.query = query;
  if (portfolio) route.portfolio = portfolio;
  return route;
}
const SIDES: readonly Side[] = ["black", "white"];
const STYLES: readonly SideStyle[] = ["ibisha", "furibisha", "unknown"];

export function parseHash(full: string): Route {
  const qi = full.indexOf("?");
  const hash = qi < 0 ? full : full.slice(0, qi);
  const query = qi < 0 ? {} : parseQuery(full.slice(qi + 1));
  const game = /^#\/game\/([0-9a-f]+)(?:\/(\d+))?/.exec(hash);
  if (game?.[1]) return { kind: "game", id: game[1], ply: game[2] ? Number(game[2]) : undefined };
  const pf = /^#\/player\/([^/]+)\/portfolio\/([^/]+)\/([^/]+)\/([^/]+)\/([^/]+)\/([^/]+)$/.exec(
    hash,
  );
  if (pf) {
    const [, player, side, vsStyle, vsOpening, opening, castle] = pf.map((x) =>
      decodeURIComponent(x),
    );
    if (
      player &&
      vsOpening &&
      opening &&
      castle &&
      SIDES.includes(side as Side) &&
      STYLES.includes(vsStyle as SideStyle)
    ) {
      return listRoute(query, {
        player,
        condition: {
          side: side as Side,
          vsStyle: vsStyle as SideStyle,
          vsOpening,
          opening,
          castle,
        },
      });
    }
  }
  const games = /^#\/player\/([^/]+)\/games\/([^/]+)\/([^/]+)$/.exec(hash);
  if (games?.[1] && games[2] && games[3]) {
    // #6 の形式。今の形式 (#/games?...) と同じ条件に読み替える
    const field = pick(games[2], ["opening", "castle", "vsOpening"] as const);
    if (field) {
      return listRoute(
        compactQuery({
          ...query,
          ...fieldQuery(decodeURIComponent(games[1]), field, decodeURIComponent(games[3])),
        }),
      );
    }
  }
  const branch = /^#\/player\/([^/]+)\/branch\/([^/]+)$/.exec(hash);
  if (branch?.[1] && branch[2]) {
    return {
      kind: "branch",
      name: decodeURIComponent(branch[1]),
      key: decodeURIComponent(branch[2]),
    };
  }
  const player = /^#\/player\/([^/]+)$/.exec(hash);
  if (player?.[1]) return { kind: "player", name: decodeURIComponent(player[1]) };
  if (hash.startsWith("#/players")) return { kind: "players" };
  if (hash.startsWith("#/settings")) return { kind: "settings" };
  if (hash.startsWith("#/updates")) return { kind: "updates" };
  if (hash === "#/games") return listRoute(query);
  // 外した検索ルートなど、知らない URL はトップ (棋譜一覧) に戻す
  return { kind: "list" };
}

export function hashFor(route: Route): string {
  switch (route.kind) {
    case "game":
      return route.ply !== undefined ? `#/game/${route.id}/${route.ply}` : `#/game/${route.id}`;
    case "player":
      return `#/player/${encodeURIComponent(route.name)}`;
    case "branch":
      return `#/player/${encodeURIComponent(route.name)}/branch/${encodeURIComponent(route.key)}`;
    case "list": {
      const qs = queryString(route.query ?? {});
      if (route.portfolio) {
        const c = route.portfolio.condition;
        const path = `#/player/${[
          route.portfolio.player,
          "portfolio",
          c.side,
          c.vsStyle,
          c.vsOpening ?? "",
          c.opening,
          c.castle,
        ]
          .map(encodeURIComponent)
          .join("/")}`;
        return qs ? `${path}?${qs}` : path;
      }
      return qs ? `#/games?${qs}` : "#/";
    }
    default:
      return `#/${route.kind}`;
  }
}

export function navigate(route: Route): void {
  const hash = hashFor(route);
  if (location.hash !== hash) location.hash = hash;
}
