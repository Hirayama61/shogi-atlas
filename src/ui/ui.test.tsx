// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { parseKifu } from "../core/parse";
import {
  QUEST_KIF_TIMEOUT,
  USI_ANAGUMA_VS_SHIKEN,
  USI_SHIKEN_VS_FUNA,
  WARS_KIF,
} from "../core/__tests__/fixtures";
import { db } from "../db/db";
import type { AnalysisRecord } from "../core/analysis";
import App from "../App";
import { outcomeFor, playerSide } from "../core/stats";
import { GameList } from "./GameList";
import { GameViewer } from "./GameViewer";
import { PlayerList } from "./PlayerList";
import { PlayerPage } from "./PlayerPage";
import { fieldQuery, hashFor, parseHash, type ListQuery } from "./router";

const source = { kind: "paste" as const };

async function seed() {
  const a = await parseKifu(WARS_KIF, { source, tags: ["Sukonbu3"] });
  const b = await parseKifu(USI_SHIKEN_VS_FUNA, { source });
  const c = await parseKifu(USI_ANAGUMA_VS_SHIKEN, { source });
  Object.assign(b, {
    black: "Sukonbu3",
    white: "x1",
    result: "black",
    startedAt: "2026-02-01T00:00:00",
    tags: ["Sukonbu3"],
  });
  Object.assign(c, {
    black: "Sukonbu3",
    white: "x2",
    result: "white",
    startedAt: "2026-03-01T00:00:00",
    tags: ["Sukonbu3"],
  });
  await db.games.bulkPut([a, b, c]);
  return { a, b, c };
}

describe("UI", () => {
  beforeEach(async () => {
    await db.games.clear();
    await db.analyses.clear();
    location.hash = "";
  });
  afterEach(cleanup);

  it("GameList: 一覧に対局と概要が出る", async () => {
    await seed();
    render(<GameList />);
    await waitFor(() => expect(screen.getByText(/3 \/ 3 局/)).toBeInTheDocument());
    expect(screen.getByText("☖nemushi_")).toBeInTheDocument();
    expect(screen.getAllByText(/四間飛車/).length).toBeGreaterThan(0);
    expect(document.body.textContent).not.toContain("undefined");
  });

  it("GameList: 出典サービスのバッジが出て、文字入力の絞り込み欄は無い", async () => {
    await seed();
    const q = await parseKifu(QUEST_KIF_TIMEOUT, { source });
    Object.assign(q, { startedAt: "2026-04-01T00:00:00" });
    await db.games.put(q);
    render(<GameList />);
    await waitFor(() => expect(screen.getByText(/4 \/ 4 局/)).toBeInTheDocument());
    const badges = screen.getAllByLabelText("出典").map((el) => el.textContent);
    expect(badges).toEqual(["クエスト", "ウォーズ"]);
    expect(screen.queryByRole("searchbox")).not.toBeInTheDocument();
    expect(screen.queryByPlaceholderText(/絞り込み/)).not.toBeInTheDocument();
  });

  it("GameList: 絞り込み条件を渡すと、その対局者のその戦法の対局だけが出る", async () => {
    const { a, b, c } = await seed();
    // 3 局とも Sukonbu3 が先手
    const opening = b.opening.blackOpening;
    render(<GameList query={fieldQuery("Sukonbu3", "opening", opening)} />);
    const expected = [a, b, c].filter((g) => g.opening.blackOpening === opening).length;
    await waitFor(() => expect(screen.getByText(`${expected} / 3 局`)).toBeInTheDocument());
    expect(screen.getByLabelText<HTMLSelectElement>("戦法").value).toBe(opening);
    expect(screen.getByLabelText<HTMLSelectElement>("戦法の側").value).toBe("self");
    expect(c.opening.blackOpening).not.toBe(opening);
    expect(screen.queryByText("☖x2")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "← Sukonbu3" }));
    expect(location.hash).toBe("#/player/Sukonbu3");
  });

  describe("GameList の絞り込み", () => {
    const count = (n: number, total = 3) =>
      waitFor(() => expect(screen.getByText(`${n} / ${total} 局`)).toBeInTheDocument());
    /** 選んで、URL 経由で画面に反映されるまで待つ */
    const choose = async (label: string, value: string) => {
      fireEvent.change(screen.getByLabelText(label), { target: { value } });
      await waitFor(() =>
        expect(screen.getByLabelText<HTMLSelectElement>(label).value).toBe(value),
      );
    };
    const query = (): ListQuery => {
      const r = parseHash(location.hash);
      return r.kind === "list" ? (r.query ?? {}) : {};
    };
    const optionValues = (label: string) =>
      Array.from(screen.getByLabelText<HTMLSelectElement>(label).options).map((o) => o.value);

    it("戦法と囲いを別々に選び、先手 / 後手 / どちらでも を切り替えられる", async () => {
      const { a, b, c } = await seed();
      const all = [a, b, c];
      location.hash = "#/";
      render(<App />);
      await count(3);
      const opening = b.opening.blackOpening;
      const n = (f: (g: (typeof all)[number]) => boolean) => all.filter(f).length;
      // 選択肢に局数が付く
      expect(
        screen.getByRole("option", {
          name: `${opening} (${n((g) => [g.opening.blackOpening, g.opening.whiteOpening].includes(opening))})`,
        }),
      ).toBeInTheDocument();
      await choose("戦法", opening);
      await waitFor(() => expect(query()).toEqual({ opening }));
      await count(n((g) => [g.opening.blackOpening, g.opening.whiteOpening].includes(opening)));
      await choose("戦法の側", "white");
      await waitFor(() => expect(query()).toEqual({ opening, openingSide: "white" }));
      await count(n((g) => g.opening.whiteOpening === opening));
      await choose("戦法の側", "black");
      await count(n((g) => g.opening.blackOpening === opening));
      // 対局者なしでは本人 / 相手は出ない
      expect(optionValues("戦法の側")).toEqual(["", "black", "white"]);

      await choose("戦法", "");
      const castle = b.opening.whiteCastle;
      await choose("囲い", castle);
      await waitFor(() => expect(query()).toEqual({ openingSide: "black", castle }));
      await count(n((g) => [g.opening.blackCastle, g.opening.whiteCastle].includes(castle)));
      await choose("囲いの側", "white");
      await count(n((g) => g.opening.whiteCastle === castle));
      await choose("囲いの側", "black");
      await count(n((g) => g.opening.blackCastle === castle));
    });

    it("勝敗で絞り込み、対局者を指定すると勝ち / 負けでも選べる", async () => {
      const { a, b, c } = await seed();
      const all = [a, b, c];
      location.hash = "#/";
      render(<App />);
      await count(3);
      expect(optionValues("勝敗")).toEqual(["", "black", "white", "other"]);
      await choose("勝敗", "black");
      await count(all.filter((g) => g.result === "black").length);
      await choose("勝敗", "other");
      await count(all.filter((g) => g.result === "draw" || g.result === "unknown").length);

      await choose("勝敗", "");
      await choose("対局者", "Sukonbu3");
      await waitFor(() => expect(optionValues("勝敗")).toContain("loss"));
      const mine = all.filter((g) => playerSide(g, "Sukonbu3") !== null);
      await count(mine.length);
      await choose("勝敗", "loss");
      const losses = mine.filter(
        (g) => outcomeFor(g.result, playerSide(g, "Sukonbu3")!) === "loss",
      );
      await count(losses.length);
      expect(losses.length).toBeGreaterThan(0);
      expect(query()).toEqual({ player: "Sukonbu3", result: "loss" });
      // 対局者を外すと効かない条件も消える
      await choose("対局者", "");
      await waitFor(() => expect(query()).toEqual({}));
    });

    it("条件は URL から再現でき、組み合わせて一括で消せる", async () => {
      const { a, b, c } = await seed();
      const q: ListQuery = {
        player: "Sukonbu3",
        opening: b.opening.whiteOpening,
        openingSide: "opponent",
        result: "win",
      };
      location.hash = hashFor({ kind: "list", query: q });
      render(<App />);
      const expected = [a, b, c].filter((g) => {
        const side = playerSide(g, "Sukonbu3");
        if (!side) return false;
        const opp = side === "black" ? g.opening.whiteOpening : g.opening.blackOpening;
        return opp === q.opening && outcomeFor(g.result, side) === "win";
      });
      expect(expected.length).toBeGreaterThan(0);
      await count(expected.length);
      expect(screen.getByLabelText<HTMLSelectElement>("戦法の側").value).toBe("opponent");
      expect(screen.getByLabelText<HTMLSelectElement>("勝敗").value).toBe("win");
      await choose("出典の絞り込み", "quest");
      await count(0);
      fireEvent.click(screen.getByRole("button", { name: "条件をすべて消す" }));
      await count(3);
      expect(location.hash).toBe("#/");
      expect(screen.queryByRole("button", { name: "条件をすべて消す" })).not.toBeInTheDocument();
    });
  });

  it("PlayerList: 文字入力の絞り込み欄は無い", async () => {
    await seed();
    render(<PlayerList />);
    await waitFor(() => expect(screen.getByText("Sukonbu3")).toBeInTheDocument());
    expect(screen.queryByRole("searchbox")).not.toBeInTheDocument();
  });

  it("GameViewer: 盤面・戦法・囲い・同じ局面の対局が出る", async () => {
    const { a, b } = await seed();
    render(<GameViewer id={b.id} initialPly={18} />);
    await waitFor(() => expect(screen.getByText(/18 手目/)).toBeInTheDocument());
    expect(screen.getByRole("img", { name: "盤面" })).toBeInTheDocument();
    expect(screen.getByText(/四間飛車 · 囲い: 本美濃/)).toBeInTheDocument();
    expect(screen.getByText(/居飛車 · 囲い: 舟囲い/)).toBeInTheDocument();
    expect(document.body.textContent).not.toContain("undefined");
    // 1 手目の局面は a とも共通
    render(<GameViewer id={a.id} initialPly={1} />);
    await waitFor(() => expect(screen.getByText("同じ局面を通った対局")).toBeInTheDocument());
  });

  it("GameViewer: 盤の上下に対局者名と手番が出て、本人が後手なら後手を手前にする", async () => {
    const { b, c } = await seed();
    // b: 本人 (Sukonbu3) が先手 → 先手が手前 (下の行)。18 手目 (後手の手) を指した後なので先手番
    render(<GameViewer id={b.id} initialPly={18} />);
    await waitFor(() => expect(screen.getByText(/18 手目/)).toBeInTheDocument());
    let rows = document.querySelectorAll(".side-row");
    expect(rows[0]).toHaveTextContent("☖ x1");
    expect(rows[1]).toHaveTextContent("☗ Sukonbu3");
    expect(rows[1]).toHaveTextContent("手番");
    expect(rows[0]).not.toHaveTextContent("手番");
    expect(rows[1]!.querySelector(".player.tracked")).not.toBeNull();
    expect(rows[0]!.querySelector(".player.tracked")).toBeNull();
    cleanup();

    // c を本人が後手の対局にする → 最初から後手が手前。「反転」で戻せる
    await db.games.put({ ...c, black: "x2", white: "Sukonbu3", whiteRank: "三段" });
    render(<GameViewer id={c.id} initialPly={0} />);
    await waitFor(() => expect(screen.getByText(/0 手目/)).toBeInTheDocument());
    rows = document.querySelectorAll(".side-row");
    expect(rows[0]).toHaveTextContent("☗ x2");
    expect(rows[1]).toHaveTextContent("☖ Sukonbu3 三段");
    expect(rows[1]!.querySelector(".player.tracked")).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "反転" }));
    rows = document.querySelectorAll(".side-row");
    expect(rows[0]).toHaveTextContent("☖ Sukonbu3");
  });

  it("PlayerList: 登録した対局者だけを出し、切り替えで相手も出す", async () => {
    await seed();
    render(<PlayerList />);
    await waitFor(() => expect(screen.getByText("Sukonbu3")).toBeInTheDocument());
    expect(screen.queryByText("nemushi_")).not.toBeInTheDocument();
    screen.getByLabelText("対局相手も表示").click();
    await waitFor(() => expect(screen.getByText("nemushi_")).toBeInTheDocument());
  });

  it("PlayerPage: 成績と戦法の内訳が出る", async () => {
    await seed();
    render(<PlayerPage name="Sukonbu3" />);
    await waitFor(() => expect(screen.getByText("相居飛車")).toBeInTheDocument());
    // 先頭のカード: 局数と解析済み、勝率、先後の内訳。解析が無ければレーダーの代わりに「解析待ち」
    const card = document.querySelector(".profile-card") as HTMLElement;
    expect(card).toHaveTextContent("0/3 局");
    expect(card).toHaveTextContent("勝率 · 1 勝 2 敗");
    expect(card).toHaveTextContent("先手 3 局 · 1 勝 2 敗");
    expect(card).toHaveTextContent("後手 0 局 · 0 勝 0 敗");
    expect(card).toHaveTextContent("解析待ち");
    expect(screen.queryByRole("img", { name: /レーダーチャート/ })).toBeNull();
    // 解析が無ければ弱点プロファイルの欄は出さない
    expect(screen.queryByText("弱点プロファイル")).toBeNull();
    expect(document.body.textContent).not.toContain("undefined");
  });

  it("PlayerPage: 全対局の一覧は出さず、局数のタイルからその人で絞った棋譜一覧へ飛ぶ", async () => {
    await seed();
    render(<PlayerPage name="Sukonbu3" />);
    await waitFor(() => expect(screen.getByText("相居飛車")).toBeInTheDocument());
    expect(screen.queryByText("対局一覧")).toBeNull();
    expect(document.querySelector("ul.games")).toBeNull();
    const card = document.querySelector(".profile-card") as HTMLElement;
    const link = within(card).getByRole("link", { name: /0\/3 局/ });
    const route = { kind: "list" as const, query: { player: "Sukonbu3" } };
    expect(link).toHaveAttribute("href", hashFor(route));
    // jsdom はリンクのハッシュ遷移をしないので、href をルーターに通して一覧を開く
    const parsed = parseHash(link.getAttribute("href")!);
    expect(parsed).toEqual(route);
    cleanup();
    if (parsed.kind !== "list") throw new Error("list route expected");
    render(<GameList query={parsed.query} />);
    await waitFor(() => expect(screen.getByText("3 / 3 局")).toBeInTheDocument());
    expect(document.querySelectorAll("ul.games li")).toHaveLength(3);
    fireEvent.click(screen.getByRole("button", { name: "← Sukonbu3" }));
    expect(location.hash).toBe("#/player/Sukonbu3");
  });

  it("PlayerPage: 採用戦法・囲い・相手の戦法別の表と戦型ポートフォリオ・分岐点の節は独立して並ばず、概要 → 4 区分 → 戦法 → 戦法の詳細の階層になる", async () => {
    await seed();
    render(<PlayerPage name="Sukonbu3" />);
    await waitFor(() => expect(screen.getByText("相居飛車")).toBeInTheDocument());
    const headings = Array.from(document.querySelectorAll(".panel > strong")).map(
      (el) => el.textContent,
    );
    for (const old of ["採用戦法", "囲い", "相手の戦法別", "戦型ポートフォリオ", "分岐点"]) {
      expect(headings).not.toContain(old);
    }
    expect(headings).toContain("戦型");
    // 区分を選ぶまでは戦法の一覧も詳細も出ない
    expect(document.querySelector(".opening-list")).toBeNull();
    expect(document.querySelector(".opening-detail")).toBeNull();
    // 概要 (カード) が戦型より前
    const card = document.querySelector(".profile-card")!;
    const quadrants = document.querySelector(".quadrants")!;
    expect(card.compareDocumentPosition(quadrants) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("PlayerPage: 4 区分それぞれに局数・勝率・先後の内訳が出て、合計が全対局数に一致する", async () => {
    await seed();
    render(<PlayerPage name="Sukonbu3" />);
    await waitFor(() => expect(screen.getByText("相居飛車")).toBeInTheDocument());
    const cards = Array.from(document.querySelectorAll<HTMLAnchorElement>("a.quadrant"));
    expect(cards.map((c) => c.querySelector(".quadrant-title")!.textContent)).toEqual([
      "相居飛車",
      "対抗形 · 自分が居飛車",
      "対抗形 · 自分が振り飛車",
      "相振り飛車",
    ]);
    const games = cards.map((c) => Number(/(\d+) 局 · 勝率/.exec(c.textContent!)![1]));
    expect(games).toEqual([0, 1, 2, 0]);
    expect(games.reduce((x, y) => x + y, 0)).toBe(3);
    // a (負け), b (勝ち) が振り飛車、c (負け) が居飛車。3 局とも先手
    expect(cards[2]).toHaveTextContent("2 局 · 勝率 50%");
    expect(cards[2]).toHaveTextContent("先手 2 局 1 勝 · 後手 0 局 0 勝");
    expect(cards[1]).toHaveTextContent("0 勝 1 敗");
    expect(parseHash(cards[2]!.getAttribute("href")!)).toEqual({
      kind: "player",
      name: "Sukonbu3",
      view: { quadrant: "furiVsIbisha" },
    });
  });

  it("PlayerPage: 区分を選ぶと戦法の一覧 (局数・勝率) が出て、自分の戦法と相手の戦法を切り替えられる", async () => {
    const { b } = await seed();
    const { rerender } = render(<PlayerPage name="Sukonbu3" view={{ quadrant: "furiVsIbisha" }} />);
    await waitFor(() => expect(document.querySelector(".opening-list")).not.toBeNull());
    const list = document.querySelector(".opening-list") as HTMLElement;
    expect(list).toHaveTextContent("対抗形 · 自分が振り飛車 の戦法");
    expect(document.querySelector("a.quadrant.selected")).toHaveTextContent(
      "対抗形 · 自分が振り飛車",
    );
    const heads = Array.from(list.querySelectorAll("thead th")).map((th) => th.textContent);
    expect(heads).toEqual(["自分の戦法", "局", "勝", "敗", "勝率", "割合"]);
    const row = within(list).getByRole("link", { name: b.opening.blackOpening }).closest("tr")!;
    expect(Array.from(row.children).map((td) => td.textContent)).toEqual([
      b.opening.blackOpening,
      "2",
      "1",
      "1",
      "50%",
      "100%",
    ]);
    fireEvent.click(row);
    expect(parseHash(location.hash)).toEqual({
      kind: "player",
      name: "Sukonbu3",
      view: { quadrant: "furiVsIbisha", opening: b.opening.blackOpening },
    });

    const toggle = within(list).getByRole("group", { name: "戦法の側" });
    const opp = within(toggle).getByRole("link", { name: "相手の戦法" });
    expect(within(toggle).getByRole("link", { name: "自分の戦法" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    const oppRoute = parseHash(opp.getAttribute("href")!);
    expect(oppRoute).toEqual({
      kind: "player",
      name: "Sukonbu3",
      view: { quadrant: "furiVsIbisha", axis: "opponent" },
    });
    if (oppRoute.kind !== "player") throw new Error("unreachable");
    rerender(<PlayerPage name="Sukonbu3" view={oppRoute.view} />);
    await waitFor(() =>
      expect(
        Array.from(document.querySelectorAll(".opening-list thead th")).map((t) => t.textContent),
      ).toContain("相手の戦法"),
    );
    expect(
      within(document.querySelector(".opening-list") as HTMLElement).getByRole("link", {
        name: b.opening.whiteOpening,
      }),
    ).toBeInTheDocument();
  });

  it("PlayerPage: 戦法を選ぶと囲い・相手の戦法・繰り返している手順・分岐点・棋譜一覧へのリンクが 1 画面に出る", async () => {
    const { b } = await seedBranches();
    const view = { quadrant: "furiVsIbisha" as const, opening: b.opening.blackOpening };
    render(<PlayerPage name="Sukonbu3" view={view} />);
    await waitFor(() =>
      expect(document.querySelector(".opening-detail a.branch-row")).not.toBeNull(),
    );
    const detail = document.querySelector(".opening-detail") as HTMLElement;
    // a, b, b2, b3 が本人のノーマル四間飛車
    expect(detail).toHaveTextContent("4 局 1 勝 3 敗");
    const tables = Array.from(detail.querySelectorAll("table"));
    expect(tables.map((t) => t.querySelector("th")!.textContent)).toEqual([
      "自分の囲い",
      "相手の戦法",
    ]);
    const castle = within(tables[0]!).getByRole("link", { name: b.opening.blackCastle });
    fireEvent.click(castle.closest("tr")!);
    expect(parseHash(location.hash)).toEqual({
      kind: "list",
      query: {
        player: "Sukonbu3",
        shape: "taikokei",
        selfStyle: "furibisha",
        opening: b.opening.blackOpening,
        openingSide: "self",
        castle: b.opening.blackCastle,
        castleSide: "self",
      },
    });
    expect(within(tables[1]!).getByText(b.opening.whiteOpening)).toBeInTheDocument();
    expect(detail.querySelector("details.lines > summary")).toHaveTextContent(
      "先手で繰り返している手順",
    );
    expect(detail.querySelectorAll("a.branch-row").length).toBeGreaterThan(0);
    const link = within(detail).getByRole("link", { name: /この戦法の棋譜一覧 \(4 局\)/ });
    const route = parseHash(link.getAttribute("href")!);
    expect(route).toEqual({
      kind: "list",
      query: {
        player: "Sukonbu3",
        shape: "taikokei",
        selfStyle: "furibisha",
        opening: b.opening.blackOpening,
        openingSide: "self",
      },
    });
    cleanup();
    if (route.kind !== "list") throw new Error("unreachable");
    render(<GameList query={route.query} />);
    await waitFor(() => expect(screen.getByText("4 / 5 局")).toBeInTheDocument());
  });

  it("PlayerPage: 1 段の行数が上限を超えると「他 N 件」に畳まれる", async () => {
    const { b } = await seed();
    // 本人の振り飛車の戦法を 12 種に増やす
    const many = await Promise.all(
      Array.from({ length: 12 }, async (_, i) => {
        const g = await parseKifu(USI_SHIKEN_VS_FUNA, { source });
        Object.assign(g, {
          id: `m${i}`,
          black: "Sukonbu3",
          white: `y${i}`,
          result: "black",
          tags: ["Sukonbu3"],
        });
        g.opening = { ...b.opening, blackOpening: `戦法${String(i).padStart(2, "0")}` };
        return g;
      }),
    );
    await db.games.bulkPut(many);
    render(<PlayerPage name="Sukonbu3" view={{ quadrant: "furiVsIbisha" }} />);
    await waitFor(() => expect(document.querySelector(".opening-list")).not.toBeNull());
    const list = document.querySelector(".opening-list") as HTMLElement;
    // 13 種 (ノーマル四間飛車 + 12) のうち 10 行を出し、残り 3 件を畳む
    const first = list.querySelector(":scope > table")!;
    expect(first.querySelectorAll("tbody tr")).toHaveLength(10);
    const more = list.querySelector<HTMLDetailsElement>("details.rows-more")!;
    expect(more.open).toBe(false);
    expect(more.querySelector("summary")).toHaveTextContent("他 3 件");
    expect(more.querySelectorAll("tbody tr")).toHaveLength(3);
  });

  /** b と同じ 18 手目まで進み、19 手目 (本人) で分かれる b2 と、20 手目 (相手) で分かれる b3 */
  async function seedBranches() {
    const { b } = await seed();
    const variant = async (id: string, from: string, to: string, white: string) => {
      const g = await parseKifu(USI_SHIKEN_VS_FUNA.replace(from, to), { source });
      Object.assign(g, {
        id,
        black: "Sukonbu3",
        white,
        result: "white",
        startedAt: "2026-04-01T00:00:00",
        tags: ["Sukonbu3"],
      });
      return g;
    };
    const b2 = await variant("b2b2b2", "1g1f 1c1d", "9g9f 9c9d", "x3");
    const b3 = await variant("b3b3b3", "1g1f 1c1d", "1g1f 9c9d", "x4");
    await db.games.bulkPut([b2, b3]);
    const flat = Array.from({ length: 21 }, () => 0);
    const analysis = (id: string, cps: number[], best: Record<number, string> = {}) => ({
      schema: 1 as const,
      id,
      engine: { name: "fake", depth: 1 },
      analyzedAt: "2026-01-01T00:00:00Z",
      plies: cps.map((cp, ply) => (best[ply] ? { ply, cp, best: best[ply] } : { ply, cp })),
    });
    await db.analyses.bulkPut([
      analysis(b.id, flat),
      analysis(
        b2.id,
        flat.map((cp, ply) => (ply >= 19 ? -400 : cp)),
        { 18: "1g1f" },
      ),
    ]);
    return { b, b2, b3 };
  }

  it("PlayerPage: 戦法の詳細の分岐点は木で、下流の分岐点が親の手の先に字下げして出る。入れ子の details は無く、悪手の枝が先", async () => {
    const { b, b2 } = await seedBranches();
    await db.games.delete("b3b3b3");
    const view = { quadrant: "furiVsIbisha" as const, opening: b.opening.blackOpening };
    render(<PlayerPage name="Sukonbu3" view={view} />);
    await waitFor(() => expect(document.querySelector(".branch-row.mistake")).not.toBeNull());
    const panel = document.querySelector(".detail-branches") as HTMLElement;
    expect(panel.querySelector("details")).toBeNull();
    const rows = Array.from(panel.querySelectorAll<HTMLAnchorElement>("a.branch-row"));
    // a・b・b2 が 7 手目 (相手) で分かれ、△4二玉 の先の 18 手目で本人が分かれる (悪手あり)
    expect(rows.map((r) => [r.dataset.depth, r.className])).toEqual([
      ["0", "branch-row opponent"],
      ["1", "branch-row mistake"],
    ]);
    expect(rows[0]!.textContent).toContain(`${b.opening.blackOpening} · 7 手目 · 3 局`);
    expect(rows[0]!.querySelector(".branch-via")).toBeNull();
    const text = rows[1]!.textContent ?? "";
    expect(rows[1]!.querySelector(".branch-via")).toHaveTextContent("└ △4二玉 の先");
    expect(text).toContain(`${b.opening.blackOpening} · 18 手目 · 2 局`);
    expect(text).toContain("本人: ▲1六歩 (最善) / ▲9六歩 (悪手 · 損失 400 · 最善 ▲1六歩)");
    expect(parseHash(rows[1]!.getAttribute("href")!)).toEqual({
      kind: "branch",
      name: "Sukonbu3",
      key: b2.positions[18],
      view,
    });
  });

  it("PlayerPage: 別の戦法の対局との共通局面は戦法の詳細の分岐点に混ざらない", async () => {
    const { b } = await seedBranches();
    // b と同じ手順の 3 局を別の戦法にする。全対局で数えるとこの戦法は 18 手目の分岐点で少数派
    const others = [1, 2, 3].map((i) => ({
      ...b,
      id: `o${i}o${i}`,
      white: `o${i}`,
      opening: { ...b.opening, blackOpening: "三間飛車" },
    }));
    await db.games.bulkPut(others);
    render(
      <PlayerPage
        name="Sukonbu3"
        view={{ quadrant: "furiVsIbisha", opening: b.opening.blackOpening }}
      />,
    );
    await waitFor(() => expect(document.querySelector(".branch-row.mistake")).not.toBeNull());
    const rows = Array.from(
      document.querySelectorAll<HTMLAnchorElement>(".detail-branches a.branch-row"),
    );
    // この戦法 (a, b, b2, b3) だけで数えた局数が出る
    expect(rows.map((r) => r.querySelector(".branch-head")!.textContent)).toEqual([
      `${b.opening.blackOpening} · 7 手目 · 4 局 1 勝`,
      `${b.opening.blackOpening} · 18 手目 · 3 局 1 勝`,
      `${b.opening.blackOpening} · 19 手目 · 2 局 1 勝`,
    ]);
  });

  it("分岐点の学習画面: 開始局面から 1 手ずつたどり、分岐点で候補手を比べ、選んだ手の先から棋譜へ飛ぶ", async () => {
    const { b, b2 } = await seedBranches();
    location.hash = hashFor({ kind: "branch", name: "Sukonbu3", key: b.positions[18]! });
    render(<App />);
    const ply = async () =>
      (await screen.findByText(/開始局面|手目/, { selector: ".study-ply" })).textContent;
    expect(await ply()).toBe("開始局面");
    const board = () => document.querySelector(".study-board svg.board")!.innerHTML;
    const startBoard = board();
    fireEvent.click(screen.getByRole("button", { name: "進む" }));
    expect(await ply()).toBe("1 手目 ▲7六歩");
    expect(board()).not.toBe(startBoard);
    fireEvent.click(screen.getByRole("button", { name: "戻る" }));
    expect(await ply()).toBe("開始局面");
    expect(board()).toBe(startBoard);
    // 分岐点へ。盤の上に候補手の印が判定の色で並ぶ
    fireEvent.click(screen.getByRole("button", { name: "分岐点" }));
    expect(await ply()).toBe("18 手目 △5四歩");
    const marks = Array.from(document.querySelectorAll(".board-mark")).map((m) => [
      m.getAttribute("data-usi"),
      m.getAttribute("stroke"),
    ]);
    expect(marks).toEqual([
      ["1g1f", "var(--good)"],
      ["9g9f", "var(--danger)"],
    ]);
    const group = screen.getByRole("group", { name: "本人の候補手" });
    const buttons = within(group).getAllByRole("button");
    expect(buttons.map((x) => x.textContent)).toEqual([
      "▲1六歩 ×2 最善",
      "▲9六歩 ×1 悪手 · 損失 400 · 最善 ▲1六歩",
    ]);
    // 悪手を選ぶと盤に反映され、その対局の続きを進められる
    fireEvent.click(buttons[1]!);
    expect(await ply()).toBe("19 手目 ▲9六歩");
    expect(buttons[1]).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(screen.getByRole("button", { name: "進む" }));
    expect(await ply()).toBe("20 手目 △9四歩");
    fireEvent.click(screen.getByRole("button", { name: /^棋譜で開く/ }));
    expect(parseHash(location.hash)).toEqual({ kind: "game", id: b2.id, ply: 20 });
  });

  it("分岐点の学習画面: 候補を選んで進むと次の分岐点で候補手と判定が出て、選ぶとそこから続けられる", async () => {
    const { b, b3 } = await seedBranches();
    await db.analyses.put({
      schema: 1,
      id: b3.id,
      engine: { name: "fake", depth: 1 },
      analyzedAt: "2026-01-01T00:00:00Z",
      plies: Array.from({ length: 21 }, (_, ply) => ({ ply, cp: ply >= 20 ? 300 : 0 })),
    });
    const view = { quadrant: "furiVsIbisha" as const, opening: b.opening.blackOpening };
    location.hash = hashFor({ kind: "branch", name: "Sukonbu3", key: b.positions[18]!, view });
    render(<App />);
    const ply = async () =>
      (await screen.findByText(/開始局面|手目/, { selector: ".study-ply" })).textContent;
    expect(await ply()).toBe("開始局面");
    fireEvent.click(screen.getByRole("button", { name: "分岐点" }));
    expect(await ply()).toBe("18 手目 △5四歩");
    // ▲1六歩 (b, b3) を選ぶと、その先の 19 手目が次の分岐点 (相手の手番)
    const self = screen.getByRole("group", { name: "本人の候補手" });
    fireEvent.click(within(self).getByRole("button", { name: /^▲1六歩/ }));
    expect(await ply()).toBe("19 手目 ▲1六歩");
    expect(screen.getByText(/^次の分岐点 \(19 手目\)/)).toBeInTheDocument();
    const opp = screen.getByRole("group", { name: "相手の候補手" });
    const buttons = within(opp).getAllByRole("button");
    expect(buttons[0]).toHaveTextContent("△1四歩 ×1 最善");
    expect(buttons[1]!.textContent).toMatch(/^△9四歩 ×1 (疑問手|悪手|大悪手) · 損失 300/);
    expect(buttons[0]).toHaveAttribute("aria-pressed", "true");
    expect(document.querySelectorAll(".board-mark")).toHaveLength(2);
    // 次の分岐点で別の手を選ぶと、その分岐点から続ける
    fireEvent.click(buttons[1]!);
    expect(await ply()).toBe("20 手目 △9四歩");
    fireEvent.click(screen.getByRole("button", { name: /^棋譜で開く/ }));
    expect(parseHash(location.hash)).toEqual({ kind: "game", id: b3.id, ply: 20 });
  });

  it("分岐点の学習画面: 分岐点から分岐点へ飛べる", async () => {
    const { b } = await seedBranches();
    const view = { quadrant: "furiVsIbisha" as const, opening: b.opening.blackOpening };
    location.hash = hashFor({
      kind: "branch",
      name: "Sukonbu3",
      key: b.positions[18]!,
      view,
      at: 19,
      pick: "1g1f",
      line: b.id,
    });
    render(<App />);
    const ply = async () =>
      (await screen.findByText(/開始局面|手目/, { selector: ".study-ply" })).textContent;
    expect(await ply()).toBe("19 手目 ▲1六歩");
    fireEvent.click(screen.getByRole("button", { name: "前の分岐点" }));
    expect(await ply()).toBe("18 手目 △5四歩");
    fireEvent.click(screen.getByRole("button", { name: "前の分岐点" }));
    expect(await ply()).toBe("7 手目 ▲7七角");
    expect(screen.getByRole("button", { name: "前の分岐点" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "次の分岐点" }));
    expect(await ply()).toBe("18 手目 △5四歩");
    fireEvent.click(screen.getByRole("button", { name: "次の分岐点" }));
    expect(await ply()).toBe("19 手目 ▲1六歩");
  });

  it("分岐点の学習画面: 相手の手番の分岐点では相手の候補手が並ぶ", async () => {
    const { b, b3 } = await seedBranches();
    await db.games.delete("b2b2b2");
    location.hash = hashFor({ kind: "branch", name: "Sukonbu3", key: b3.positions[19]! });
    render(<App />);
    const group = await screen.findByRole("group", { name: "相手の候補手" });
    expect(
      within(group)
        .getAllByRole("button")
        .map((x) => x.textContent),
    ).toEqual(["△1四歩 ×1 最善", "△9四歩 ×1 未解析"]);
    fireEvent.click(screen.getByRole("button", { name: "分岐点" }));
    expect((await screen.findByText(/手目/, { selector: ".study-ply" })).textContent).toBe(
      "19 手目 ▲1六歩",
    );
    expect(b.positions[19]).toBe(b3.positions[19]);
  });

  it("PlayerPage: 持ち時間別の表は末尾に残り、割合が出る", async () => {
    await seed();
    render(<PlayerPage name="Sukonbu3" />);
    await waitFor(() => expect(screen.getByText(/3 局 · 1 勝 2 敗/)).toBeInTheDocument());
    const pctOf = (n: number, d: number) => `${Math.round((n / d) * 100)}%`;
    const panel = screen.getByText("持ち時間別").closest(".panel")!;
    expect(panel.nextElementSibling).toBeNull();
    const table = panel.querySelector("table")!;
    const heads = Array.from(table.querySelectorAll("thead th")).map((th) => th.textContent);
    expect(heads).toEqual(["", "局", "勝", "敗", "勝率", "割合"]);
    let sum = 0;
    for (const tr of table.querySelectorAll("tbody tr")) {
      const games = Number(tr.children[1]!.textContent);
      sum += games;
      expect(tr.children[5]!.textContent).toBe(pctOf(games, 3));
    }
    expect(sum).toBe(3);
  });

  it("GameList: 戦型ポートフォリオの行の URL (古いリンク) は今も該当対局の一覧を出す", async () => {
    const { b, c } = await seed();
    const route = parseHash(
      hashFor({
        kind: "list",
        portfolio: {
          player: "Sukonbu3",
          condition: {
            side: "black",
            vsStyle: "ibisha",
            vsOpening: b.opening.whiteOpening,
            opening: b.opening.blackOpening,
            castle: b.opening.blackCastle,
          },
        },
      }),
    );
    if (route.kind !== "list" || !route.portfolio) throw new Error("unreachable");
    const portfolio = route.portfolio;
    render(<GameList portfolio={portfolio} />);
    const label = `${b.opening.blackOpening} + ${b.opening.blackCastle}`;
    const expected = [b, c].filter(
      (g) =>
        g.opening.whiteOpening === portfolio.condition.vsOpening &&
        `${g.opening.blackOpening} + ${g.opening.blackCastle}` === label,
    ).length;
    await waitFor(() =>
      expect(screen.getByText(new RegExp(`${expected} / 3 局`))).toBeInTheDocument(),
    );
    expect(screen.getByText(label)).toBeInTheDocument();
  });

  it("PlayerPage: 戦法 × 囲いの表は畳まれ、行から絞り込み済みの一覧へ飛ぶ", async () => {
    const { b } = await seed();
    render(<PlayerPage name="Sukonbu3" />);
    await waitFor(() => expect(screen.getByText("戦法 × 囲い")).toBeInTheDocument());
    const panel = screen.getByText("戦法 × 囲い").closest(".panel") as HTMLElement;
    const sections = Array.from(panel.querySelectorAll("details.combo")) as HTMLDetailsElement[];
    expect(sections.map((d) => d.querySelector("summary")!.textContent)).toEqual([
      expect.stringContaining("自分の戦法 × 囲い"),
      expect.stringContaining("攻め開始時の囲い"),
      expect.stringContaining("自分の戦法 × 相手の囲い"),
      expect.stringContaining("相手の囲い別"),
    ]);
    for (const d of sections) expect(d.open).toBe(false);
    // 攻め開始時の囲いは 3 局すべてを数える
    const maturityGames = Array.from(sections[1]!.querySelectorAll("tbody tr")).reduce(
      (n, tr) => n + Number(tr.children[1]!.textContent),
      0,
    );
    expect(maturityGames).toBe(3);

    const cases = [
      [
        sections[0]!,
        `${b.opening.blackOpening} × ${b.opening.blackCastle}`,
        {
          player: "Sukonbu3",
          opening: b.opening.blackOpening,
          openingSide: "self",
          castle: b.opening.blackCastle,
          castleSide: "self",
        },
      ],
      [
        sections[2]!,
        `${b.opening.blackOpening} × ${b.opening.whiteCastle}`,
        {
          player: "Sukonbu3",
          opening: b.opening.blackOpening,
          openingSide: "self",
          castle: b.opening.whiteCastle,
          castleSide: "opponent",
        },
      ],
      [
        sections[3]!,
        b.opening.whiteCastle,
        { player: "Sukonbu3", castle: b.opening.whiteCastle, castleSide: "opponent" },
      ],
    ] as const;
    for (const [section, label, query] of cases) {
      const link = within(section).getByRole("link", { name: label });
      fireEvent.click(link.closest("tr")!);
      expect(parseHash(location.hash)).toEqual({ kind: "list", query });
    }
    // 負け越している相手の囲いは目立たせる
    for (const tr of sections[3]!.querySelectorAll("tbody tr")) {
      const [, , w, l] = Array.from(tr.children).map((td) => Number(td.textContent));
      expect(tr.classList.contains("losing")).toBe(l! > w!);
    }
  });

  it("PlayerPage: 対局が無い人", async () => {
    render(<PlayerPage name="nobody" />);
    await waitFor(() => expect(screen.getByText(/nobody の対局がありません/)).toBeInTheDocument());
  });

  it("GameViewer: 解析があれば評価値グラフと悪手の印、解析つき KIF が出る", async () => {
    const { a } = await seed();
    const cps = [0, 10, 0, 20, 0, -400, -380, -400, 600, 580, 600, 620, 600, 610, 600];
    const analysis: AnalysisRecord = {
      schema: 1,
      id: a.id,
      engine: { name: "fake", depth: 1 },
      analyzedAt: "2026-01-01T00:00:00Z",
      plies: cps.map((cp, ply) =>
        ply === 7
          ? { ply, cp, best: "7a6b", pv: ["7a6b"] }
          : ply === 6
            ? { ply, cp, best: "2g2f", pv: ["2g2f"] }
            : { ply, cp },
      ),
    };
    await db.analyses.put(analysis);
    render(<GameViewer id={a.id} initialPly={8} />);
    await waitFor(() =>
      expect(screen.getByRole("img", { name: "評価値の推移" })).toBeInTheDocument(),
    );
    expect(screen.getByText("解析つき KIF をコピー")).toBeInTheDocument();
    expect(screen.getAllByText("??").length).toBeGreaterThan(0);
    expect(screen.getAllByText(/大悪手/).length).toBeGreaterThan(0);
    expect(screen.getByText(/-400 → \+600/)).toBeInTheDocument();
    // 最善手は USI ではなく符号で出る
    // 7 手目 (指した手 ▲7七角、最善 2g2f) に戻すと最善手が符号で出る
    fireEvent.click(screen.getByRole("button", { name: "◀" }));
    await waitFor(() => expect(screen.getByText(/7 手目/)).toBeInTheDocument());
    expect(screen.getAllByText(/最善 ▲2六歩/).length).toBeGreaterThan(0);
    expect(document.body.textContent).not.toContain("2g2f");
    expect(screen.getByText("平均損失とは")).toBeInTheDocument();
    expect(document.body.textContent).not.toContain("undefined");
  });

  it("PlayerPage: 解析があれば弱点プロファイルが出る", async () => {
    const { b } = await seed();
    const cps = Array.from({ length: 21 }, (_, i) => (i >= 15 ? -900 : 0));
    await db.analyses.put({
      schema: 1,
      id: b.id,
      engine: { name: "fake", depth: 1 },
      analyzedAt: "2026-01-01T00:00:00Z",
      plies: cps.map((cp, ply) => ({ ply, cp })),
    });
    render(<PlayerPage name="Sukonbu3" />);
    await waitFor(() => expect(screen.getByText("1/3 局")).toBeInTheDocument());
    expect(screen.getByText("痛かった手")).toBeInTheDocument();
    // レーダー: 7 軸。有利になった対局が無いので「有利を活かす」は欠けで、値のある軸だけ点を打つ
    const radar = screen.getByRole("img", { name: /レーダーチャート/ });
    const label = radar.getAttribute("aria-label")!;
    expect(label).toContain("有利を活かす なし");
    expect(label).toMatch(/序盤 \d+/);
    expect(label).toMatch(/粘り 100/);
    const valued = label.split("、").filter((a) => !a.endsWith("なし")).length;
    expect(radar.querySelectorAll("circle")).toHaveLength(valued);
    expect(screen.getByText("レーダーの見方")).toBeInTheDocument();
    expect(document.body.textContent).toContain("損失 0 で 100、300 以上で 0");
    // カードと重複する行 (解析済み局数の文、段階別の表、率のボタン列) は弱点プロファイルに出ない
    const weak = screen.getByText("弱点プロファイル").closest(".panel")!;
    expect(weak.textContent).not.toContain("解析済み");
    expect(weak.querySelector("table")?.textContent ?? "").not.toContain("段階");
    expect(screen.getByText("局面を開く")).toBeInTheDocument();
    // 痛かった手・分岐点は初期状態で閉じている
    expect(document.querySelectorAll("details.worst").length).toBeGreaterThan(0);
    expect(document.querySelector("details.worst[open], details.branch-more[open]")).toBeNull();
    // 平均損失の意味と目安
    expect(screen.getByText("平均損失とは")).toBeInTheDocument();
    expect(document.body.textContent).toContain("最善手を指した場合と比べて");
    expect(document.body.textContent).toContain("120 以上で疑問手");
    expect(document.body.textContent).not.toContain("undefined");
    expect(document.body.textContent).not.toContain("NaN");
  });

  it("PlayerPage: 率をタップすると内訳が開き、根拠の局面へ飛べる", async () => {
    const { b } = await seed();
    const cps = Array.from({ length: 21 }, (_, i) => (i >= 15 ? -900 : 0));
    await db.analyses.put({
      schema: 1,
      id: b.id,
      engine: { name: "fake", depth: 1 },
      analyzedAt: "2026-01-01T00:00:00Z",
      plies: cps.map((cp, ply) =>
        ply === 14 ? { ply, cp, best: "1g1f", pv: ["1g1f"] } : { ply, cp },
      ),
    });
    render(<PlayerPage name="Sukonbu3" />);
    await waitFor(() => expect(screen.getByText("1/3 局")).toBeInTheDocument());
    expect(document.querySelector(".rate-breakdown")).toBeNull();

    // 内訳が 0 件の率 (有利になった対局が無い) は「-」のまま開いても壊れない
    const conversion = screen.getByRole("button", { name: /有利を活かす/ });
    expect(conversion).toHaveTextContent("-");
    fireEvent.click(conversion);
    expect(conversion).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("該当する対局はまだありません")).toBeInTheDocument();

    // 先に大悪手: 15 手目の本人の大悪手。指す前の 14 手目を指す
    fireEvent.click(screen.getByRole("button", { name: /先に崩れない/ }));
    expect(conversion).toHaveAttribute("aria-expanded", "false");
    const rows = document.querySelectorAll("details.rate-row");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toHaveTextContent("14手目");
    expect(rows[0]).toHaveTextContent("自分が先");
    // 盤面は開いたときだけ出す
    expect(rows[0]!.querySelector("svg.board")).toBeNull();
    (rows[0] as HTMLDetailsElement).open = true;
    fireEvent(rows[0]!, new Event("toggle"));
    await waitFor(() => expect(rows[0]!.querySelector("svg.board")).not.toBeNull());
    expect(rows[0]).toHaveTextContent("自分の大悪手");
    expect(rows[0]).toHaveTextContent("最善 ▲1六歩");
    fireEvent.click(within(rows[0] as HTMLElement).getByRole("button", { name: "局面を開く" }));
    expect(location.hash).toBe(`#/game/${b.id}/14`);

    // 不利から負けなかった率: 初めて -300 以下になった 15 手目
    fireEvent.click(screen.getByRole("button", { name: /粘り/ }));
    expect(document.querySelectorAll("details.rate-row")[0]).toHaveTextContent("15手目");
    expect(document.body.textContent).not.toContain("undefined");
  });
});
