import { useCallback, useEffect, useState } from "react";
import { hasUnseenUpdates } from "./changelog";
import { GameList } from "./ui/GameList";
import { GameViewer } from "./ui/GameViewer";
import { PlayerList } from "./ui/PlayerList";
import { PlayerPage } from "./ui/PlayerPage";
import { SettingsPane } from "./ui/SettingsPane";
import { UpdatesPane } from "./ui/UpdatesPane";
import { navigate, parseHash, type Route } from "./ui/router";

export default function App() {
  const [route, setRoute] = useState<Route>(() => parseHash(location.hash));
  const [unseen, setUnseen] = useState(() => hasUnseenUpdates());
  const onSeen = useCallback(() => setUnseen(false), []);

  useEffect(() => {
    const onHash = () => setRoute(parseHash(location.hash));
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  const tab = (
    kind: "list" | "players" | "settings" | "updates",
    label: string,
    active: boolean,
    mark = false,
  ) => (
    <button key={kind} className={active ? "active" : ""} onClick={() => navigate({ kind })}>
      {label}
      {mark && <span className="dot" aria-label="未読の更新あり" />}
    </button>
  );

  return (
    <>
      <header className="app">
        <nav className="tabs">
          {tab("list", "棋譜", (route.kind === "list" && !route.filter) || route.kind === "game")}
          {tab(
            "players",
            "対局者",
            route.kind === "players" ||
              route.kind === "player" ||
              (route.kind === "list" && !!route.filter),
          )}
          {tab("updates", "更新情報", route.kind === "updates", unseen)}
          {tab("settings", "設定", route.kind === "settings")}
        </nav>
      </header>
      {route.kind === "list" && <GameList filter={route.filter} />}
      {route.kind === "players" && <PlayerList />}
      {route.kind === "player" && <PlayerPage name={route.name} />}
      {route.kind === "settings" && <SettingsPane />}
      {route.kind === "updates" && <UpdatesPane onSeen={onSeen} />}
      {route.kind === "game" && <GameViewer id={route.id} initialPly={route.ply} />}
    </>
  );
}
