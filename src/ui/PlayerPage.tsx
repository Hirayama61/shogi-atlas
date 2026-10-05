import { useLiveQuery } from "dexie-react-hooks";
import { useMemo } from "react";
import { JUDGEMENT_LABEL, PHASE_LABEL } from "../core/analysis";
import { buildPlayerProfile } from "../core/profile";
import { computePlayerStats, playerSide, type Bucket } from "../core/stats";
import { db } from "../db/db";
import { Board } from "./Board";
import { describeGame, formatDate } from "./labels";
import { navigate } from "./router";

interface Props {
  name: string;
}

function pct(wins: number, games: number): string {
  return games ? `${Math.round((wins / games) * 100)}%` : "-";
}

function pctOrDash(v: number | null): string {
  return v === null ? "-" : `${Math.round(v * 100)}%`;
}

function BucketTableLoss({
  title,
  rows,
}: {
  title: string;
  rows: Array<{ name: string; games: number; wins: number; averageLoss: number }>;
}) {
  if (rows.length === 0) return null;
  return (
    <div className="panel">
      <strong>{title}</strong>
      <table className="stats">
        <thead>
          <tr>
            <th></th>
            <th>局</th>
            <th>勝</th>
            <th>平均損失</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.name}>
              <td>{r.name}</td>
              <td>{r.games}</td>
              <td>{r.wins}</td>
              <td>{r.averageLoss}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function BucketTable({ title, rows }: { title: string; rows: Bucket[] }) {
  if (rows.length === 0) return null;
  return (
    <div className="panel">
      <strong>{title}</strong>
      <table className="stats">
        <thead>
          <tr>
            <th></th>
            <th>局</th>
            <th>勝</th>
            <th>敗</th>
            <th>勝率</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.name}>
              <td>{r.name}</td>
              <td>{r.games}</td>
              <td>{r.wins}</td>
              <td>{r.losses}</td>
              <td>{pct(r.wins, r.wins + r.losses)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function PlayerPage({ name }: Props) {
  const games = useLiveQuery(() => db.games.toArray(), []);
  const analyses = useLiveQuery(() => db.analyses.toArray(), []);
  const stats = useMemo(() => (games ? computePlayerStats(games, name) : null), [games, name]);
  const profile = useMemo(() => {
    if (!games || !analyses) return null;
    const map = new Map(analyses.map((a) => [a.id, a] as const));
    const p = buildPlayerProfile(games, map, name, { worstMoves: 8 });
    return p.games > 0 ? p : null;
  }, [games, analyses, name]);
  const own = useMemo(
    () =>
      (games ?? [])
        .filter((g) => playerSide(g, name) !== null)
        .sort((a, b) => (b.startedAt ?? "").localeCompare(a.startedAt ?? "")),
    [games, name],
  );

  if (!games || !stats) return <p className="muted">読み込み中…</p>;
  if (stats.games === 0) return <p className="error">{name} の対局がありません</p>;

  return (
    <section>
      <div className="panel">
        <div className="game-title" style={{ fontSize: 18 }}>
          {name}
          {stats.rank ? <span className="muted"> {stats.rank}</span> : null}
        </div>
        <div className="muted">
          {stats.games} 局 · {stats.wins} 勝 {stats.losses} 敗{" "}
          {stats.draws ? `${stats.draws} 分 ` : ""}· 勝率{" "}
          {pct(stats.wins, stats.wins + stats.losses)} · 先手 {stats.asBlack} / 後手 {stats.asWhite}
        </div>
      </div>

      <div className="stats-grid">
        <BucketTable title="採用戦法" rows={stats.openings} />
        <BucketTable title="囲い" rows={stats.castles} />
        <BucketTable title="相手の戦法別" rows={stats.vsOpenings} />
        <BucketTable title="持ち時間別" rows={stats.timeControls} />
      </div>

      <div className="panel">
        <strong>弱点プロファイル</strong>
        {!profile && (
          <p className="muted">エンジン解析がまだありません (解析済みの対局が入ると出ます)</p>
        )}
        {profile && (
          <>
            <p className="muted">
              解析済み {profile.games} 局 · 1手あたり平均損失 {profile.averageLoss} cp
            </p>
            <div className="rates">
              <div>
                <strong>{pctOrDash(profile.conversionRate)}</strong>
                <span>有利 (+300) からの勝率</span>
              </div>
              <div>
                <strong>{pctOrDash(profile.resilienceRate)}</strong>
                <span>不利 (-300) から負けなかった率</span>
              </div>
              <div>
                <strong>{pctOrDash(profile.punishRate)}</strong>
                <span>相手の大悪手を咎めた率</span>
              </div>
              <div>
                <strong>{pctOrDash(profile.firstBlunderRate)}</strong>
                <span>先に大悪手を指す率</span>
              </div>
            </div>
            <table className="stats">
              <thead>
                <tr>
                  <th>段階</th>
                  <th>手数</th>
                  <th>平均損失</th>
                  <th>大悪手率</th>
                </tr>
              </thead>
              <tbody>
                {(["opening", "middlegame", "endgame"] as const).map((ph) => (
                  <tr key={ph}>
                    <td>{PHASE_LABEL[ph]}</td>
                    <td>{profile.byPhase[ph].moves}</td>
                    <td>{profile.byPhase[ph].averageLoss}</td>
                    <td>{pctOrDash(profile.byPhase[ph].blunderRate)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="stats-grid">
              <BucketTableLoss title="本人の戦法別の精度" rows={profile.byOpening} />
              <BucketTableLoss title="相手の戦法別の精度" rows={profile.byOpponentOpening} />
            </div>
            <strong>痛かった手</strong>
            {profile.worstMoves.map((w) => (
              <div key={`${w.gameId}-${w.ply}`} className="worst">
                <div style={{ maxWidth: 220 }}>
                  <Board sfen={w.sfen} flipped={w.side === "white"} />
                </div>
                <div>
                  <div>
                    {w.startedAt?.slice(0, 10)} vs {w.opponent} · {w.ply}手目{" "}
                    <span className="mark">{JUDGEMENT_LABEL[w.judgement]}</span>
                  </div>
                  <div className="muted">
                    {PHASE_LABEL[w.phase]} · 指し手 {w.played}
                    {w.best ? ` · 最善 ${w.best}` : ""} · 勝率 -{Math.round(w.swing * 100)}%
                  </div>
                  <button
                    className="ghost"
                    style={{ marginTop: 6 }}
                    onClick={() => navigate({ kind: "game", id: w.gameId, ply: w.ply - 1 })}
                  >
                    局面を開く
                  </button>
                </div>
              </div>
            ))}
          </>
        )}
      </div>

      <div className="panel">
        <strong>分岐点</strong>
        <p className="muted">
          2 局以上で同じ手順をたどり、そこから先で分かれた局面。手数が深いほどよく指す形。
        </p>
        {stats.commonPositions.length === 0 && (
          <p className="muted">まだありません (同じ人の対局が 2 局以上必要)</p>
        )}
        {stats.commonPositions.slice(0, 8).map((p) => (
          <div key={p.key} className="branch">
            <div style={{ maxWidth: 260 }}>
              <Board
                sfen={p.key}
                flipped={
                  own.find((g) => g.id === p.gameIds[0])
                    ? playerSide(
                        own.find((g) => g.id === p.gameIds[0])!,
                        name,
                      ) === "white"
                    : false
                }
              />
            </div>
            <div>
              <div>
                {p.ply} 手目まで共通 · {p.gameIds.length} 局 · {name} の {p.wins} 勝
              </div>
              <div className="row" style={{ marginTop: 6 }}>
                {p.gameIds.map((id) => {
                  const g = own.find((x) => x.id === id);
                  return (
                    <button
                      key={id}
                      className="ghost"
                      onClick={() => navigate({ kind: "game", id, ply: p.ply })}
                    >
                      {g
                        ? `${formatDate(g.startedAt).slice(0, 10)} vs ${playerSide(g, name) === "black" ? g.white : g.black}`
                        : id}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        ))}
      </div>

      <div className="panel">
        <strong>対局一覧</strong>
        <ul className="games">
          {own.map((g) => (
            <li key={g.id} onClick={() => navigate({ kind: "game", id: g.id })}>
              <div className="game-title">
                <span className={g.result === "black" ? "win" : ""}>☗{g.black}</span>
                {" vs "}
                <span className={g.result === "white" ? "win" : ""}>☖{g.white}</span>
              </div>
              <div className="muted">
                {formatDate(g.startedAt)} · {describeGame(g)}
              </div>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
