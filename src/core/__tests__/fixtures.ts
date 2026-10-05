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
