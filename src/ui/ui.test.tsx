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
    await waitFor(() => expect(screen.getByText("採用戦法")).toBeInTheDocument());
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
    expect(screen.getByText("相手の戦法別")).toBeInTheDocument();
    expect(document.body.textContent).not.toContain("undefined");
  });

  it("PlayerPage: 全対局の一覧は出さず、局数のタイルからその人で絞った棋譜一覧へ飛ぶ", async () => {
    await seed();
    render(<PlayerPage name="Sukonbu3" />);
    await waitFor(() => expect(screen.getByText("採用戦法")).toBeInTheDocument());
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

  it("PlayerPage: 戦法・囲い・相手の戦法の行から絞り込み済みの一覧へ飛ぶ", async () => {
    const { b } = await seed();
    render(<PlayerPage name="Sukonbu3" />);
    await waitFor(() => expect(screen.getByText(/3 局 · 1 勝 2 敗/)).toBeInTheDocument());
    const table = (title: string) => screen.getByText(title).closest(".panel") as HTMLElement;
    const cases = [
      ["採用戦法", "opening", b.opening.blackOpening],
      ["囲い", "castle", b.opening.blackCastle],
      ["相手の戦法別", "vsOpening", b.opening.whiteOpening],
    ] as const;
    for (const [title, field, value] of cases) {
      const link = within(table(title)).getByRole("link", { name: value });
      const route = { kind: "list" as const, query: fieldQuery("Sukonbu3", field, value) };
      expect(link).toHaveAttribute("href", hashFor(route));
      fireEvent.click(link.closest("tr")!);
      expect(parseHash(location.hash)).toEqual(route);
    }
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

  it("PlayerPage: 分岐点は 1 件 1 行で入れ子が無く、戦法・手数・局数・候補手と判定が出て、悪手が先", async () => {
    const { b, b2 } = await seedBranches();
    await db.games.delete("b3b3b3");
    render(<PlayerPage name="Sukonbu3" />);
    await waitFor(() => expect(document.querySelector(".branch-row.mistake")).not.toBeNull());
    const panel = screen
      .getByText("分岐点", { selector: "strong" })
      .closest(".panel") as HTMLElement;
    expect(panel.querySelector("details")).toBeNull();
    const rows = Array.from(panel.querySelectorAll<HTMLAnchorElement>("a.branch-row"));
    expect(rows[0]!.classList.contains("mistake")).toBe(true);
    const text = rows[0]!.textContent ?? "";
    expect(text).toContain(`${b.opening.blackOpening} · 18 手目 · 2 局`);
    expect(text).toContain("本人: ▲1六歩 (最善) / ▲9六歩 (悪手 · 損失 400 · 最善 ▲1六歩)");
    expect(parseHash(rows[0]!.getAttribute("href")!)).toEqual({
      kind: "branch",
      name: "Sukonbu3",
      key: b2.positions[18],
    });
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

  it("PlayerPage: 戦法・囲い・持ち時間の表と戦型ポートフォリオに割合が出る", async () => {
    const { b } = await seed();
    render(<PlayerPage name="Sukonbu3" />);
    await waitFor(() => expect(screen.getByText(/3 局 · 1 勝 2 敗/)).toBeInTheDocument());
    const pctOf = (n: number, d: number) => `${Math.round((n / d) * 100)}%`;
    // 各表: 見出しの最後が「割合」で、値は 局 / 本人の全対局 (3 局)。合計は 3 局
    for (const title of ["採用戦法", "囲い", "相手の戦法別", "持ち時間別"]) {
      const table = screen.getByText(title).closest(".panel")!.querySelector("table")!;
      const heads = Array.from(table.querySelectorAll("thead th")).map((th) => th.textContent);
      expect(heads).toEqual(["", "局", "勝", "敗", "勝率", "割合"]);
      let sum = 0;
      for (const tr of table.querySelectorAll("tbody tr")) {
        const games = Number(tr.children[1]!.textContent);
        sum += games;
        expect(tr.children[5]!.textContent).toBe(pctOf(games, 3));
      }
      expect(sum).toBe(3);
    }
    const opening = within(screen.getByText("採用戦法").closest(".panel") as HTMLElement)
      .getByRole("link", { name: b.opening.blackOpening })
      .closest("tr")!;
    expect(opening.children[5]!.textContent).toBe(
      pctOf(Number(opening.children[1]!.textContent), 3),
    );

    const panel = screen.getByText("戦型ポートフォリオ").closest(".panel") as HTMLElement;
    // グループの割合はその先後の対局 (カードの「先手 n 局」「後手 m 局」) に対する割合
    const figures = document.querySelector(".profile-card .figures")!.textContent!;
    const [, black] = /先手 (\d+) 局/.exec(figures)!;
    const [, white] = /後手 (\d+) 局/.exec(figures)!;
    const sideGames = { 先手: Number(black), 後手: Number(white) };
    for (const g of panel.querySelectorAll("details.portfolio")) {
      const summary = g.querySelector("summary")!.textContent!;
      const games = Number(/(\d+) 局/.exec(summary)![1]);
      const side = summary.includes("先手") ? "先手" : "後手";
      expect(summary).toContain(`割合 ${pctOf(games, sideGames[side])}`);
      // 相手の戦法ごと: グループ内の割合。応手の各行: その相手の戦法の対局に対する割合
      for (const block of g.querySelectorAll(".portfolio-opponent")) {
        const head = block.querySelector(".muted")!.textContent!;
        const oppGames = Number(/(\d+) 局/.exec(head)![1]);
        expect(head).toContain(`割合 ${pctOf(oppGames, games)}`);
        const heads = Array.from(block.querySelectorAll("thead th")).map((th) => th.textContent);
        expect(heads.at(-1)).toBe("割合");
        for (const tr of block.querySelectorAll("tbody tr")) {
          const n = Number(tr.children[1]!.textContent);
          expect(tr.children[5]!.textContent).toBe(pctOf(n, oppGames));
        }
      }
    }
  });

  it("PlayerPage: 戦型ポートフォリオは条件ごとに畳まれ、行から該当対局の一覧へ飛ぶ", async () => {
    const { b, c } = await seed();
    render(<PlayerPage name="Sukonbu3" />);
    await waitFor(() => expect(screen.getByText("戦型ポートフォリオ")).toBeInTheDocument());
    const panel = screen.getByText("戦型ポートフォリオ").closest(".panel") as HTMLElement;
    const groups = panel.querySelectorAll("details.portfolio");
    expect(groups.length).toBeGreaterThan(0);
    for (const g of groups) expect((g as HTMLDetailsElement).open).toBe(false);
    // 先手の 2 局 (b, c) と後手の 1 局 (a) がすべて入る
    const total = Array.from(groups).reduce(
      (n, g) => n + Number(/(\d+) 局/.exec(g.querySelector("summary")!.textContent!)![1]),
      0,
    );
    expect(total).toBe(3);

    const label = `${b.opening.blackOpening} + ${b.opening.blackCastle}`;
    const link = within(panel).getAllByRole("link", { name: label })[0]!;
    fireEvent.click(link.closest("tr")!);
    const route = parseHash(location.hash);
    expect(route).toMatchObject({
      kind: "list",
      portfolio: {
        player: "Sukonbu3",
        condition: { side: "black", opening: b.opening.blackOpening },
      },
    });
    cleanup();
    if (route.kind !== "list" || !route.portfolio) throw new Error("unreachable");
    const portfolio = route.portfolio;
    render(<GameList portfolio={portfolio} />);
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
