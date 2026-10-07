// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { USI_ANAGUMA_VS_SHIKEN, USI_SHIKEN_VS_FUNA, WARS_KIF } from "../core/__tests__/fixtures";
import { parseKifu } from "../core/parse";
import { computePlayerStats } from "../core/stats";
import { db, setSelfIds } from "../db/db";
import { GameList } from "./GameList";
import { GameViewer } from "./GameViewer";
import { PlayerList } from "./PlayerList";
import { PlayerPage } from "./PlayerPage";
import { ShareCard } from "./ShareCard";

const source = { kind: "paste" as const };
const IDS = ["me_wars", "me_quest"];

/** 自分の 2 ID の対局 2 局と、登録した相手 (rival) と自分の対局 1 局 */
async function seed() {
  const a = await parseKifu(WARS_KIF.replace("Sukonbu3", "me_wars"), {
    source,
    tags: ["me_wars", "自分"],
  });
  const b = await parseKifu(USI_SHIKEN_VS_FUNA, { source, tags: ["me_quest", "自分"] });
  const c = await parseKifu(USI_ANAGUMA_VS_SHIKEN, { source, tags: ["rival"] });
  Object.assign(b, {
    black: "me_quest",
    white: "x1",
    result: "black",
    blackRating: 1500,
    startedAt: "2026-02-01T00:00:00",
  });
  Object.assign(c, {
    black: "rival",
    blackRank: "三段",
    white: "me_wars",
    whiteRank: "初段",
    result: "white",
    startedAt: "2026-03-01T00:00:00",
  });
  await db.games.bulkPut([a, b, c]);
  return { a, b, c };
}

/** 自分の段位・レート (WARS_KIF の二段、b の R1500、c の初段) */
const SELF_RANKS = ["二段", "R1500", "初段"];

const noSelfRank = (el: Element = document.body) => {
  for (const r of SELF_RANKS) expect(el.textContent).not.toContain(r);
};

const noIds = () => {
  const text = document.body.textContent ?? "";
  for (const id of IDS) {
    expect(text).not.toContain(id);
    expect(document.body.innerHTML).not.toContain(id);
  }
};

/** `prev` の画面から棋譜を開いた履歴エントリにする (null は URL を直接開いたとき) */
function openFrom(id: string, prev: string | null) {
  history.replaceState(prev ? { viewKey: "test", prev } : null, "", `#/game/${id}`);
}

describe("自分の ID の統合", () => {
  beforeEach(async () => {
    await db.games.clear();
    await db.analyses.clear();
    await db.reports.clear();
    setSelfIds(IDS);
  });
  afterEach(() => {
    cleanup();
    setSelfIds([]);
    history.replaceState(null, "", "#/");
  });

  it("対局者一覧: 2 つの ID が「自分」1 人にまとまる", async () => {
    await seed();
    render(<PlayerList />);
    await waitFor(() => expect(screen.getByText("自分")).toBeInTheDocument());
    screen.getByLabelText("対局相手も表示").click();
    await waitFor(() => expect(screen.getByText("x1")).toBeInTheDocument());
    const first = document.querySelector("ul.games li")!;
    expect(first).toHaveTextContent("自分");
    expect(first).toHaveTextContent("3 局 · 2 勝 1 敗");
    noSelfRank(first);
    const rival = Array.from(document.querySelectorAll("ul.games li")).find((li) =>
      li.textContent?.startsWith("rival"),
    )!;
    expect(rival).toHaveTextContent("rival 三段");
    noIds();
    (first as HTMLElement).click();
    expect(decodeURIComponent(location.hash)).toBe("#/player/自分");
  });

  it("棋譜一覧と対局者ページ: ID が出ず、見出しは「マイページ」", async () => {
    await seed();
    render(<GameList />);
    await waitFor(() => expect(screen.getByText(/3 \/ 3 局/)).toBeInTheDocument());
    expect(screen.getAllByText(/自分/).length).toBeGreaterThan(0);
    noIds();
    cleanup();

    render(<PlayerPage name="自分" />);
    await waitFor(() => expect(screen.getByText("相居飛車")).toBeInTheDocument());
    const card = document.querySelector(".profile-card") as HTMLElement;
    expect(card).toHaveTextContent("マイページ");
    expect(card).toHaveTextContent("0/3 局");
    noSelfRank(card);
    noIds();
  });

  it("棋譜ビューア: 盤の上下と KIF に ID が出ない。相手のページから開いた相手との対局は相手が手前のまま", async () => {
    const { a, c } = await seed();
    render(<GameViewer id={a.id} initialPly={0} />);
    await waitFor(() => expect(screen.getByText(/0 手目/)).toBeInTheDocument());
    let rows = document.querySelectorAll(".side-row");
    expect(rows[1]).toHaveTextContent("☗ 自分");
    rows.forEach((r) => noSelfRank(r));
    expect((await db.games.get(a.id))?.raw).toContain("先手：自分");
    noIds();
    cleanup();

    openFrom(c.id, "#/player/rival");
    render(<GameViewer id={c.id} initialPly={0} />);
    await waitFor(() => expect(screen.getByText(/0 手目/)).toBeInTheDocument());
    rows = document.querySelectorAll(".side-row");
    expect(rows[1]).toHaveTextContent("☗ rival");
    expect(rows[1]!.querySelector(".player.tracked")).not.toBeNull();
    expect(rows[0]).toHaveTextContent("☖ 自分");
    expect(rows[1]).toHaveTextContent("☗ rival 三段");
    noSelfRank(rows[0]!);
    noIds();
  });

  it("棋譜ビューア: 自分 vs 登録相手の対局は、相手の文脈以外 (マイページ・比較・学習・直接 URL) から開くと自分が手前", async () => {
    const { c } = await seed();
    const contexts: Array<[string | null, "自分" | "rival"]> = [
      ["#/player/自分", "自分"],
      ["#/player/自分/compare/rival?opening=x", "自分"],
      ["#/player/自分/branch/k?at=3", "自分"],
      ["#/games?player=自分", "自分"],
      [null, "自分"],
      ["#/", "自分"],
      ["#/player/rival?style=ibisha-ibisha", "rival"],
      ["#/games?player=rival", "rival"],
      ["#/player/rival/compare/自分", "rival"],
    ];
    for (const [prev, front] of contexts) {
      openFrom(c.id, prev);
      render(<GameViewer id={c.id} initialPly={0} />);
      await waitFor(() => expect(screen.getByText(/0 手目/)).toBeInTheDocument());
      const rows = document.querySelectorAll(".side-row");
      const mark = front === "自分" ? "☖" : "☗";
      expect(rows[1], `${prev}`).toHaveTextContent(`${mark} ${front}`);
      expect(rows[1]!.querySelector(".player.tracked"), `${prev}`).not.toBeNull();
      expect(rows[0]!.querySelector(".player.tracked"), `${prev}`).toBeNull();
      noIds();
      cleanup();
    }
  });

  it("相手の対局者ページの集計は今までどおり", async () => {
    await seed();
    render(<PlayerPage name="rival" />);
    await waitFor(() => expect(screen.getByText("相居飛車")).toBeInTheDocument());
    const card = document.querySelector(".profile-card") as HTMLElement;
    expect(card).toHaveTextContent("rival 三段");
    expect(card).toHaveTextContent("0/1 局");
    expect(card).toHaveTextContent("勝率 · 0 勝 1 敗");
    noIds();
  });

  it("共有画像: 描画するテキストに ID が出ない", async () => {
    await seed();
    const games = await db.games.toArray();
    render(
      <ShareCard
        stats={computePlayerStats(games, "自分")}
        profile={null}
        others={[]}
        report={null}
        date="2026-10-07"
      />,
    );
    const text = Array.from(document.querySelectorAll("svg.share-card text"))
      .map((t) => t.textContent)
      .join("\n");
    expect(text).toContain("自分");
    expect(text).toContain("3 局");
    for (const r of SELF_RANKS) expect(text).not.toContain(r);
    noIds();
    cleanup();

    render(
      <ShareCard
        stats={computePlayerStats(games, "rival")}
        profile={null}
        others={[]}
        report={null}
        date="2026-10-07"
      />,
    );
    const rivalText = Array.from(document.querySelectorAll("svg.share-card text"))
      .map((t) => t.textContent)
      .join("\n");
    expect(rivalText).toContain("rival  三段");
  });
});
