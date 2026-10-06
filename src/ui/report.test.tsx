// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { fixtureReport, USI_SHIKEN_VS_FUNA, WARS_KIF } from "../core/__tests__/fixtures";
import { parseKifu } from "../core/parse";
import { db } from "../db/db";
import { PlayerList } from "./PlayerList";
import { PlayerPage } from "./PlayerPage";

const source = { kind: "paste" as const };

async function seed() {
  const a = await parseKifu(USI_SHIKEN_VS_FUNA, { source });
  const b = await parseKifu(WARS_KIF, { source });
  Object.assign(a, { black: "taro", white: "x1", result: "black", tags: ["taro"] });
  Object.assign(b, { black: "x2", white: "jiro", tags: ["jiro"] });
  await db.games.bulkPut([a, b]);
  return a;
}

async function putReport(name: string, markdown: string, hash = "h1") {
  await db.reports.put({ name, markdown, hash, fetchedAt: "2026-10-06T00:00:00Z" });
}

function open(details: Element) {
  (details as HTMLDetailsElement).open = true;
  details.dispatchEvent(new Event("toggle"));
}

describe("対策レポート", () => {
  beforeEach(async () => {
    await db.games.clear();
    await db.reports.clear();
    localStorage.clear();
    location.hash = "";
  });
  afterEach(cleanup);

  it("対局者ページに要点と全文が畳んで出て、HTML は描画しない", async () => {
    const a = await seed();
    await putReport("taro", fixtureReport("taro", a.id));
    render(<PlayerPage name="taro" />);
    await waitFor(() => expect(screen.getByText("対策レポート")).toBeInTheDocument());
    const parts = document.querySelectorAll("details.report-part");
    expect([...parts].map((d) => d.querySelector("summary")?.textContent)).toEqual([
      "対策の要点",
      "全文",
    ]);
    expect(document.querySelector("details.report-part[open]")).toBeNull();
    const digest = parts[0]!.textContent ?? "";
    expect(digest).toContain("四間飛車党");
    expect(digest).toContain("こちらが先手 (taro が後手)");
    expect(digest).toContain("居飛車穴熊にする。");
    expect(digest).not.toContain("急戦は避ける");
    expect(digest).not.toContain("痛かった手");
    expect(parts[1]!.textContent).toContain("痛かった手");
    // 生 HTML は文字のまま
    expect(parts[1]!.textContent).toContain("<b>四間飛車</b>");
    expect(document.querySelector(".report-body b")).toBeNull();
  });

  it("痛かった手の行から、その対局のその手数 (指す前の局面) へ飛べる", async () => {
    const a = await seed();
    await putReport("taro", fixtureReport("taro", a.id));
    render(<PlayerPage name="taro" />);
    await waitFor(() => expect(screen.getByText("全文")).toBeInTheDocument());
    const links = [...document.querySelectorAll<HTMLAnchorElement>("a.game-ref")];
    expect(links.map((l) => [l.textContent, l.getAttribute("href")])).toEqual([
      [`${a.id} 15手目`, `#/game/${a.id}/14`],
      [`${a.id.slice(0, 6)} 21手目`, `#/game/${a.id}/20`],
    ]);
  });

  it("本人の対局に無い ID はリンクにしない", async () => {
    await seed();
    await putReport("taro", fixtureReport("taro", "0123456789abcdef"));
    render(<PlayerPage name="taro" />);
    await waitFor(() => expect(screen.getByText("全文")).toBeInTheDocument());
    expect(document.querySelectorAll("a.game-ref")).toHaveLength(0);
  });

  it("更新されると印が付き、開くと消える。一覧にも出る", async () => {
    const a = await seed();
    await putReport("taro", fixtureReport("taro", a.id));
    const list = render(<PlayerList />);
    await waitFor(() => expect(screen.getByText("新しいレポート")).toBeInTheDocument());
    list.unmount();

    render(<PlayerPage name="taro" />);
    await waitFor(() => expect(screen.getByText("新しいレポート")).toBeInTheDocument());
    open(document.querySelectorAll("details.report-part")[1]!);
    await waitFor(() => expect(screen.queryByText("新しいレポート")).not.toBeInTheDocument());
    cleanup();

    render(<PlayerList />);
    await waitFor(() => expect(screen.getByText("taro")).toBeInTheDocument());
    expect(screen.queryByText("新しいレポート")).not.toBeInTheDocument();
    cleanup();

    // 本文が変わったら、また印が付く
    await putReport("taro", fixtureReport("taro", a.id) + "\n追記", "h2");
    render(<PlayerPage name="taro" />);
    await waitFor(() => expect(screen.getByText("新しいレポート")).toBeInTheDocument());
  });

  it("レポートが無い人のページには何も出ない", async () => {
    await seed();
    await putReport("taro", fixtureReport("taro", "x"));
    render(<PlayerPage name="jiro" />);
    await waitFor(() => expect(screen.getByText("採用戦法")).toBeInTheDocument());
    expect(screen.queryByText("対策レポート")).not.toBeInTheDocument();
    expect(document.querySelector("details.report-part")).toBeNull();
  });
});
