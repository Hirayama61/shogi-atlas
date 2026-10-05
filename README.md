# shogi-atlas

自分用の将棋棋譜アトラス。集めた棋譜を戦型で分類し、局面単位で横断検索できる PWA。

- アプリ本体 (このリポジトリ): GitHub Pages で公開。棋譜データは含まない。
- 棋譜データ: 非公開の [shogi-atlas-data](https://github.com/Hirayama61/shogi-atlas-data)。Issue に KIF を貼ると自動で取り込まれる。
- 取得は手動。将棋ウォーズの「棋譜コピー」を Issue かアプリに貼り付ける。

## 開発

```
pnpm install
pnpm dev
pnpm check
```

機能追加は Issue 駆動。やりたいことを Issue (`ready` ラベル) にしておくと、2 時間おきのルーティンが 1 件ずつ拾って実装し `main` に push する。
詳細は [CLAUDE.md](./CLAUDE.md)。
