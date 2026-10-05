import { useLiveQuery } from "dexie-react-hooks";
import { useEffect, useMemo, useState } from "react";
import { importRecord } from "../core/parse";
import { positionKey } from "../core/position";
import { GAME_SHAPE_LABEL, SIDE_STYLE_LABEL } from "../core/opening";
import { db, findGamesByPosition } from "../db/db";
import { Board } from "./Board";
import { describeGame, formatDate } from "./labels";

interface Props {
  id: string;
  onOpen: (id: string) => void;
}

interface PlyInfo {
  ply: number;
  text: string;
  sfen: string;
  usi?: string;
}

export function GameViewer({ id, onOpen }: Props) {
  const game = useLiveQuery(() => db.games.get(id), [id]);
  const [ply, setPly] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const [copied, setCopied] = useState("");

  const plies = useMemo<PlyInfo[]>(() => {
    if (!game) return [];
    try {
      const { record } = importRecord(game.raw);
      const out: PlyInfo[] = [];
      record.forEach((node) => {
        const usi = "usi" in node.move ? node.move.usi : undefined;
        if (node.ply > 0 && !usi) return; // 投了などは盤面に影響しない
        out.push({
          ply: node.ply,
          text: node.ply === 0 ? "開始局面" : node.displayText,
          sfen: node.sfen,
          usi,
        });
      });
      return out;
    } catch {
      return [];
    }
  }, [game]);

  const current = plies[Math.min(ply, plies.length - 1)];
  const key = current ? positionKey(current.sfen) : "";
  const sameGames = useLiveQuery(
    async () => (key ? (await findGamesByPosition(key)).filter((g) => g.id !== id) : []),
    [key, id],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowLeft") setPly((p) => Math.max(0, p - 1));
      if (e.key === "ArrowRight") setPly((p) => Math.min(plies.length - 1, p + 1));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [plies.length]);

  if (game === undefined) return <p className="muted">読み込み中…</p>;
  if (game === null) return <p className="error">棋譜が見つかりません</p>;
  if (!current) return <p className="error">棋譜を表示できません</p>;

  const copy = async (text: string, label: string) => {
    await navigator.clipboard.writeText(text);
    setCopied(label);
    setTimeout(() => setCopied(""), 1500);
  };

  return (
    <section className="viewer">
      <div>
        <Board sfen={current.sfen} lastMoveUsi={current.usi} flipped={flipped} />
        <div className="controls" style={{ marginTop: 8 }}>
          <button className="ghost" onClick={() => setPly(0)}>
            |◀
          </button>
          <button className="ghost" onClick={() => setPly((p) => Math.max(0, p - 1))}>
            ◀
          </button>
          <span style={{ alignSelf: "center", minWidth: 70, textAlign: "center" }}>
            {current.ply} 手目
          </span>
          <button
            className="ghost"
            onClick={() => setPly((p) => Math.min(plies.length - 1, p + 1))}
          >
            ▶
          </button>
          <button className="ghost" onClick={() => setPly(plies.length - 1)}>
            ▶|
          </button>
          <button className="ghost" onClick={() => setFlipped((f) => !f)}>
            反転
          </button>
        </div>
        <div className="row" style={{ marginTop: 8, justifyContent: "center" }}>
          <button className="ghost" onClick={() => copy(game.raw, "KIF")}>
            KIF をコピー
          </button>
          <button className="ghost" onClick={() => copy(current.sfen, "SFEN")}>
            局面 SFEN をコピー
          </button>
          {copied && <span className="muted">{copied} をコピーしました</span>}
        </div>
      </div>
      <div>
        <div className="panel">
          <div className="game-title">
            <span className={game.result === "black" ? "win" : ""}>
              ☗{game.black}
              {game.blackRank ? ` ${game.blackRank}` : ""}
            </span>
            {" vs "}
            <span className={game.result === "white" ? "win" : ""}>
              ☖{game.white}
              {game.whiteRank ? ` ${game.whiteRank}` : ""}
            </span>
          </div>
          <dl className="kv">
            <dt>日時</dt>
            <dd>{formatDate(game.startedAt)}</dd>
            <dt>概要</dt>
            <dd>{describeGame(game)}</dd>
            <dt>戦型</dt>
            <dd>
              {GAME_SHAPE_LABEL[game.opening.shape]} (☗{SIDE_STYLE_LABEL[game.opening.black]} / ☖
              {SIDE_STYLE_LABEL[game.opening.white]})
            </dd>
            {game.tournament && (
              <>
                <dt>棋戦</dt>
                <dd>{game.tournament}</dd>
              </>
            )}
            {game.source.url && (
              <>
                <dt>出典</dt>
                <dd>
                  <a href={game.source.url} target="_blank" rel="noreferrer">
                    {game.source.url}
                  </a>
                </dd>
              </>
            )}
            {game.memo && (
              <>
                <dt>メモ</dt>
                <dd>{game.memo}</dd>
              </>
            )}
            <dt>タグ</dt>
            <dd>
              {game.tags.length ? (
                game.tags.map((t) => (
                  <span key={t} className="chip">
                    {t}
                  </span>
                ))
              ) : (
                <span className="muted">なし</span>
              )}
            </dd>
          </dl>
        </div>
        <div className="panel">
          <strong>同じ局面を通った対局</strong>
          {!sameGames?.length && <p className="muted">なし</p>}
          <ul className="games">
            {sameGames?.map((g) => (
              <li key={g.id} onClick={() => onOpen(g.id)}>
                <div>
                  ☗{g.black} vs ☖{g.white}
                </div>
                <div className="muted">
                  {formatDate(g.startedAt)} · {describeGame(g)}
                </div>
              </li>
            ))}
          </ul>
        </div>
        <div className="panel moves">
          {plies.map((p) => (
            <button
              key={p.ply}
              className={p.ply === current.ply ? "current" : ""}
              onClick={() => setPly(p.ply)}
            >
              {p.ply > 0 ? `${String(p.ply).padStart(3, " ")} ${p.text}` : p.text}
            </button>
          ))}
        </div>
      </div>
    </section>
  );
}
