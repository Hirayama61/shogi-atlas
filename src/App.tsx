import { useEffect, useState } from "react";
import { GameList } from "./ui/GameList";
import { GameViewer } from "./ui/GameViewer";
import { PlayerList } from "./ui/PlayerList";
import { PlayerPage } from "./ui/PlayerPage";
import { SettingsPane } from "./ui/SettingsPane";
import { navigate, parseHash, type Route } from "./ui/router";

export default function App() {
  const [route, setRoute] = useState<Route>(() => parseHash(location.hash));

  useEffect(() => {
    const onHash = () => setRoute(parseHash(location.hash));
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  const tab = (kind: "list" | "players" | "settings", label: string, active: boolean) => (
    <button key={kind} className={active ? "active" : ""} onClick={() => navigate({ kind })}>
      {label}
    </button>
  );

  return (
    <>
      <header className="app">
        <nav className="tabs">
          {tab("list", "棋譜", route.kind === "list" || route.kind === "game")}
          {tab("players", "対局者", route.kind === "players" || route.kind === "player")}
          {tab("settings", "設定", route.kind === "settings")}
        </nav>
      </header>
      {route.kind === "list" && <GameList />}
      {route.kind === "players" && <PlayerList />}
      {route.kind === "player" && <PlayerPage name={route.name} />}
      {route.kind === "settings" && <SettingsPane />}
      {route.kind === "game" && <GameViewer id={route.id} initialPly={route.ply} />}
    </>
  );
}
