export type Route =
  | { kind: "list" }
  | { kind: "players" }
  | { kind: "settings" }
  | { kind: "updates" }
  | { kind: "game"; id: string; ply?: number }
  | { kind: "player"; name: string };

export function parseHash(hash: string): Route {
  const game = /^#\/game\/([0-9a-f]+)(?:\/(\d+))?/.exec(hash);
  if (game?.[1]) return { kind: "game", id: game[1], ply: game[2] ? Number(game[2]) : undefined };
  const player = /^#\/player\/(.+)$/.exec(hash);
  if (player?.[1]) return { kind: "player", name: decodeURIComponent(player[1]) };
  if (hash.startsWith("#/players")) return { kind: "players" };
  if (hash.startsWith("#/settings")) return { kind: "settings" };
  if (hash.startsWith("#/updates")) return { kind: "updates" };
  return { kind: "list" };
}

export function hashFor(route: Route): string {
  switch (route.kind) {
    case "game":
      return route.ply !== undefined ? `#/game/${route.id}/${route.ply}` : `#/game/${route.id}`;
    case "player":
      return `#/player/${encodeURIComponent(route.name)}`;
    case "list":
      return "#/";
    default:
      return `#/${route.kind}`;
  }
}

export function navigate(route: Route): void {
  const hash = hashFor(route);
  if (location.hash !== hash) location.hash = hash;
}
