import { defineConfig } from "@playwright/test";

/**
 * ビルド済みの dist を vite preview で配信し、GitHub API はモックして一通りの画面を通す。
 *   pnpm build && pnpm e2e
 */
export default defineConfig({
  testDir: "e2e",
  timeout: 30_000,
  retries: process.env.CI ? 1 : 0,
  use: {
    baseURL: "http://localhost:4173/shogi-atlas/",
    viewport: { width: 420, height: 900 },
    trace: "retain-on-failure",
  },
  webServer: {
    command: "pnpm vite preview --port 4173 --strictPort",
    url: "http://localhost:4173/shogi-atlas/",
    // 古い preview サーバーを掴まないよう、毎回立ち上げ直す
    reuseExistingServer: false,
  },
  projects: [{ name: "chromium", use: { browserName: "chromium" } }],
});
