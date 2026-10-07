import { useLiveQuery } from "dexie-react-hooks";
import { useMemo } from "react";
import type { BranchCandidate } from "../core/branchStudy";
import { plyOf } from "../core/branchStudy";
import {
  compareOpenings,
  comparePlayers,
  type ComparePosition,
  type Comparison,
} from "../core/compare";
import { COMMON_POSITION_PLIES, playerSide } from "../core/stats";
import type { GameRecord } from "../core/types";
import { db } from "../db/db";
import { Board } from "./Board";
import { describeCandidate, formatDate, judgementTone, SIDE_LABEL } from "./labels";
import { hashFor, navigate, type Route } from "./router";
import { goBackTo, useRestoreView } from "./viewState";

type CompareRoute = Extract<Route, { kind: "compare" }>;

function Moves({ moves }: { moves: BranchCandidate[] }) {
  return (
    <>
      {moves.map((m, i) => (
        <span key={m.usi} className={`candidate-text ${judgementTone(m.judgement)}`}>
          {i > 0 ? " / " : ""}
          {m.label}
          {m.count > 1 ? ` ×${m.count}` : ""} ({describeCandidate(m)})
        </span>
      ))}
    </>
  );
}

/** 対局へのボタン。対局ごとにその局面になった手数へ飛ぶ */
function GameLinks({
  gameIds,
  positionKey,
  byId,
  name,
}: {
  gameIds: string[];
  positionKey: string;
  byId: Map<string, GameRecord>;
  name: string;
}) {
  return (
    <div className="row">
      {gameIds.map((id) => {
        const g = byId.get(id);
        if (!g) return null;
        const ply = plyOf(g, positionKey);
        return (
          <button
            key={id}
            className="ghost"
            onClick={() => navigate({ kind: "game", id, ply: Math.max(0, ply) })}
          >
            {formatDate(g.startedAt).slice(0, 10)} vs{" "}
            {playerSide(g, name) === "black" ? g.white : g.black}
          </button>
        );
      })}
    </div>
  );
}

function PositionItem({
  p,
  route,
  byId,
}: {
  p: ComparePosition;
  route: CompareRoute;
  byId: Map<string, GameRecord>;
}) {
  return (
    <details className="worst compare-item">
      <summary>
        <span className={`branch-tag ${p.differs ? "mistake" : "correct"}`}>
          {p.differs ? "違う" : "一致"}
        </span>{" "}
        {p.ply} 手目 · {SIDE_LABEL[p.side]}
        <span className="branch-moves">
          {route.name}: <Moves moves={p.self.moves} />
        </span>
        <span className="branch-moves">
          {route.other}: <Moves moves={p.other.moves} />
        </span>
      </summary>
      <div className="detail-body">
        <div style={{ maxWidth: 240, width: "100%" }}>
          <Board
            sfen={`${p.key} ${p.ply + 1}`}
            flipped={p.side === "white"}
            marks={p.self.moves.map((m) => ({ usi: m.usi, tone: judgementTone(m.judgement) }))}
          />
        </div>
        <div>
          <div className="muted">{route.name} の対局</div>
          <GameLinks gameIds={p.self.gameIds} positionKey={p.key} byId={byId} name={route.name} />
          <div className="muted" style={{ marginTop: 6 }}>
            {route.other} の対局
          </div>
          <GameLinks gameIds={p.other.gameIds} positionKey={p.key} byId={byId} name={route.other} />
        </div>
      </div>
    </details>
  );
}

/** 共通局面が無いときの理由 */
function emptyReason(c: Comparison, route: CompareRoute): string {
  const total = (who: "self" | "other") => c.games.black[who] + c.games.white[who];
  if (total("self") === 0) return `${route.name} の対局がありません`;
  if (total("other") === 0) return `${route.other} の対局がありません`;
  const sameSide = (["black", "white"] as const).some(
    (s) => c.games[s].self > 0 && c.games[s].other > 0,
  );
  if (!sameSide) {
    const by = (who: "self" | "other") =>
      `先手 ${c.games.black[who]} 局 / 後手 ${c.games.white[who]} 局`;
    return `同じ先後で指した対局がありません (${route.name}: ${by("self")}、${route.other}: ${by("other")})`;
  }
  return `同じ先後の対局はありますが、6〜${COMMON_POSITION_PLIES} 手目で同じ局面を通っていません (戦法や手順が違うなど)`;
}

/**
 * 参考の対局者と同じ局面で何を指したかを比べる画面。
 * 共通局面を手数の早い順に並べ、2 人の手の分布と判定、盤面、各自の対局へのボタンを出す。
 */
export function ComparePage({ route }: { route: CompareRoute }) {
  const { name, other, opening, diffOnly } = route;
  const games = useLiveQuery(() => db.games.toArray(), []);
  const analyses = useLiveQuery(() => db.analyses.toArray(), []);
  const byId = useMemo(() => new Map((games ?? []).map((g) => [g.id, g] as const)), [games]);
  const openings = useMemo(
    () => (games ? compareOpenings(games, name, other) : []),
    [games, name, other],
  );
  const comparison = useMemo(() => {
    if (!games || !analyses) return null;
    const map = new Map(analyses.map((a) => [a.id, a] as const));
    return comparePlayers(games, map, name, other, opening ? { opening } : {});
  }, [games, analyses, name, other, opening]);
  useRestoreView(!!comparison);

  const back = () => goBackTo(hashFor({ kind: "player", name }));
  const update = (patch: Partial<CompareRoute>) => {
    const next: CompareRoute = { kind: "compare", name, other };
    const merged = { opening, diffOnly, ...patch };
    if (merged.opening) next.opening = merged.opening;
    if (merged.diffOnly) next.diffOnly = true;
    navigate(next);
  };

  if (!comparison) return <p className="muted">読み込み中…</p>;
  const shown = diffOnly ? comparison.positions.filter((p) => p.differs) : comparison.positions;
  const differs = comparison.positions.filter((p) => p.differs).length;

  return (
    <section>
      <div className="row" style={{ marginBottom: 8 }}>
        <button className="ghost" onClick={back}>
          ← 戻る
        </button>
      </div>
      <h2 style={{ fontSize: 16, margin: "4px 0" }}>
        {name} と {other} の比較
      </h2>
      <p className="muted" style={{ margin: "4px 0" }}>
        2 人が同じ先後で通った局面で、それぞれ何を指したか。
      </p>
      <div className="row" style={{ gap: 12, flexWrap: "wrap" }}>
        <label>
          戦法{" "}
          <select
            aria-label="戦法"
            value={opening ?? ""}
            onChange={(e) => update({ opening: e.target.value || undefined })}
          >
            <option value="">すべて</option>
            {opening && !openings.includes(opening) && <option value={opening}>{opening}</option>}
            {openings.map((o) => (
              <option key={o} value={o}>
                {o}
              </option>
            ))}
          </select>
        </label>
        <label>
          <input
            type="checkbox"
            checked={!!diffOnly}
            onChange={(e) => update({ diffOnly: e.target.checked })}
          />{" "}
          手が違う局面だけ
        </label>
      </div>
      {comparison.positions.length === 0 ? (
        <div className="panel">
          <p className="muted">共通の局面がありません。{emptyReason(comparison, route)}</p>
        </div>
      ) : (
        <div className="panel">
          <div className="muted">
            共通局面 {comparison.positions.length} 件 · 手が違う局面 {differs} 件
          </div>
          {shown.length === 0 ? (
            <p className="muted">手が違う局面はありません</p>
          ) : (
            shown.map((p) => (
              <PositionItem key={`${p.side}|${p.key}`} p={p} route={route} byId={byId} />
            ))
          )}
        </div>
      )}
    </section>
  );
}
