import { useLiveQuery } from "dexie-react-hooks";
import { useMemo, useState } from "react";
import { db } from "../db/db";
import type { GameShape } from "../core/types";
import { GAME_SHAPE_LABEL } from "../core/opening";
import { describeGame, formatDate } from "./labels";

interface Props {
  onOpen: (id: string) => void;
}

export function GameList({ onOpen }: Props) {
  const [query, setQuery] = useState("");
  const [shape, setShape] = useState<GameShape | "">("");
  const games = useLiveQuery(() => db.games.orderBy("startedAt").reverse().toArray(), []);

  const filtered = useMemo(() => {
    if (!games) return [];
    const q = query.trim().toLowerCase();
    return games.filter((g) => {
      if (shape && g.opening.shape !== shape) return false;
      if (!q) return true;
      return (
        g.black.toLowerCase().includes(q) ||
        g.white.toLowerCase().includes(q) ||
        g.tags.some((t) => t.toLowerCase().includes(q)) ||
        (g.memo ?? "").toLowerCase().includes(q)
      );
    });
  }, [games, query, shape]);

  if (!games) return <p className="muted">読み込み中…</p>;

  return (
    <section>
      <div className="panel row">
        <input
          type="search"
          placeholder="対局者・タグ・メモで絞り込み"
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
          {filtered.length} / {games.length} 局
        </span>
      </div>
      {games.length === 0 && (
        <div className="panel">
          <p>まだ棋譜がありません。</p>
          <p className="muted">
            「設定」からデータリポジトリと同期してください。棋譜はデータリポジトリの Issue
            に貼ると取り込まれます。
          </p>
        </div>
      )}
      <ul className="games">
        {filtered.map((g) => (
          <li key={g.id} onClick={() => onOpen(g.id)}>
            <div className="game-title">
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
        ))}
      </ul>
    </section>
  );
}
