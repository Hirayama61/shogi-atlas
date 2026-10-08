import { useLiveQuery } from "dexie-react-hooks";
import { useMemo } from "react";
import type { BranchCandidate } from "../core/branchStudy";
import { plyOf } from "../core/branchStudy";
import {
  compareCounters,
  compareOpenings,
  comparePlayers,
  groupByOpening,
  type BranchKind,
  type CompareBranch,
  type Comparison,
  type CounterComparison,
} from "../core/compare";
import type { CounterBucket } from "../core/styles";
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

const KIND_TAG: Record<BranchKind, { label: string; tone: string }> = {
  differs: { label: "違う", tone: "mistake" },
  merged: { label: "合流", tone: "" },
  same: { label: "一致", tone: "correct" },
};

function labels(moves: BranchCandidate[]): string {
  return moves.map((m) => m.label).join("・");
}

/** 分岐 1 件。見出しは戦法名と両者の手、手数と先後は補足 */
function BranchItem({
  p,
  route,
  byId,
  showKind,
}: {
  p: CompareBranch;
  route: CompareRoute;
  byId: Map<string, GameRecord>;
  showKind: boolean;
}) {
  const tag = KIND_TAG[p.kind];
  return (
    <details className="worst compare-item">
      <summary>
        {showKind && (
          <>
            <span className={`branch-tag ${tag.tone}`}>{tag.label}</span>{" "}
          </>
        )}
        <b>
          {p.opening} · {p.ply} 手目 {route.name} {labels(p.self.moves)} / {route.other}{" "}
          {labels(p.other.moves)}
        </b>{" "}
        <span className="muted">({SIDE_LABEL[p.side]})</span>
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

function pct(wins: number, losses: number): string {
  const n = wins + losses;
  return n ? `${Math.round((wins / n) * 100)}%` : "-";
}

function Counter({ buckets }: { buckets: CounterBucket[] }) {
  return (
    <>
      {buckets.map((b) => (
        <div key={b.name}>
          {b.name}{" "}
          <span className="muted">
            {b.games} 局 · 勝率 {pct(b.wins, b.losses)}
          </span>
        </div>
      ))}
    </>
  );
}

/** 相手の戦法ごとの 2 人の応手。対策そのものが違う戦法には印を付ける */
function CounterTable({ rows, route }: { rows: CounterComparison[]; route: CompareRoute }) {
  return (
    <div className="panel">
      <h3 style={{ fontSize: 14, margin: "0 0 4px" }}>相手の戦法ごとの応手</h3>
      {rows.length === 0 ? (
        <p className="muted">2 人とも当たったことのある相手の戦法がありません</p>
      ) : (
        <div style={{ overflowX: "auto" }}>
          <table className="stats">
            <thead>
              <tr>
                <th>相手の戦法</th>
                <th>{route.name}</th>
                <th>{route.other}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.vsOpening}>
                  <td>
                    {r.vsOpening}
                    {r.differs && (
                      <>
                        {" "}
                        <span className="branch-tag mistake">対策が違う</span>
                      </>
                    )}
                  </td>
                  <td>
                    <Counter buckets={r.self} />
                  </td>
                  <td>
                    <Counter buckets={r.other} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
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
 * 参考の対局者と比べる画面。先頭に相手の戦法ごとの 2 人の応手 (対策の違い) を並べ、
 * その下に共通局面で手が分かれた分岐を本人の戦法ごとに手数の早い順で出す。
 * 一致の局面と数手以内に合流する分岐は既定で隠して件数だけ出す。
 */
export function ComparePage({ route }: { route: CompareRoute }) {
  const { name, other, opening, all } = route;
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
  const groups = useMemo(
    () => (comparison && games ? groupByOpening(comparison, games, name, other) : []),
    [comparison, games, name, other],
  );
  const counters = useMemo(
    () => (games ? compareCounters(games, name, other, opening ? { opening } : {}) : []),
    [games, name, other, opening],
  );
  useRestoreView(!!comparison);

  const back = () => goBackTo(hashFor({ kind: "player", name }));
  const update = (patch: Partial<CompareRoute>) => {
    const next: CompareRoute = { kind: "compare", name, other };
    const merged = { opening, all, ...patch };
    if (merged.opening) next.opening = merged.opening;
    if (merged.all) next.all = true;
    navigate(next);
  };

  if (!comparison) return <p className="muted">読み込み中…</p>;
  const count = (kind: BranchKind) =>
    groups.reduce((n, g) => n + g.branches.filter((b) => b.kind === kind).length, 0);
  const shownGroups = groups
    .map((g) => ({
      ...g,
      branches: all ? g.branches : g.branches.filter((b) => b.kind === "differs"),
    }))
    .filter((g) => g.branches.length > 0);

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
        相手の戦法にどう応じているか、同じ戦法の中でどこから違う手を指しているか。
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
            checked={!!all}
            onChange={(e) => update({ all: e.target.checked })}
          />{" "}
          一致と合流する分岐も出す
        </label>
      </div>
      <CounterTable rows={counters} route={route} />
      {comparison.positions.length === 0 ? (
        <div className="panel">
          <p className="muted">共通の局面がありません。{emptyReason(comparison, route)}</p>
        </div>
      ) : (
        <div className="panel">
          <div className="muted">
            分岐 {count("differs")} 件 · 一致 {count("same")} 件 · 数手以内に合流 {count("merged")}{" "}
            件
          </div>
          {shownGroups.length === 0 ? (
            <p className="muted">手が分かれたまま進む分岐はありません</p>
          ) : (
            shownGroups.map((g) => (
              <div key={g.opening} className="compare-group">
                <h3 style={{ fontSize: 14, margin: "8px 0 4px" }}>{g.opening}</h3>
                {g.branches.map((p) => (
                  <BranchItem
                    key={`${p.side}|${p.key}`}
                    p={p}
                    route={route}
                    byId={byId}
                    showKind={!!all}
                  />
                ))}
              </div>
            ))
          )}
        </div>
      )}
    </section>
  );
}
