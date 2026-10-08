import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

// GitHub Pages のプロジェクトサイト (https://<user>.github.io/shogi-atlas/) 用。
// カスタムドメインに移す場合は VITE_BASE=/ を指定する。
const base = process.env.VITE_BASE ?? "/shogi-atlas/";

export default defineConfig({
  base,
  plugins: [
    react(),
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["icon.svg", "apple-touch-icon.png"],
      manifest: {
        name: "Atlas",
        short_name: "Atlas",
        description: "自分用の棋譜アトラス",
        lang: "ja",
        start_url: base,
        scope: base,
        display: "standalone",
        background_color: "#1c1917",
        theme_color: "#1c1917",
        icons: [
          { src: "pwa-192.png", sizes: "192x192", type: "image/png" },
          { src: "pwa-512.png", sizes: "512x512", type: "image/png" },
          { src: "pwa-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
        ],
      },
      workbox: {
        globPatterns: ["**/*.{js,css,html,svg,png,woff2}"],
        // GitHub API への問い合わせはキャッシュしない (トークン付きのため)
        navigateFallbackDenylist: [/^\/api\//],
      },
    }),
  ],
  test: {
    include: ["src/**/*.test.{ts,tsx}", "scripts/**/*.test.ts"],
    // 画面・DB・同期のテストはファイル先頭の `// @vitest-environment jsdom` で jsdom に切り替える
    setupFiles: ["src/test/setup.ts"],
    // 余白のテストが index.css を ?raw で読む。既定では CSS は空文字に置き換わる
    css: { include: [/index\.css/] },
    coverage: {
      provider: "v8",
      include: ["src/**/*.{ts,tsx}", "scripts/**/*.ts"],
      exclude: ["src/**/*.test.*", "src/test/**", "src/main.tsx"],
    },
  },
});
