import { useEffect, useState } from "react";
import { GameList } from "./ui/GameList";
import { GameViewer } from "./ui/GameViewer";
import { SettingsPane } from "./ui/SettingsPane";
import { navigate, parseHash, type Route } from "./ui/router";

export default function App() {
  const [route, setRoute] = useState<Route>(() => parseHash(location.hash));

  useEffect(() => {
    const onHash = () => setRoute(parseHash(location.hash));
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  const tab = (kind: Route["kind"], label: string) => (
    <button
      key={kind}
      className={route.kind === kind ? "active" : ""}
      onClick={() => navigate({ kind } as Route)}
    >
      {label}
    </button>
  );

  return (
    <>
      <header className="app">
        <nav className="tabs">
          {tab("list", "棋譜")}
          {tab("settings", "設定")}
        </nav>
      </header>
      {route.kind === "list" && <GameList onOpen={(id) => navigate({ kind: "game", id })} />}
      {route.kind === "settings" && <SettingsPane />}
      {route.kind === "game" && (
        <GameViewer id={route.id} onOpen={(id) => navigate({ kind: "game", id })} />
      )}
    </>
  );
}
