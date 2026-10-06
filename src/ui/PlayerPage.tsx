import { useLiveQuery } from "dexie-react-hooks";
import { useMemo, useState } from "react";
import { JUDGEMENT_LABEL, PHASE_LABEL } from "../core/analysis";
import {
  buildPlayerProfile,
  type PlayerProfile,
  type RateBreakdown,
  type RateEvidence,
} from "../core/profile";
import { findRepeatedLines, straightFrom, trunkOf, type LineNode } from "../core/lines";
import {
  computePortfolio,
  matchesPortfolio,
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
import { ReportPanel } from "./Report";
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

/** 本人の対局のうち何割か (分母は呼び出し側で決める) */
function share(games: number, total: number): string {
  return pct(games, total);
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
 * 割合は `total` (本人の全対局数) に対する局数の割合。
 */
function BucketTable({
  title,
  rows,
  total,
  link,
}: {
  title: string;
  rows: Bucket[];
  total: number;
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
            <th>割合</th>
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
                <td>{share(r.games, total)}</td>
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

type RateKind = keyof RateBreakdown;

const RATES: Array<{
  kind: RateKind;
  field: "conversionRate" | "resilienceRate" | "punishRate" | "firstBlunderRate";
  label: string;
  /** 内訳の説明 (どの局面を指しているか) */
  note: string;
  hit: string;
  miss: string;
}> = [
  {
    kind: "conversion",
    field: "conversionRate",
    label: "有利 (+300) からの勝率",
    note: "評価値が初めて +300 以上になった局面",
    hit: "勝った",
    miss: "勝てなかった",
  },
  {
    kind: "resilience",
    field: "resilienceRate",
    label: "不利 (-300) から負けなかった率",
    note: "評価値が初めて -300 以下になった局面",
    hit: "負けなかった",
    miss: "負けた",
  },
  {
    kind: "punish",
    field: "punishRate",
    label: "相手の大悪手を咎めた率",
    note: "相手が大悪手 (対局で最も勝率を落とした手) を指した後の局面。最善は本人が指すべきだった手",
    hit: "咎めて勝った",
    miss: "勝てなかった",
  },
  {
    kind: "firstBlunder",
    field: "firstBlunderRate",
    label: "先に大悪手を指す率",
    note: "対局で最初の大悪手を指す前の局面",
    hit: "自分が先",
    miss: "相手が先",
  },
];

/** 4 つの率。タップするとその率の内訳 (数えた対局と根拠の局面) が下に開く */
function Rates({ profile }: { profile: PlayerProfile }) {
  const [open, setOpen] = useState<RateKind | null>(null);
  const current = RATES.find((r) => r.kind === open);
  return (
    <>
      <div className="rates">
        {RATES.map((r) => (
          <button
            key={r.kind}
            type="button"
            className={open === r.kind ? "active" : undefined}
            aria-expanded={open === r.kind}
            onClick={() => setOpen(open === r.kind ? null : r.kind)}
          >
            <strong>{pctOrDash(profile[r.field])}</strong>
            <span>{r.label}</span>
          </button>
        ))}
      </div>
      {current && (
        <div className="rate-breakdown">
          <div className="muted">
            {current.label} の内訳 · {profile.rates[current.kind].length} 局 · {current.note}
          </div>
          {profile.rates[current.kind].length === 0 && (
            <p className="muted">該当する対局はまだありません</p>
          )}
          {profile.rates[current.kind].map((e) => (
            <RateRow
              key={`${e.gameId}-${e.ply}`}
              e={e}
              label={e.hit ? current.hit : current.miss}
            />
          ))}
        </div>
      )}
    </>
  );
}

/** 内訳の 1 行。開いたときだけ盤面を出す */
function RateRow({ e, label }: { e: RateEvidence; label: string }) {
  const [shown, setShown] = useState(false);
  const signed = (cp: number) => (cp > 0 ? `+${cp}` : `${cp}`);
  return (
    <details className="rate-row" onToggle={(ev) => setShown(ev.currentTarget.open)}>
      <summary>
        {e.startedAt?.slice(0, 10)} vs {e.opponent} · {e.ply}手目{" "}
        <span className={e.hit ? "hit" : "mark"}>{label}</span>{" "}
        <span className="muted">{signed(e.cp)}</span>
      </summary>
      {shown && (
        <div className="detail-body">
          <div style={{ maxWidth: 220 }}>
            <Board sfen={e.sfen} flipped={e.side === "white"} />
          </div>
          <div>
            {e.played && (
              <div className="muted">
                {e.by === e.side ? "自分" : "相手"}の大悪手 {e.played}
                {e.best ? ` · 最善 ${e.best}` : ""}
              </div>
            )}
            <button
              className="ghost"
              style={{ marginTop: 6 }}
              onClick={() => navigate({ kind: "game", id: e.gameId, ply: e.ply })}
            >
              局面を開く
            </button>
          </div>
        </div>
      )}
    </details>
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
        <GameButtons gameIds={p.gameIds} ply={p.ply} byId={byId} name={name} />
      </div>
    </details>
  );
}

/** 対局へのボタン。押すとその対局の `ply` 手目へ飛ぶ */
function GameButtons({
  gameIds,
  ply,
  byId,
  name,
}: {
  gameIds: string[];
  ply: number;
  byId: Map<string, GameRecord>;
  name: string;
}) {
  return (
    <div className="row">
      {gameIds.map((id) => {
        const g = byId.get(id);
        return (
          <button key={id} className="ghost" onClick={() => navigate({ kind: "game", id, ply })}>
            {g
              ? `${formatDate(g.startedAt).slice(0, 10)} vs ${playerSide(g, name) === "black" ? g.white : g.black}`
              : id}
          </button>
        );
      })}
    </div>
  );
}

/**
 * 本人が繰り返している手順。分岐の無いところは手を 1 列に並べ (局数は変わったところに出す)、
 * 分かれるところでは分かれた先を局数の多い順に畳んで出す。手をタップすると盤面と対局へのボタンが出る。
 */
function RepeatedLines({
  root,
  byId,
  name,
  flipped,
}: {
  root: LineNode;
  byId: Map<string, GameRecord>;
  name: string;
  flipped: boolean;
}) {
  const trunk = trunkOf(root);
  const tip = trunk[trunk.length - 1];
  if (!tip) return null;
  return (
    <details className="lines">
      <summary>
        繰り返している手順 · 幹 {tip.ply} 手目まで {tip.gameIds.length} 局
      </summary>
      <p className="muted">
        2
        局以上が同じ手順をたどった手だけを出す。括弧はそこまで同じ手順だった局数。手をタップすると盤面が出る。
      </p>
      <LineFork nodes={root.children} byId={byId} name={name} flipped={flipped} />
    </details>
  );
}

function LineFork({
  nodes,
  byId,
  name,
  flipped,
}: {
  nodes: LineNode[];
  byId: Map<string, GameRecord>;
  name: string;
  flipped: boolean;
}) {
  if (nodes.length === 1)
    return <LineSegment node={nodes[0]!} byId={byId} name={name} flipped={flipped} />;
  return (
    <div className="line-fork">
      <div className="muted">分岐 · {nodes.length} 通り</div>
      {nodes.map((n) => (
        <details key={n.usi} className="line-branch">
          <summary>
            {n.label} ({n.gameIds.length} 局 · {n.wins} 勝)
          </summary>
          <LineSegment node={n} byId={byId} name={name} flipped={flipped} />
        </details>
      ))}
    </div>
  );
}

function LineSegment({
  node,
  byId,
  name,
  flipped,
}: {
  node: LineNode;
  byId: Map<string, GameRecord>;
  name: string;
  flipped: boolean;
}) {
  const [selected, setSelected] = useState<number | null>(null);
  const moves = straightFrom(node);
  const last = moves[moves.length - 1]!;
  const current = selected === null ? undefined : moves[selected];
  return (
    <div className="line">
      <div className="line-moves">
        {moves.map((m, i) => {
          const changed = i === 0 || m.gameIds.length !== moves[i - 1]!.gameIds.length;
          return (
            <button
              key={m.ply}
              type="button"
              className="line-move"
              aria-pressed={selected === i}
              title={`${m.ply} 手目 · ${m.gameIds.length} 局`}
              onClick={() => setSelected(selected === i ? null : i)}
            >
              {m.label}
              {changed && <span className="muted"> ({m.gameIds.length})</span>}
            </button>
          );
        })}
      </div>
      {current && (
        <div className="detail-body">
          <div style={{ maxWidth: 260 }}>
            <Board sfen={current.key} flipped={flipped} />
          </div>
          <div>
            <div className="muted">
              {current.ply} 手目 {current.label} · {current.gameIds.length} 局 · {name} の{" "}
              {current.wins} 勝
            </div>
            <GameButtons gameIds={current.gameIds} ply={current.ply} byId={byId} name={name} />
          </div>
        </div>
      )}
      {last.children.length > 0 && (
        <LineFork nodes={last.children} byId={byId} name={name} flipped={flipped} />
      )}
    </div>
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
  const sideTotal = (side: PortfolioGroup["side"]) =>
    groups.filter((g) => g.side === side).reduce((n, g) => n + g.games, 0);
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
            {group.losses} 敗 · 割合 {share(group.games, sideTotal(group.side))}
          </summary>
          {group.opponents.map((opp) => (
            <PortfolioOpponentBlock
              key={opp.vsOpening}
              cond={{ side: group.side, vsStyle: group.vsStyle, vsOpening: opp.vsOpening }}
              opp={opp}
              groupGames={group.games}
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
  groupGames,
  games,
  byId,
  name,
}: {
  cond: PortfolioCondition & { vsOpening: string };
  opp: PortfolioGroup["opponents"][number];
  /** 割合の分母 (同じ先後 × 相手の大分類の局数) */
  groupGames: number;
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
  const line = useMemo(
    () =>
      findRepeatedLines(
        games.filter((g) => matchesPortfolio(g, name, cond)),
        name,
      )[0],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [games, name, cond.side, cond.vsStyle, cond.vsOpening],
  );
  return (
    <div className="portfolio-opponent">
      <div className="muted">
        相手: {opp.vsOpening} · {opp.games} 局 {opp.wins} 勝 {opp.losses} 敗 · 割合{" "}
        {share(opp.games, groupGames)}
      </div>
      <table className="stats">
        <thead>
          <tr>
            <th>応手</th>
            <th>局</th>
            <th>勝</th>
            <th>敗</th>
            <th>勝率</th>
            <th>割合</th>
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
                <td>{share(r.games, opp.games)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {line && (
        <RepeatedLines root={line} byId={byId} name={name} flipped={cond.side === "white"} />
      )}
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
  const ownIds = useMemo(() => own.map((g) => g.id), [own]);
  // テーブルが無い古い DB や同期前でも undefined になるだけ
  const report = useLiveQuery(() => db.reports.get(name).catch(() => undefined), [name]);
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

      {report && <ReportPanel report={report} gameIds={ownIds} />}

      <div className="stats-grid">
        <BucketTable
          title="採用戦法"
          rows={stats.openings}
          total={stats.games}
          link={{ player: name, field: "opening" }}
        />
        <BucketTable
          title="囲い"
          rows={stats.castles}
          total={stats.games}
          link={{ player: name, field: "castle" }}
        />
        <BucketTable
          title="相手の戦法別"
          rows={stats.vsOpenings}
          total={stats.games}
          link={{ player: name, field: "vsOpening" }}
        />
        <BucketTable title="持ち時間別" rows={stats.timeControls} total={stats.games} />
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
            <Rates profile={profile} />
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
