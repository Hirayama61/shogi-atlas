import { useLiveQuery } from "dexie-react-hooks";
import { useMemo, useState } from "react";
import { db } from "../db/db";
import type { GameShape } from "../core/types";
import { GAME_SHAPE_LABEL } from "../core/opening";
import { SERVICE_LABEL, serviceOf } from "../core/source";
import { describeFilter, describeGame, formatDate, matchesFilter } from "./labels";
import { navigate, type GameFilter } from "./router";

export function GameList({ filter }: { filter?: GameFilter }) {
  const [shape, setShape] = useState<GameShape | "">("");
  const games = useLiveQuery(() => db.games.orderBy("startedAt").reverse().toArray(), []);

  const scoped = useMemo(
    () => (games && filter ? games.filter((g) => matchesFilter(g, filter)) : games),
    [games, filter],
  );
  const filtered = useMemo(
    () => (scoped ?? []).filter((g) => !shape || g.opening.shape === shape),
    [scoped, shape],
  );

  if (!games || !scoped) return <p className="muted">読み込み中…</p>;

  return (
    <section>
      {filter && (
        <div className="panel row">
          <button
            className="ghost"
            onClick={() => navigate({ kind: "player", name: filter.player })}
          >
            ← {filter.player}
          </button>
          <span>
            {describeFilter(filter).label}: <strong>{describeFilter(filter).value}</strong>
          </span>
        </div>
      )}
      <div className="panel row">
        <select
          value={shape}
          onChange={(e) => setShape(e.target.value as GameShape | "")}
          style={{ padding: 8, borderRadius: 8 }}
        >
          <option value="">戦型すべて</option>
          {(Object.keys(GAME_SHAPE_LABEL) as GameShape[]).map((s) => (
            <option key={s} value={s}>
              {GAME_SHAPE_LABEL[s]}
            </option>
          ))}
        </select>
        <span className="muted">
          {filtered.length} / {scoped.length} 局
        </span>
      </div>
      {games.length === 0 && !filter && (
        <div className="panel">
          <p>まだ棋譜がありません。</p>
          <p className="muted">
            「設定」からデータリポジトリと同期してください。棋譜はデータリポジトリの Issue
            に貼ると取り込まれます。
          </p>
        </div>
      )}
      <ul className="games">
        {filtered.map((g) => {
          const service = serviceOf(g);
          return (
            <li key={g.id} onClick={() => navigate({ kind: "game", id: g.id })}>
              <div className="game-title">
                {service !== "other" && (
                  <span className={`badge ${service}`} aria-label="出典">
                    {SERVICE_LABEL[service]}
                  </span>
                )}
                <span className={g.result === "black" ? "win" : ""}>☗{g.black}</span>
                {" vs "}
                <span className={g.result === "white" ? "win" : ""}>☖{g.white}</span>
              </div>
              <div className="muted">
                {formatDate(g.startedAt)} · {describeGame(g)}
              </div>
              <div>
                {g.tags.map((t) => (
                  <span key={t} className="chip">
                    {t}
                  </span>
                ))}
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
