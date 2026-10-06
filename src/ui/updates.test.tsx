// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import App from "../App";
import { CHANGELOG, hasUnseenUpdates, markUpdatesSeen } from "../changelog";
import { UpdatesPane } from "./UpdatesPane";
import { parseHash } from "./router";

describe("更新情報", () => {
  beforeEach(() => {
    localStorage.clear();
    location.hash = "";
  });
  afterEach(cleanup);

  it("router: #/updates を解釈する", () => {
    expect(parseHash("#/updates")).toEqual({ kind: "updates" });
  });

  it("UpdatesPane: 追加した機能が新しい順に出て、開くと既読になる", () => {
    expect(hasUnseenUpdates()).toBe(true);
    render(<UpdatesPane />);
    expect(screen.getByRole("heading", { name: "更新情報" })).toBeInTheDocument();
    const titles = screen.getAllByRole("strong").map((el) => el.textContent);
    expect(titles).toEqual(CHANGELOG.map((e) => e.title));
    expect(screen.getAllByText(CHANGELOG[0]!.date).length).toBeGreaterThan(0);
    expect(hasUnseenUpdates()).toBe(false);
  });

  it("App: 未読があるとタブに印が付き、開くと消える", () => {
    render(<App />);
    const tab = screen.getByRole("button", { name: /更新情報/ });
    expect(screen.getByLabelText("未読の更新あり")).toBeInTheDocument();
    fireEvent.click(tab);
    expect(location.hash).toBe("#/updates");
    // hashchange は jsdom では非同期なので、表示まで待つ
    return screen.findByRole("heading", { name: "更新情報" }).then(() => {
      expect(screen.queryByLabelText("未読の更新あり")).not.toBeInTheDocument();
    });
  });

  it("既読なら最初から印が付かない", () => {
    markUpdatesSeen();
    render(<App />);
    expect(screen.queryByLabelText("未読の更新あり")).not.toBeInTheDocument();
  });
});
