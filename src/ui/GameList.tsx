import { useLiveQuery } from "dexie-react-hooks";
import { useMemo, type ReactNode } from "react";
import { db } from "../db/db";
import type { GameShape, GameSummary } from "../core/types";
import { GAME_SHAPE_LABEL } from "../core/opening";
import { SERVICE_LABEL, serviceOf } from "../core/source";
import { listPlayers } from "../core/stats";
import {
  castleValues,
  countValues,
  describeGame,
  describePortfolio,
  formatDate,
  matchesListRoute,
  openingValues,
} from "./labels";
import {
  compactQuery,
  navigate,
  type ListQuery,
  type PortfolioFilter,
  type ResultFilter,
  type SideFilter,
} from "./router";

const SIDE_FILTER_LABEL: Record<SideFilter, string> = {
  black: "先手",
  white: "後手",
  self: "本人",
  opponent: "相手",
};

const RESULT_FILTER_LABEL: Record<ResultFilter, string> = {
  black: "先手勝ち",
  white: "後手勝ち",
  other: "引き分け・不明",
  win: "勝ち",
  loss: "負け",
};

const SERVICES = ["wars", "quest"] as const;
const NO_QUERY: ListQuery = {};

/** 対局者を指定していないときは本人 / 相手、勝ち / 負けを出さない (効かない) */
function sideOptions(player: string | undefined): SideFilter[] {
  return player ? ["black", "white", "self", "opponent"] : ["black", "white"];
}

function resultOptions(player: string | undefined): ResultFilter[] {
  return player ? ["black", "white", "other", "win", "loss"] : ["black", "white", "other"];
}

/** 効いている条件を短く並べる (絞り込み欄の見出し用) */
function describeQuery(q: ListQuery): string[] {
  const parts: string[] = [];
  const side = (s: SideFilter | undefined) =>
    s && (q.player || (s !== "self" && s !== "opponent")) ? `(${SIDE_FILTER_LABEL[s]})` : "";
  if (q.player) parts.push(q.player);
  if (q.service) parts.push(SERVICE_LABEL[q.service]);
  if (q.shape) parts.push(GAME_SHAPE_LABEL[q.shape]);
  if (q.opening) parts.push(`${q.opening}${side(q.openingSide)}`);
  if (q.castle) parts.push(`${q.castle}${side(q.castleSide)}`);
  if (q.result && (q.player || (q.result !== "win" && q.result !== "loss")))
    parts.push(RESULT_FILTER_LABEL[q.result]);
  return parts;
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="field">
      <label>{label}</label>
      <div className="row">{children}</div>
    </div>
  );
}

export function GameList({
  query = NO_QUERY,
  portfolio,
}: {
  query?: ListQuery;
  portfolio?: PortfolioFilter;
}) {
  const games = useLiveQuery(() => db.games.orderBy("startedAt").reverse().toArray(), []);

  const filtered = useMemo(
    () => (games ?? []).filter((g) => matchesListRoute(g, query, portfolio)),
    [games, query, portfolio],
  );
  /** その項目以外の条件で絞った対局 (選択肢の局数に使う) */
  const without = (key: keyof ListQuery): GameSummary[] =>
    (games ?? []).filter((g) => matchesListRoute(g, { ...query, [key]: undefined }, portfolio));
  const players = useMemo(() => listPlayers(games ?? []), [games]);

  if (!games) return <p className="muted">読み込み中…</p>;

  const update = (patch: Partial<ListQuery>) => {
    const next = { ...query, ...patch };
    if (!next.player) {
      // 本人 / 相手、勝ち / 負けは対局者なしでは効かないので落とす
      if (next.openingSide === "self" || next.openingSide === "opponent")
        next.openingSide = undefined;
      if (next.castleSide === "self" || next.castleSide === "opponent") next.castleSide = undefined;
      if (next.result === "win" || next.result === "loss") next.result = undefined;
    }
    navigate({ kind: "list", query: compactQuery(next), portfolio });
  };
  const openings = countValues(without("opening"), (g) => openingValues(g, query));
  const castles = countValues(without("castle"), (g) => castleValues(g, query));
  const withCurrent = (opts: Array<{ value: string; games: number }>, v?: string) =>
    v && !opts.some((o) => o.value === v) ? [...opts, { value: v, games: 0 }] : opts;
  const active = describeQuery(query);
  const back = portfolio?.player ?? query.player;
  const hasCondition = active.length > 0 || !!portfolio;

  return (
    <section>
      {(portfolio || back) && (
        <div className="panel row">
          {back && (
            <button className="ghost" onClick={() => navigate({ kind: "player", name: back })}>
              ← {back}
            </button>
          )}
          {portfolio && (
            <span>
              {describePortfolio(portfolio).label}:{" "}
              <strong>{describePortfolio(portfolio).value}</strong>
            </span>
          )}
        </div>
      )}
      <details className="panel filters">
        <summary>
          絞り込み
          {active.length > 0 && <span className="muted"> · {active.join(" · ")}</span>}
        </summary>
        <Field label="対局者">
          <select
            aria-label="対局者"
            value={query.player ?? ""}
            onChange={(e) => update({ player: e.target.value || undefined })}
          >
            <option value="">すべて</option>
            {query.player && !players.some((p) => p.name === query.player) && (
              <option value={query.player}>{query.player}</option>
            )}
            {players.map((p) => (
              <option key={p.name} value={p.name}>
                {p.name} ({p.games})
              </option>
            ))}
          </select>
          <select
            aria-label="出典の絞り込み"
            value={query.service ?? ""}
            onChange={(e) =>
              update({ service: (e.target.value || undefined) as ListQuery["service"] })
            }
          >
            <option value="">出典すべて</option>
            {SERVICES.map((s) => (
              <option key={s} value={s}>
                {SERVICE_LABEL[s]}
              </option>
            ))}
          </select>
        </Field>
        <Field label="戦型">
          <select
            aria-label="戦型"
            value={query.shape ?? ""}
            onChange={(e) => update({ shape: (e.target.value || undefined) as GameShape })}
          >
            <option value="">戦型すべて</option>
            {(Object.keys(GAME_SHAPE_LABEL) as GameShape[]).map((s) => (
              <option key={s} value={s}>
                {GAME_SHAPE_LABEL[s]}
              </option>
            ))}
          </select>
        </Field>
        <Field label="戦法">
          <select
            aria-label="戦法"
            value={query.opening ?? ""}
            onChange={(e) => update({ opening: e.target.value || undefined })}
          >
            <option value="">すべて</option>
            {withCurrent(openings, query.opening).map((o) => (
              <option key={o.value} value={o.value}>
                {o.value} ({o.games})
              </option>
            ))}
          </select>
          <select
            aria-label="戦法の側"
            value={query.openingSide ?? ""}
            onChange={(e) => update({ openingSide: (e.target.value || undefined) as SideFilter })}
          >
            <option value="">どちらでも</option>
            {sideOptions(query.player).map((s) => (
              <option key={s} value={s}>
                {SIDE_FILTER_LABEL[s]}
              </option>
            ))}
          </select>
        </Field>
        <Field label="囲い">
          <select
            aria-label="囲い"
            value={query.castle ?? ""}
            onChange={(e) => update({ castle: e.target.value || undefined })}
          >
            <option value="">すべて</option>
            {withCurrent(castles, query.castle).map((o) => (
              <option key={o.value} value={o.value}>
                {o.value} ({o.games})
              </option>
            ))}
          </select>
          <select
            aria-label="囲いの側"
            value={query.castleSide ?? ""}
            onChange={(e) => update({ castleSide: (e.target.value || undefined) as SideFilter })}
          >
            <option value="">どちらでも</option>
            {sideOptions(query.player).map((s) => (
              <option key={s} value={s}>
                {SIDE_FILTER_LABEL[s]}
              </option>
            ))}
          </select>
        </Field>
        <Field label="勝敗">
          <select
            aria-label="勝敗"
            value={query.result ?? ""}
            onChange={(e) => update({ result: (e.target.value || undefined) as ResultFilter })}
          >
            <option value="">すべて</option>
            {resultOptions(query.player).map((r) => (
              <option key={r} value={r}>
                {RESULT_FILTER_LABEL[r]}
              </option>
            ))}
          </select>
        </Field>
      </details>
      <div className="panel row">
        <span className="muted">
          {filtered.length} / {games.length} 局
        </span>
        {hasCondition && (
          <button className="ghost" onClick={() => navigate({ kind: "list" })}>
            条件をすべて消す
          </button>
        )}
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
