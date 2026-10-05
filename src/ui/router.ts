export type Route =
  { kind: "list" } | { kind: "import" } | { kind: "settings" } | { kind: "game"; id: string };

export function parseHash(hash: string): Route {
  const m = /^#\/game\/([0-9a-f]+)/.exec(hash);
  if (m?.[1]) return { kind: "game", id: m[1] };
  if (hash.startsWith("#/settings")) return { kind: "settings" };
  return { kind: "list" };
}

export function navigate(route: Route): void {
  const hash =
    route.kind === "game" ? `#/game/${route.id}` : route.kind === "list" ? "#/" : `#/${route.kind}`;
  if (location.hash !== hash) location.hash = hash;
}
