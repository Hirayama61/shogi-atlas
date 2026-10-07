/** 将棋ウォーズのブラウザ版「棋譜コピー」相当の形式 (手数は短縮) */
export const WARS_KIF = `開始日時：2024/06/17 10:05:15
終了日時：2024/06/17 10:09:48
棋戦：将棋ウォーズ(10分)
手合割：平手
先手：Sukonbu3 二段
後手：nemushi_ 1級
場所：将棋ウォーズ
手数----指手---------消費時間--
   1 ７六歩(77)   ( 0:01/00:00:01)
   2 ３四歩(33)   ( 0:01/00:00:01)
   3 ６六歩(67)   ( 0:01/00:00:02)
   4 ８四歩(83)   ( 0:01/00:00:02)
   5 ６八飛(28)   ( 0:01/00:00:03)
   6 ８五歩(84)   ( 0:01/00:00:03)
   7 ７七角(88)   ( 0:01/00:00:04)
   8 ６二銀(71)   ( 0:01/00:00:04)
   9 ４八玉(59)   ( 0:01/00:00:05)
  10 ４二玉(51)   ( 0:01/00:00:05)
  11 ３八玉(48)   ( 0:01/00:00:06)
  12 ３二玉(42)   ( 0:01/00:00:06)
  13 ２八玉(38)   ( 0:01/00:00:07)
  14 ５四歩(53)   ( 0:01/00:00:07)
  15 投了         ( 0:00/00:00:07)
まで14手で後手の勝ち
`;

export const AI_IBISHA_KIF = `先手：alice
後手：bob
手数----指手---------消費時間--
   1 ７六歩(77)
   2 ８四歩(83)
   3 ２六歩(27)
   4 ８五歩(84)
   5 ７七角(88)
   6 ３四歩(33)
   7 ６八銀(79)
   8 ３二金(41)
   9 ７八金(69)
  10 ７七角成(22)
  11 同　銀(68)
  12 ２二銀(31)
  13 ４八銀(39)
  14 ６二銀(71)
  15 詰み
`;

export const USI_LINE = "position startpos moves 7g7f 3c3d 2g2f 8c8d 2f2e 8d8e";

/** 将棋ウォーズのアプリ「棋譜コピー」が出す CSA 形式 (手数は短縮) */
export const WARS_CSA = `V2.2
N+doukeinari 5段
N-maedahide 5段
$EVENT:将棋ウォーズ(10分切れ負け)
$START_TIME:2026/10/05 23:52:45
P1-KY-KE-GI-KI-OU-KI-GI-KE-KY
P2 * -HI *  *  *  *  * -KA * 
P3-FU-FU-FU-FU-FU-FU-FU-FU-FU
P4 *  *  *  *  *  *  *  *  * 
P5 *  *  *  *  *  *  *  *  * 
P6 *  *  *  *  *  *  *  *  * 
P7+FU+FU+FU+FU+FU+FU+FU+FU+FU
P8 * +KA *  *  *  *  * +HI * 
P9+KY+KE+GI+KI+OU+KI+GI+KE+KY
+
+7776FU
-3334FU
+2726FU
-4344FU
+2625FU
-8242HI
+2524FU
-2324FU
+2824HI
-2233KA
+2434HI
-3324KA
%TIME_UP
`;

// 以下は戦法・囲い判定用の USI 手順 (合法手であることはテストで確認する)

/** ☗四間飛車 + 本美濃 vs ☖居飛車 + 舟囲い */
export const USI_SHIKEN_VS_FUNA =
  "position startpos moves 7g7f 8c8d 6g6f 3c3d 2h6h 8d8e 8h7g 5a4b 5i4h 4b3b 4h3h 6a5b 3h2h 3a4b 3i3h 7a6b 6i5h 5c5d 1g1f 1c1d";

/** 角換わり (相居飛車) */
export const USI_KAKUGAWARI =
  "position startpos moves 7g7f 8c8d 2g2f 4a3b 8h7g 3c3d 7i6h 2b7g+ 6h7g 3a2b 3i4h 7a6b 6i7h 6a5b";

/** ☗四間飛車: 6筋の歩交換 (20 手目が最初の駒交換) のあとで角交換になる。角交換型ではない */
export const USI_SHIKEN_LATE_KAKU =
  "position startpos moves 7g7f 8c8d 6g6f 3c3d 2h6h 8d8e 8h7g 7a6b 5i4h 5a4b 4h3h 4b3b 3h2h 6a5b 3i3h 5c5d 6f6e 1c1d 6e6d 6c6d 6h6d P*6c 6d6h 9c9d 7g2b+ 3a2b";

/** ☗角交換四間飛車: 3 手目に角交換してから四間に振る */
export const USI_KAKU_SHIKEN =
  "position startpos moves 7g7f 3c3d 8h2b+ 3a2b 2h6h 8c8d 5i4h 8d8e 4h3h 5a4b 3h2h 4b3b 3i3h 7a6b 7i7h 6a5b 1g1f 1c1d";

/** 相掛かり: 飛車先の歩交換 (8 手目が最初の駒交換) のあとで角交換になる。角換わりではない */
export const USI_AIGAKARI_LATE_KAKU =
  "position startpos moves 2g2f 8c8d 2f2e 8d8e 6i7h 4a3b 2e2d 2c2d 2h2d P*2c 2d2f 8e8f 8g8f 8b8f P*8g 8f8d 7g7f 3c3d 8h2b+ 3a2b";

/** ☗早石田: 3 手目に 7五歩、5 手目に 7八飛。8 手目に角交換になる */
export const USI_HAYAISHIDA =
  "position startpos moves 7g7f 3c3d 7f7e 8c8d 2h7h 8d8e 5i4h 2b8h+ 7i8h 3a2b 4h3h 5a4b 3h2h 4b3b 3i3h 7a6b";

/** 横歩取り (相居飛車) */
export const USI_YOKOFU =
  "position startpos moves 7g7f 3c3d 2g2f 8c8d 2f2e 8d8e 6i7h 4a3b 2e2d 2c2d 2h2d 8e8f 8g8f 8b8f 2d3d 2b3c";

/** ☗居飛車穴熊 vs ☖四間飛車 + 本美濃 */
export const USI_ANAGUMA_VS_SHIKEN =
  "position startpos moves 7g7f 3c3d 8h7g 4c4d 5i6h 8b4b 6h7h 5a6b 9i9h 6b7b 7h8h 7b8b 8h9i 7a7b 7i8h 4a5b 6i7i 9c9d 4i5h 1c1d";

/** ☗右玉 (3八玉・4八銀・5八金) */
export const USI_MIGIGYOKU =
  "position startpos moves 7g7f 8c8d 2g2f 8d8e 5i4h 3c3d 4h3h 4a3b 3i4h 7a6b 4i5h 5a4b 6i6h 6a5b";

/** 囲いが何にも当てはまらない (☗6八玉だけ、☖は居玉) */
export const USI_NO_CASTLE =
  "position startpos moves 7g7f 3c3d 5i6h 8c8d 1g1f 1c1d 9g9f 9c9d 2g2f 8d8e 3g3f 4c4d";

/** ☖ゴキゲン中飛車: 角道を開けたまま 5四歩・5二飛 (6 手目) */
export const USI_GOKIGEN =
  "position startpos moves 7g7f 3c3d 2g2f 5c5d 2f2e 8b5b 5i6h 5a6b 6h7h 6b7b 3i4h 7b8b 9g9f 7a7b";

/** ☗先手中飛車: 5六歩・5八飛 */
export const USI_SENTE_NAKABISHA =
  "position startpos moves 5g5f 8c8d 2h5h 3c3d 5i4h 5a4b 4h3h 4b3b 3h2h 7a6b 3i3h 6a5b";

/** ☗ノーマル三間飛車: 6六歩で角道を止めて 7八飛 */
export const USI_NORMAL_SANKEN =
  "position startpos moves 7g7f 8c8d 6g6f 3c3d 2h7h 8d8e 8h7g 5a4b 5i4h 4b3b 4h3h 6a5b 3h2h 7a6b 3i3h 5c5d";

/** ☗石田流本組: 7五歩 (11 手目なので早石田ではない)・7六飛・7七桂 */
export const USI_ISHIDA_HONGUMI =
  "position startpos moves 7g7f 3c3d 2h7h 8c8d 5i4h 5a4b 4h3h 4b3b 3h2h 7a6b 7f7e 6a5b 7h7f 5c5d 8i7g 1c1d 3i3h 9c9d";

/** ☗ダイレクト向かい飛車: 3 手目に角交換して 8八飛、7七銀 */
export const USI_DIRECT_MUKAI =
  "position startpos moves 7g7f 3c3d 8h2b+ 3a2b 2h8h 8c8d 7i7h 5a4b 7h7g 4b3b 5i4h 7a6b 4h3h 6a5b";

/** ☗阪田流向かい飛車: 角交換して 7七金・8八飛、☖は 8五歩 */
export const USI_SAKATA_MUKAI =
  "position startpos moves 7g7f 3c3d 8h2b+ 3a2b 6i7h 8c8d 7h7g 8d8e 2h8h 5a4b 5i4h 4b3b 4h3h 7a6b";

/** 角換わり棒銀 (☗の銀が 3八 → 2七 → 2六) */
export const USI_KAKU_BOGIN =
  "position startpos moves 7g7f 8c8d 2g2f 4a3b 8h7g 3c3d 7i6h 2b7g+ 6h7g 3a2b 3i3h 7a6b 6i7h 6a5b 2f2e 5a4b 3h2g 1c1d 2g2f 9c9d";

/** 角換わり早繰り銀 (☗の銀が 4八 → 3七 → 4六) */
export const USI_KAKU_HAYAKURI =
  "position startpos moves 7g7f 8c8d 2g2f 4a3b 8h7g 3c3d 7i6h 2b7g+ 6h7g 3a2b 3i4h 7a6b 6i7h 6a5b 3g3f 5a4b 4h3g 1c1d 3g4f 9c9d";

/** 角換わり腰掛け銀 (☗の銀が 4八 → 4七 → 5六) */
export const USI_KAKU_KOSHIKAKE =
  "position startpos moves 7g7f 8c8d 2g2f 4a3b 8h7g 3c3d 7i6h 2b7g+ 6h7g 3a2b 3i4h 7a6b 6i7h 6a5b 4g4f 5a4b 4h4g 1c1d 4g5f 9c9d";

/** ☖一手損角換わり: ☖が 2二の角で 8八の角を直接取る */
export const USI_ITTEZON =
  "position startpos moves 7g7f 3c3d 2g2f 2b8h+ 7i8h 3a2b 2f2e 8c8d 8h7g 7a6b 3i4h 6a5b 6i7h 5a4b";

/** 将棋クエストの「棋譜ダウンロード」が出す KIF (手数は短縮)。レート付きの名前、開始日時なし、終局は「時間切れ」 */
export const QUEST_KIF_TIMEOUT = `棋戦：Shogi Quest
手合割：平手
先手：alice(1605)
後手：bob(1480)
手数----指手---------消費時間--
1 ７六歩(77)  ( 0:01/00:00:01)
2 ３四歩(33)  ( 0:02/00:00:02)
3 ２六歩(27)  ( 0:01/00:00:02)
4 ８四歩(83)  ( 0:01/00:00:03)
5 時間切れ  ( 9:57/00:09:59)
`;

/** 将棋クエストの「接続切れ」。手番側 (後手) の負け */
export const QUEST_KIF_DISCONNECT = `棋戦：Shogi Quest
手合割：平手
先手：alice(1605)
後手：bob(1480)
手数----指手---------消費時間--
1 ７六歩(77)  ( 0:01/00:00:01)
2 ３四歩(33)  ( 0:02/00:00:02)
3 ２六歩(27)  ( 0:01/00:00:02)
4 接続切れ  ( 0:13/00:00:15)
`;

/** 終局行の無い詰み。後手玉が５一、先手の金を５二に打って歩で支えた形 */
export const USI_MATE_NO_TERMINAL = "position sfen 4k4/9/4P4/9/9/9/9/9/4K4 b G 1 moves G*5b";

/** 王手はかかっているが詰んでいない (玉が逃げられる) */
export const USI_CHECK_NOT_MATE = "position sfen 4k4/9/9/9/9/9/9/9/4K4 b G 1 moves G*5b";

/** トライルール: 先手玉が５二から５一 (後手玉の初期位置) に入る。終局行なし */
export const USI_TRY_BLACK = "position sfen 9/4K4/9/9/9/9/9/9/8k b - 1 moves 5b5a";

/** 後手玉が５八から５九に入るトライ */
export const USI_TRY_WHITE = "position sfen K8/9/9/9/9/9/9/4k4/9 w - 1 moves 5h5i";

/** ５一以外への玉の移動は終局扱いしない */
export const USI_KING_MOVE_NOT_TRY = "position sfen 9/4K4/9/9/9/9/9/9/8k b - 1 moves 5b4a";

/** 架空の対策レポート。gameId に対局 ID を入れると「痛かった手」の行がその対局を指す */
export function fixtureReport(name: string, gameId: string): string {
  return `# ${name} 対策レポート

作成日 2026-10-05 (初回)。解析済み 2 局。

## 1. 一言でいうとどういう相手か

- 四間飛車党。序盤は手堅く、終盤で崩れる。
  - 先手でも後手でも <b>四間飛車</b> を指す。

## 2. こちらが採るべき作戦

### こちらが先手 (${name} が後手)

- 居飛車穴熊にする。
- 急戦は避ける。

### こちらが後手 (${name} が先手)

- 角交換を狙う。

## 3. 狙いどころ

### 痛かった手

1. **${gameId} 15手目 ▲1六歩** (最善 ▲1八香)。評価値 0 → −900。
   sfen \`lnsgkgsnl/1r5b1/ppppppppp/9/9/9/PPPPPPPPP/1B5R1/LNSGKGSNL b - 1\`

2. **${gameId.slice(0, 6)} 21手目 ▲3八銀** (最善 ▲4八銀)。

---

根拠: 架空のレポート
`;
}

/** 冒頭に「## 要点」の節がある形 (write-reports の今の出力構成) */
export function fixtureReportWithSummary(name: string, gameId: string): string {
  return fixtureReport(name, gameId).replace(
    "## 1. 一言でいうとどういう相手か",
    `## 要点

- 終盤で崩れる四間飛車党。
- こちらが先手: 穴熊に組んで長期戦にする。
- こちらが後手: 角交換で乱戦にする。

---

## 1. 一言でいうとどういう相手か`,
  );
}

// 対抗形の居飛車側 (☗居飛車 vs ☖ノーマル四間飛車)

/** ☗斜め棒銀: 舟囲いから 5七銀左・4六銀 */
export const USI_NANAME_BOGIN =
  "position startpos moves 7g7f 3c3d 2g2f 4c4d 5i6h 8b4b 6h7h 5a6b 4i5h 6b7b 7i6h 7b8b 6h5g 7a7b 2f2e 9c9d 5g4f 1c1d";

/** ☗4五歩早仕掛け: 舟囲いから 3六歩・4六歩・3七桂・4五歩 */
export const USI_45FU_HAYASHIKAKE =
  "position startpos moves 7g7f 3c3d 2g2f 4c4d 5i6h 8b4b 6h7h 5a6b 4i5h 6b7b 7i6h 7b8b 3g3f 7a7b 4g4f 9c9d 2i3g 1c1d 4f4e 6a5b";

/** ☗対振り棒銀: 舟囲いから 3八銀・2七銀・2六銀 */
export const USI_TAIFURI_BOGIN =
  "position startpos moves 7g7f 3c3d 2g2f 4c4d 5i6h 8b4b 6h7h 5a6b 4i5h 6b7b 2f2e 7b8b 3i3h 7a7b 3h2g 9c9d 2g2f 1c1d 7i6h 6a5b";

/** ☗舟囲い急戦: 舟囲いから 3六歩・4六歩 (仕掛けの形は決まっていない) */
export const USI_FUNA_KYUSEN =
  "position startpos moves 7g7f 3c3d 2g2f 4c4d 5i6h 8b4b 6h7h 5a6b 4i5h 6b7b 7i6h 7b8b 3g3f 7a7b 4g4f 9c9d 3i4h 1c1d 2f2e 6a5b";

/** ☗へなちょこ急戦: 6八玉のまま 3六歩・3七銀・4六銀 */
export const USI_HENACHOKO =
  "position startpos moves 7g7f 3c3d 2g2f 4c4d 5i6h 8b4b 4i5h 5a6b 3g3f 6b7b 3i4h 7b8b 4h3g 7a7b 3g4f 9c9d 2f2e 1c1d 6i7h 6a5b";

/** ☗エルモ急戦: エルモ囲い (7九玉・7八金・6八銀) から 3七銀・4六銀 */
export const USI_ELMO_KYUSEN =
  "position startpos moves 7g7f 3c3d 2g2f 4c4d 6i7h 8b4b 7i6h 5a6b 5i6i 6b7b 6i7i 7b8b 4i5h 7a7b 3g3f 9c9d 3i4h 1c1d 4h3g 6a5b 3g4f 4a5a";

/** ☗ポンポン桂: 3六歩・3七桂から 4五桂と跳ねる */
export const USI_PONPON_KEI =
  "position startpos moves 7g7f 3c3d 2g2f 4c4d 5i6h 8b4b 6h7h 5a6b 4i5h 6b7b 3g3f 7b8b 2i3g 7a7b 3g4e 9c9d";

/** ☗ミレニアム: 6六角・7七桂・8八銀・8九玉・7八金 */
export const USI_MILLENNIUM =
  "position startpos moves 7g7f 3c3d 8h7g 4c4d 7g6f 8b4b 8i7g 5a6b 7i8h 6b7b 5i6h 7b8b 6h7h 7a7b 7h8i 9c9d 6i7h 1c1d 4i5h 6a5b 2g2f 4a5a";

/** ☗超速 vs ☖ゴキゲン中飛車: 2五歩・4八銀・3六歩・3七銀 */
export const USI_CHOSOKU =
  "position startpos moves 7g7f 3c3d 2g2f 5c5d 2f2e 8b5b 3i4h 5a6b 5i6h 6b7b 3g3f 7b8b 4h3g 9c9d";
