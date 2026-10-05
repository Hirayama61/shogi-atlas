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
    include: ["src/**/*.test.ts", "scripts/**/*.test.ts"],
  },
});
