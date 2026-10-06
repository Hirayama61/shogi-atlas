import { describe, expect, it } from "vitest";
import { CHANGELOG, LATEST_UPDATE } from "./changelog";

describe("changelog", () => {
  it("新しい順に並び、日付は YYYY-MM-DD", () => {
    expect(CHANGELOG.length).toBeGreaterThan(0);
    for (const e of CHANGELOG) {
      expect(e.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(e.title.trim()).not.toBe("");
      for (const d of e.details ?? []) expect(d.trim()).not.toBe("");
    }
    for (let i = 1; i < CHANGELOG.length; i++) {
      expect(CHANGELOG[i - 1]!.date >= CHANGELOG[i]!.date).toBe(true);
    }
    expect(LATEST_UPDATE).toBe(CHANGELOG[0]!.date);
  });
});
