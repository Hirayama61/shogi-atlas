import { useLiveQuery } from "dexie-react-hooks";
import { useEffect, useMemo, useState } from "react";
import { JUDGEMENT_LABEL, reviewGame, type GameReview } from "../core/analysis";
import { annotatedKif } from "../core/annotate";
import { importRecord } from "../core/parse";
import { positionKey } from "../core/position";
import { formatRating } from "../core/quest";
import { GAME_SHAPE_LABEL } from "../core/opening";
import { db, findGamesByPosition } from "../db/db";
import { Board } from "./Board";
import { EvalChart } from "./EvalChart";
import { LossHelp } from "./LossHelp";
import { describeGame, fmtCp, formatDate } from "./labels";
import { navigate } from "./router";

interface Props {
  id: string;
  initialPly?: number;
}

interface PlyInfo {
  ply: number;
  text: string;
  sfen: string;
  usi?: string;
}

export function GameViewer({ id, initialPly }: Props) {
  const game = useLiveQuery(() => db.games.get(id), [id]);
  const analysis = useLiveQuery(() => db.analyses.get(id), [id]);
  const review = useMemo<GameReview | null>(() => {
    if (!game || !analysis) return null;
    try {
      return reviewGame(game, analysis);
    } catch {
      return null;
    }
  }, [game, analysis]);
  const reviewByPly = useMemo(
    () => new Map((review?.moves ?? []).map((m) => [m.ply, m] as const)),
    [review],
  );
  const [ply, setPly] = useState(initialPly ?? 0);
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
          {analysis && (
            <button
              className="ghost"
              onClick={() => copy(annotatedKif(game, analysis), "解析つき KIF")}
            >
              解析つき KIF をコピー
            </button>
          )}
          {copied && <span className="muted">{copied} をコピーしました</span>}
        </div>
        {review ? (
          <div className="panel" style={{ marginTop: 12 }}>
            <EvalChart
              curve={review.curve}
              moves={review.moves}
              currentPly={current.ply}
              onSelect={setPly}
            />
            {(() => {
              const m = reviewByPly.get(current.ply);
              if (!m) return null;
              return (
                <p style={{ margin: "6px 0 0" }}>
                  {current.ply}手目 {current.text}
                  {m.judgement !== "good" && (
                    <span className="mark"> {JUDGEMENT_LABEL[m.judgement]}</span>
                  )}
                  <span className="muted">
                    {" "}
                    {fmtCp(m.cpBefore)} → {fmtCp(m.cpAfter)}
                    {m.best ? ` · 最善 ${m.best}` : " · 最善"}
                  </span>
                </p>
              );
            })()}
            <dl className="kv" style={{ marginTop: 6 }}>
              <dt>☗精度</dt>
              <dd>
                平均損失 {review.black.averageLoss} · 疑問手 {review.black.counts.inaccuracy} 悪手{" "}
                {review.black.counts.mistake} 大悪手 {review.black.counts.blunder}
              </dd>
              <dt>☖精度</dt>
              <dd>
                平均損失 {review.white.averageLoss} · 疑問手 {review.white.counts.inaccuracy} 悪手{" "}
                {review.white.counts.mistake} 大悪手 {review.white.counts.blunder}
              </dd>
              <dt></dt>
              <dd>
                <LossHelp />
              </dd>
              <dt>エンジン</dt>
              <dd className="muted">
                {analysis?.engine.name} 深さ {analysis?.engine.depth}
              </dd>
            </dl>
          </div>
        ) : (
          <p className="muted" style={{ textAlign: "center", marginTop: 8 }}>
            エンジン解析はまだありません
          </p>
        )}
      </div>
      <div>
        <div className="panel">
          <div className="game-title">
            <a
              className={game.result === "black" ? "win" : ""}
              href={`#/player/${encodeURIComponent(game.black)}`}
            >
              ☗{game.black}
              {game.blackRank ? ` ${game.blackRank}` : ""}
              {game.blackRating !== undefined ? ` ${formatRating(game.blackRating)}` : ""}
            </a>
            {" vs "}
            <a
              className={game.result === "white" ? "win" : ""}
              href={`#/player/${encodeURIComponent(game.white)}`}
            >
              ☖{game.white}
              {game.whiteRank ? ` ${game.whiteRank}` : ""}
              {game.whiteRating !== undefined ? ` ${formatRating(game.whiteRating)}` : ""}
            </a>
          </div>
          <dl className="kv">
            <dt>日時</dt>
            <dd>{formatDate(game.startedAt)}</dd>
            <dt>概要</dt>
            <dd>{describeGame(game)}</dd>
            <dt>戦型</dt>
            <dd>{GAME_SHAPE_LABEL[game.opening.shape]}</dd>
            <dt>☗戦法</dt>
            <dd>
              {game.opening.blackOpening} · 囲い: {game.opening.blackCastle}
            </dd>
            <dt>☖戦法</dt>
            <dd>
              {game.opening.whiteOpening} · 囲い: {game.opening.whiteCastle}
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
              <li key={g.id} onClick={() => navigate({ kind: "game", id: g.id, ply: current.ply })}>
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
              {(() => {
                const m = reviewByPly.get(p.ply);
                return m && m.judgement !== "good" ? (
                  <span className="mark">
                    {{ inaccuracy: "?!", mistake: "?", blunder: "??" }[m.judgement]}
                  </span>
                ) : null;
              })()}
            </button>
          ))}
        </div>
      </div>
    </section>
  );
}
