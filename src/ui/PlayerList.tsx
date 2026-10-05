import { useLiveQuery } from "dexie-react-hooks";
import { useMemo, useState } from "react";
import { listPlayers } from "../core/stats";
import { db } from "../db/db";
import { formatDate } from "./labels";
import { navigate } from "./router";

export function PlayerList() {
  const [query, setQuery] = useState("");
  const [showAll, setShowAll] = useState(false);
  const games = useLiveQuery(() => db.games.toArray(), []);
  const players = useMemo(() => (games ? listPlayers(games) : []), [games]);
  const filtered = players.filter(
    (p) => (showAll || p.tracked) && (!query || p.name.toLowerCase().includes(query.toLowerCase())),
  );

  if (!games) return <p className="muted">読み込み中…</p>;

  return (
    <section>
      <div className="panel row">
        <input
          type="search"
          placeholder="名前で絞り込み"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          style={{
            flex: 1,
            minWidth: 180,
            padding: 8,
            borderRadius: 8,
            border: "1px solid var(--border)",
            background: "var(--bg)",
          }}
        />
        <span className="muted">{filtered.length} 人</span>
        <label className="row muted">
          <input type="checkbox" checked={showAll} onChange={(e) => setShowAll(e.target.checked)} />
          対局相手も表示
        </label>
      </div>
      {filtered.length === 0 && (
        <p className="muted">
          登録した対局者がいません。データリポジトリで対局者名をタイトルにした Issue
          を作ると、ここに出ます。
        </p>
      )}
      <ul className="games">
        {filtered.map((p) => (
          <li key={p.name} onClick={() => navigate({ kind: "player", name: p.name })}>
            <div className="game-title">
              {p.name}
              {p.rank ? <span className="muted"> {p.rank}</span> : null}
            </div>
            <div className="muted">
              {p.games} 局 · {p.wins} 勝 {p.losses} 敗 · 最終 {formatDate(p.latest)}
            </div>
            <div>
              {p.tags.map((t) => (
                <span key={t} className="chip">
                  {t}
                </span>
              ))}
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
