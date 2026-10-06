import { useLiveQuery } from "dexie-react-hooks";
import { useMemo } from "react";
import { JUDGEMENT_LABEL, PHASE_LABEL } from "../core/analysis";
import { buildPlayerProfile } from "../core/profile";
import {
  computePortfolio,
  portfolioCommonPositions,
  type PortfolioCondition,
  type PortfolioGroup,
} from "../core/portfolio";
import {
  BRANCH_KIND_LABEL,
  describeBranchMove,
  groupBranchReviews,
  reviewBranches,
  type BranchMove,
  type BranchOpeningGroup,
  type BranchReview,
} from "../core/branches";
import { computeComboStats, type ComboBucket, type ComboStats } from "../core/combo";
import { computePlayerStats, playerSide, type Bucket, type CommonPosition } from "../core/stats";
import type { GameRecord } from "../core/types";
import { db } from "../db/db";
import { Board } from "./Board";
import { describeGame, formatDate, portfolioConditionLabel } from "./labels";
import { LossHelp } from "./LossHelp";
import {
  fieldQuery,
  hashFor,
  navigate,
  type GameFilterField,
  type ListQuery,
  type SideFilter,
} from "./router";

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

/**
 * 戦法・囲いの集計表。`link` を渡すと各行が、その対局者のその戦法・囲いの対局一覧へのリンクになる。
 */
function BucketTable({
  title,
  rows,
  link,
}: {
  title: string;
  rows: Bucket[];
  link?: { player: string; field: GameFilterField };
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
            <th>敗</th>
            <th>勝率</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const route = link
              ? { kind: "list" as const, query: fieldQuery(link.player, link.field, r.name) }
              : undefined;
            return (
              <tr
                key={r.name}
                className={route ? "link" : undefined}
                onClick={route ? () => navigate(route) : undefined}
              >
                <td>{route ? <a href={hashFor(route)}>{r.name}</a> : r.name}</td>
                <td>{r.games}</td>
                <td>{r.wins}</td>
                <td>{r.losses}</td>
                <td>{pct(r.wins, r.wins + r.losses)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/** これより局数が少ない行は勝率を薄く出す (母数が小さいので) */
const FEW_GAMES = 3;

interface ComboRow extends Bucket {
  averageLoss?: number | null;
  query?: ListQuery;
}

/**
 * 組み合わせ分析の 1 表。初期は畳んで見出しだけ出す。`query` のある行は絞り込み済みの一覧へのリンク。
 * `highlightLosing` なら負け越している行を目立たせる。
 */
function ComboTable({
  title,
  summary,
  rows,
  showLoss,
  highlightLosing,
}: {
  title: string;
  summary?: string;
  rows: ComboRow[];
  showLoss?: boolean;
  highlightLosing?: boolean;
}) {
  if (rows.length === 0) return null;
  return (
    <details className="combo">
      <summary>
        {title} <span className="muted">· {summary ?? `${rows.length} 通り`}</span>
      </summary>
      <table className="stats">
        <thead>
          <tr>
            <th></th>
            <th>局</th>
            <th>勝</th>
            <th>敗</th>
            <th>勝率</th>
            {showLoss && <th>平均損失</th>}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const route = r.query ? { kind: "list" as const, query: r.query } : undefined;
            const classes = [
              route ? "link" : "",
              highlightLosing && r.losses > r.wins ? "losing" : "",
            ].filter(Boolean);
            return (
              <tr
                key={r.name}
                className={classes.length ? classes.join(" ") : undefined}
                onClick={route ? () => navigate(route) : undefined}
              >
                <td>{route ? <a href={hashFor(route)}>{r.name}</a> : r.name}</td>
                <td>{r.games}</td>
                <td>{r.wins}</td>
                <td>{r.losses}</td>
                <td className={r.games < FEW_GAMES ? "muted" : undefined}>
                  {pct(r.wins, r.wins + r.losses)}
                </td>
                {showLoss && <td>{r.averageLoss ?? "-"}</td>}
              </tr>
            );
          })}
        </tbody>
      </table>
    </details>
  );
}

function comboQuery(
  player: string,
  opening: string | undefined,
  castle: string,
  castleSide: SideFilter,
): ListQuery {
  const q: ListQuery = { player, castle, castleSide };
  if (opening) {
    q.opening = opening;
    q.openingSide = "self";
  }
  return q;
}

/** 戦法 × 囲いの組み合わせ分析。表は 4 つで、どれも畳んである */
function ComboAnalysis({ combo, name }: { combo: ComboStats; name: string }) {
  const withQuery = (rows: ComboBucket[], castleSide: SideFilter): ComboRow[] =>
    rows.map((r) => ({ ...r, query: comboQuery(name, r.first, r.second, castleSide) }));
  const losing = combo.vsCastles.filter((r) => r.losses > r.wins).length;
  return (
    <div className="panel">
      <strong>戦法 × 囲い</strong>
      <p className="muted">
        戦法と囲いの組み合わせごとの成績。勝率が薄い行は {FEW_GAMES} 局未満なので局数を見る。
      </p>
      <ComboTable
        title="自分の戦法 × 囲い"
        rows={withQuery(combo.openingCastle, "self")}
        showLoss
      />
      <ComboTable
        title="攻め開始時の囲い"
        summary="最初の駒交換の直前に囲いが完成していたか"
        rows={combo.maturity}
      />
      <ComboTable
        title="自分の戦法 × 相手の囲い"
        rows={withQuery(combo.openingVsCastle, "opponent")}
      />
      <ComboTable
        title="相手の囲い別"
        summary={`${combo.vsCastles.length} 種${losing ? ` · 負け越し ${losing}` : ""}`}
        rows={combo.vsCastles.map((r) => ({
          ...r,
          query: comboQuery(name, undefined, r.name, "opponent"),
        }))}
        highlightLosing
      />
    </div>
  );
}

/** 分岐点の 1 グループに出す局面の数 */
const BRANCHES_PER_GROUP = 3;

/**
 * 戦法ごとのグループで、上限 BRANCHES_PER_GROUP 件を分類の順 (悪手を指した分岐が先) に割り振る。
 * 上限を超えた分は分類ごとに「他 n 件」に畳む。
 */
function BranchOpeningBlock({
  group,
  byId,
  name,
}: {
  group: BranchOpeningGroup;
  byId: Map<string, GameRecord>;
  name: string;
}) {
  const kinds: Array<BranchOpeningGroup["kinds"][number] & { shown: number }> = [];
  let budget = BRANCHES_PER_GROUP;
  for (const k of group.kinds) {
    const shown = Math.min(budget, k.positions.length);
    kinds.push({ ...k, shown });
    budget -= shown;
  }
  const flippedOf = (p: BranchReview) => {
    const first = byId.get(p.gameIds[0] ?? "");
    return first ? playerSide(first, name) === "white" : false;
  };
  return (
    <div className="branch-group">
      <div>
        {group.opening} <span className="muted">· {group.total} 局面</span>
      </div>
      {kinds.map(({ kind, positions, shown: n }) => {
        const shown = positions.slice(0, n);
        const rest = positions.slice(n);
        return (
          <div key={kind} className={`branch-kind ${kind}`}>
            <div className="muted">
              {BRANCH_KIND_LABEL[kind]} ({positions.length})
            </div>
            {shown.map((p) => (
              <BranchDetails
                key={p.key}
                p={{ ...p, flipped: flippedOf(p) }}
                byId={byId}
                name={name}
                moves={p.moves}
              />
            ))}
            {rest.length > 0 && (
              <details className="branch-more">
                <summary>他 {rest.length} 件</summary>
                {rest.map((p) => (
                  <BranchDetails
                    key={p.key}
                    p={{ ...p, flipped: flippedOf(p) }}
                    byId={byId}
                    name={name}
                    moves={p.moves}
                  />
                ))}
              </details>
            )}
          </div>
        );
      })}
    </div>
  );
}

/** 分岐点 1 件。開くと盤面と、その局面を通った対局へのボタンが出る */
function BranchDetails({
  p,
  byId,
  name,
  moves,
}: {
  p: CommonPosition & { flipped: boolean };
  byId: Map<string, GameRecord>;
  name: string;
  /** 本人の手番の分岐点なら、本人が指した手の集計 */
  moves?: BranchMove[];
}) {
  return (
    <details className="branch">
      <summary>
        {p.ply} 手目まで共通 · {p.gameIds.length} 局 · {name} の {p.wins} 勝
        {moves && moves.length > 0 && (
          <span className="muted branch-moves">
            本人の手: {moves.map(describeBranchMove).join(" / ")}
          </span>
        )}
      </summary>
      <div className="detail-body">
        <div style={{ maxWidth: 260 }}>
          <Board sfen={p.key} flipped={p.flipped} />
        </div>
        <div className="row">
          {p.gameIds.map((id) => {
            const g = byId.get(id);
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
    </details>
  );
}

/**
 * 戦型ポートフォリオ。条件 (本人の先後 × 相手の大分類) ごとに畳み、開くと相手の戦法名ごとに
 * 本人の応手 (戦法 + 囲い) と、その条件下の分岐点が出る。
 */
function Portfolio({
  groups,
  games,
  byId,
  name,
}: {
  groups: PortfolioGroup[];
  games: GameRecord[];
  byId: Map<string, GameRecord>;
  name: string;
}) {
  return (
    <div className="panel">
      <strong>戦型ポートフォリオ</strong>
      <p className="muted">
        先後と相手の戦型ごとに、どう応じたか。局数の少ない行は勝率より局数を見る。
      </p>
      {groups.map((group) => (
        <details key={`${group.side}/${group.vsStyle}`} className="portfolio">
          <summary>
            {portfolioConditionLabel(group.side, group.vsStyle)} · {group.games} 局 {group.wins} 勝{" "}
            {group.losses} 敗
          </summary>
          {group.opponents.map((opp) => (
            <PortfolioOpponentBlock
              key={opp.vsOpening}
              cond={{ side: group.side, vsStyle: group.vsStyle, vsOpening: opp.vsOpening }}
              opp={opp}
              games={games}
              byId={byId}
              name={name}
            />
          ))}
        </details>
      ))}
    </div>
  );
}

function PortfolioOpponentBlock({
  cond,
  opp,
  games,
  byId,
  name,
}: {
  cond: PortfolioCondition & { vsOpening: string };
  opp: PortfolioGroup["opponents"][number];
  games: GameRecord[];
  byId: Map<string, GameRecord>;
  name: string;
}) {
  const branches = useMemo(
    () =>
      portfolioCommonPositions(games, name, cond).map((p) => ({
        ...p,
        flipped: cond.side === "white",
      })),
    // cond はレンダーごとに作り直されるので中身で比べる
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [games, name, cond.side, cond.vsStyle, cond.vsOpening],
  );
  return (
    <div className="portfolio-opponent">
      <div className="muted">
        相手: {opp.vsOpening} · {opp.games} 局 {opp.wins} 勝 {opp.losses} 敗
      </div>
      <table className="stats">
        <thead>
          <tr>
            <th>応手</th>
            <th>局</th>
            <th>勝</th>
            <th>敗</th>
            <th>勝率</th>
          </tr>
        </thead>
        <tbody>
          {opp.responses.map((r) => {
            const route = {
              kind: "list" as const,
              portfolio: {
                player: name,
                condition: { ...cond, opening: r.opening, castle: r.castle },
              },
            };
            const label = `${r.opening} + ${r.castle}`;
            return (
              <tr key={label} className="link" onClick={() => navigate(route)}>
                <td>
                  <a href={hashFor(route)}>{label}</a>
                </td>
                <td>{r.games}</td>
                <td>{r.wins}</td>
                <td>{r.losses}</td>
                <td>{pct(r.wins, r.wins + r.losses)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {branches.length > 0 && (
        <div className="branch-group">
          <div className="muted">
            この条件での分岐点 · {branches.length} 局面
            {branches.length > BRANCHES_PER_GROUP ? ` (上位 ${BRANCHES_PER_GROUP} 件)` : ""}
          </div>
          {branches.slice(0, BRANCHES_PER_GROUP).map((p) => (
            <BranchDetails key={p.key} p={p} byId={byId} name={name} />
          ))}
        </div>
      )}
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
  const byId = useMemo(() => new Map(own.map((g) => [g.id, g] as const)), [own]);
  const combo = useMemo(() => {
    const map = new Map((analyses ?? []).map((a) => [a.id, a] as const));
    return computeComboStats(own, name, map);
  }, [own, analyses, name]);
  const portfolio = useMemo(() => computePortfolio(own, name), [own, name]);
  const branchGroups = useMemo(() => {
    if (!stats || !analyses) return [];
    const map = new Map(analyses.map((a) => [a.id, a] as const));
    return groupBranchReviews(reviewBranches(stats.commonPositions, own, map, name));
  }, [stats, analyses, own, name]);

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
        <BucketTable
          title="採用戦法"
          rows={stats.openings}
          link={{ player: name, field: "opening" }}
        />
        <BucketTable title="囲い" rows={stats.castles} link={{ player: name, field: "castle" }} />
        <BucketTable
          title="相手の戦法別"
          rows={stats.vsOpenings}
          link={{ player: name, field: "vsOpening" }}
        />
        <BucketTable title="持ち時間別" rows={stats.timeControls} />
      </div>

      <ComboAnalysis combo={combo} name={name} />

      <Portfolio groups={portfolio} games={own} byId={byId} name={name} />

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
            <LossHelp />
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
              <details key={`${w.gameId}-${w.ply}`} className="worst">
                <summary>
                  {w.startedAt?.slice(0, 10)} vs {w.opponent} · {w.ply}手目{" "}
                  <span className="mark">{JUDGEMENT_LABEL[w.judgement]}</span>{" "}
                  <span className="muted">勝率 -{Math.round(w.swing * 100)}%</span>
                </summary>
                <div className="detail-body">
                  <div style={{ maxWidth: 220 }}>
                    <Board sfen={w.sfen} flipped={w.side === "white"} />
                  </div>
                  <div>
                    <div className="muted">
                      {PHASE_LABEL[w.phase]} · 指し手 {w.played}
                      {w.best ? ` · 最善 ${w.best}` : ""}
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
              </details>
            ))}
          </>
        )}
      </div>

      <div className="panel">
        <strong>分岐点</strong>
        <p className="muted">
          2 局以上で同じ手順をたどり、そこから先で分かれた局面。手数が深いほどよく指す形。
          本人の戦法ごとに、分岐点で本人が指した手のエンジン判定で分ける。
        </p>
        {stats.commonPositions.length === 0 && (
          <p className="muted">まだありません (同じ人の対局が 2 局以上必要)</p>
        )}
        {branchGroups.map((group) => (
          <BranchOpeningBlock key={group.opening} group={group} byId={byId} name={name} />
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
