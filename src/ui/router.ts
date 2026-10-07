import type { PortfolioRowCondition } from "../core/portfolio";
import type { Side } from "../core/stats";
import { STYLE_QUADRANTS, type OpeningAxis, type StyleQuadrant } from "../core/styles";
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
  /** 対局者の戦型。対局者を指定したときだけ効く */
  selfStyle?: Exclude<SideStyle, "unknown">;
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

/**
 * 対局者ページの階層 (4 区分 → 戦法の一覧 → 戦法の詳細) のどこを見ているか。
 * 省くと概要と 4 区分だけ。opening を付けると戦法の詳細。axis は戦法の一覧を相手の戦法で見るとき。
 */
export interface PlayerView {
  quadrant: StyleQuadrant;
  axis?: OpeningAxis;
  opening?: string;
}

/**
 * 分岐点の学習画面の状態。view は分岐点の木を作った戦法の詳細 (省くと本人の全対局)、
 * at は開始局面からの手数、pick は分岐点で選んだ候補手 (USI)、line は続きをたどる対局。
 */
export interface BranchState {
  view?: PlayerView;
  at?: number;
  pick?: string;
  line?: string;
}

export type Route =
  | { kind: "list"; query?: ListQuery; portfolio?: PortfolioFilter }
  | { kind: "players" }
  | { kind: "settings" }
  | { kind: "updates" }
  | { kind: "game"; id: string; ply?: number }
  | { kind: "player"; name: string; view?: PlayerView }
  /** 分岐点の学習画面。key は分岐点の局面キー。残りは学習画面の状態 (戻ったときに復元する) */
  | ({ kind: "branch"; name: string; key: string } & BranchState)
  /** 参考の対局者 (other) と同じ局面で何を指したかの比較。opening で 2 人の戦法を絞る */
  | { kind: "compare"; name: string; other: string; opening?: string; diffOnly?: boolean };

const SIDE_FILTERS: readonly SideFilter[] = ["black", "white", "self", "opponent"];
const RESULTS: readonly ResultFilter[] = ["black", "white", "other", "win", "loss"];
const SERVICES = ["wars", "quest"] as const;
const SELF_STYLES = ["ibisha", "furibisha"] as const;
const AXES: readonly OpeningAxis[] = ["self", "opponent"];
const SHAPES: readonly GameShape[] = ["aiIbisha", "taikokei", "aiFuribisha", "unknown"];
/** URL に出す順 */
const QUERY_KEYS = [
  "player",
  "service",
  "shape",
  "selfStyle",
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
    selfStyle: pick(p.get("selfStyle"), SELF_STYLES),
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

function parsePlayerView(search: string): PlayerView | undefined {
  const p = new URLSearchParams(search);
  const quadrant = pick(p.get("style"), STYLE_QUADRANTS);
  if (!quadrant) return undefined;
  const view: PlayerView = { quadrant };
  const axis = pick(p.get("axis"), AXES);
  if (axis === "opponent") view.axis = axis;
  const opening = p.get("opening");
  if (opening) view.opening = opening;
  return view;
}

function playerViewString(view: PlayerView): string {
  const p = new URLSearchParams({ style: view.quadrant });
  if (view.axis === "opponent") p.set("axis", view.axis);
  if (view.opening) p.set("opening", view.opening);
  return p.toString();
}

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
    const route: Route = {
      kind: "branch",
      name: decodeURIComponent(branch[1]),
      key: decodeURIComponent(branch[2]),
    };
    const search = qi < 0 ? "" : full.slice(qi + 1);
    const view = parsePlayerView(search);
    if (view) route.view = view;
    const p = new URLSearchParams(search);
    const at = Number(p.get("at"));
    if (p.get("at") && Number.isInteger(at) && at >= 0) route.at = at;
    const pick = p.get("pick");
    if (pick) route.pick = pick;
    const line = p.get("line");
    if (line) route.line = line;
    return route;
  }
  const compare = /^#\/player\/([^/]+)\/compare\/([^/]+)$/.exec(hash);
  if (compare?.[1] && compare[2]) {
    const route: Route = {
      kind: "compare",
      name: decodeURIComponent(compare[1]),
      other: decodeURIComponent(compare[2]),
    };
    const p = new URLSearchParams(qi < 0 ? "" : full.slice(qi + 1));
    const opening = p.get("opening");
    if (opening) route.opening = opening;
    if (p.get("diff") === "1") route.diffOnly = true;
    return route;
  }
  const player = /^#\/player\/([^/]+)$/.exec(hash);
  if (player?.[1]) {
    const route: Route = { kind: "player", name: decodeURIComponent(player[1]) };
    const view = parsePlayerView(qi < 0 ? "" : full.slice(qi + 1));
    if (view) route.view = view;
    return route;
  }
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
    case "player": {
      const path = `#/player/${encodeURIComponent(route.name)}`;
      return route.view ? `${path}?${playerViewString(route.view)}` : path;
    }
    case "branch": {
      const path = `#/player/${encodeURIComponent(route.name)}/branch/${encodeURIComponent(route.key)}`;
      const p = new URLSearchParams(route.view ? playerViewString(route.view) : "");
      if (route.at !== undefined) p.set("at", String(route.at));
      if (route.pick) p.set("pick", route.pick);
      if (route.line) p.set("line", route.line);
      const qs = p.toString();
      return qs ? `${path}?${qs}` : path;
    }
    case "compare": {
      const path = `#/player/${encodeURIComponent(route.name)}/compare/${encodeURIComponent(route.other)}`;
      const p = new URLSearchParams();
      if (route.opening) p.set("opening", route.opening);
      if (route.diffOnly) p.set("diff", "1");
      const qs = p.toString();
      return qs ? `${path}?${qs}` : path;
    }
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
