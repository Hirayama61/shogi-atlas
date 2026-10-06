import type { PortfolioRowCondition } from "../core/portfolio";
import type { Side } from "../core/stats";
import type { SideStyle } from "../core/types";

/** 対局者ページの集計行から棋譜一覧へ渡す絞り込み。その対局者の、その戦法・囲いの対局 */
export type GameFilterField = "opening" | "castle" | "vsOpening";

export interface FieldFilter {
  player: string;
  field: GameFilterField;
  value: string;
}

/** 戦型ポートフォリオの 1 行 (先後 × 相手の戦型 → 本人の戦法 × 囲い) の対局 */
export interface PortfolioFilter {
  player: string;
  field: "portfolio";
  condition: PortfolioRowCondition;
}

export type GameFilter = FieldFilter | PortfolioFilter;

export type Route =
  | { kind: "list"; filter?: GameFilter }
  | { kind: "players" }
  | { kind: "settings" }
  | { kind: "updates" }
  | { kind: "game"; id: string; ply?: number }
  | { kind: "player"; name: string };

const FIELDS: readonly GameFilterField[] = ["opening", "castle", "vsOpening"];
const SIDES: readonly Side[] = ["black", "white"];
const STYLES: readonly SideStyle[] = ["ibisha", "furibisha", "unknown"];

export function parseHash(hash: string): Route {
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
      return {
        kind: "list",
        filter: {
          player,
          field: "portfolio",
          condition: {
            side: side as Side,
            vsStyle: vsStyle as SideStyle,
            vsOpening,
            opening,
            castle,
          },
        },
      };
    }
  }
  const games = /^#\/player\/([^/]+)\/games\/([^/]+)\/([^/]+)$/.exec(hash);
  if (games?.[1] && games[2] && games[3]) {
    const field = games[2] as GameFilterField;
    if (FIELDS.includes(field)) {
      return {
        kind: "list",
        filter: {
          player: decodeURIComponent(games[1]),
          field,
          value: decodeURIComponent(games[3]),
        },
      };
    }
  }
  const player = /^#\/player\/([^/]+)$/.exec(hash);
  if (player?.[1]) return { kind: "player", name: decodeURIComponent(player[1]) };
  if (hash.startsWith("#/players")) return { kind: "players" };
  if (hash.startsWith("#/settings")) return { kind: "settings" };
  if (hash.startsWith("#/updates")) return { kind: "updates" };
  // 外した検索ルートなど、知らない URL はトップ (棋譜一覧) に戻す
  return { kind: "list" };
}

export function hashFor(route: Route): string {
  switch (route.kind) {
    case "game":
      return route.ply !== undefined ? `#/game/${route.id}/${route.ply}` : `#/game/${route.id}`;
    case "player":
      return `#/player/${encodeURIComponent(route.name)}`;
    case "list":
      if (!route.filter) return "#/";
      if (route.filter.field === "portfolio") {
        const c = route.filter.condition;
        return `#/player/${[
          route.filter.player,
          "portfolio",
          c.side,
          c.vsStyle,
          c.vsOpening ?? "",
          c.opening,
          c.castle,
        ]
          .map(encodeURIComponent)
          .join("/")}`;
      }
      return `#/player/${encodeURIComponent(route.filter.player)}/games/${route.filter.field}/${encodeURIComponent(route.filter.value)}`;
    default:
      return `#/${route.kind}`;
  }
}

export function navigate(route: Route): void {
  const hash = hashFor(route);
  if (location.hash !== hash) location.hash = hash;
}
