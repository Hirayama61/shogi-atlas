/**
 * アプリ内に出す更新情報。追加した機能だけを書く (修正・内部変更・運用の変更は書かない)。
 * 新しいものを先頭に置く。機能を足した Issue の作業で 1 件足す。
 */
export interface ChangelogEntry {
  /** YYYY-MM-DD */
  date: string;
  title: string;
  /** 補足。画面での見え方や使い方を 1 行ずつ */
  details?: string[];
}

export const CHANGELOG: ChangelogEntry[] = [
  {
    date: "2026-10-06",
    title: "対局者ページの戦法・囲いから棋譜一覧へ",
    details: [
      "採用戦法・囲い・相手の戦法の行をタップすると、その対局者のその戦法の対局だけが並ぶ。",
      "棋譜一覧と対局者一覧の文字入力の絞り込み欄は外した。",
    ],
  },
  {
    date: "2026-10-06",
    title: "更新情報の画面",
    details: ["追加した機能をここで見られる。未読があると「更新情報」タブに印が付く。"],
  },
  {
    date: "2026-10-06",
    title: "棋譜の取り込みと解析が 2 時間おきに自動で回る",
    details: ["データリポジトリの Issue に棋譜を貼っておけば、次の回で取り込みと解析まで進む。"],
  },
  {
    date: "2026-10-06",
    title: "対局者ページの整理",
    details: [
      "平均損失の説明を付けた。",
      "痛かった手と分岐点は折りたたみにして、必要なときだけ展開する。",
    ],
  },
  {
    date: "2026-10-06",
    title: "棋譜一覧の絞り込みにクリアボタン",
  },
  {
    date: "2026-10-06",
    title: "棋譜一覧に出典サービスのバッジ",
    details: ["将棋ウォーズ / 将棋クエストのバッジが付き、「ウォーズ」「クエスト」で絞り込める。"],
  },
  {
    date: "2026-10-05",
    title: "将棋クエストの棋譜に対応",
    details: [
      "レート、時間切れ・接続切れ、トライルールの勝ちを読み取る。",
      "対局者ページでは段級位が無ければレートを表示する。",
    ],
  },
  {
    date: "2026-10-05",
    title: "エンジン解析と弱点プロファイル",
    details: [
      "棋譜ごとに評価値の推移と疑問手・悪手・大悪手の印が出る。",
      "対局者ページに段階別の平均損失、戦法別の精度、痛かった手が出る。",
    ],
  },
  {
    date: "2026-10-05",
    title: "囲い判定の追加",
    details: ["右玉、6九玉型の矢倉、居玉の雁木を判定する。未判定は玉の位置で表す。"],
  },
  {
    date: "2026-10-05",
    title: "対局者ページ",
    details: [
      "成績、採用戦法、囲い、相手の戦法別の成績、2 局以上で共通する局面の分岐点が見られる。",
    ],
  },
  {
    date: "2026-10-05",
    title: "戦法の細分類と囲いの判定",
    details: [
      "四間飛車・三間飛車・中飛車・角換わり・横歩取りなどの戦法名と、美濃・矢倉・穴熊などの囲い名を付ける。",
    ],
  },
  {
    date: "2026-10-05",
    title: "設定画面でトークンをファイルから読み込める",
    details: ["iCloud Drive などに置いたテキストファイルから Fine-grained PAT を読み込む。"],
  },
  {
    date: "2026-10-05",
    title: "最初の版",
    details: [
      "データリポジトリから棋譜を同期し、一覧・局面表示・戦型で絞り込める。",
      "スマホにインストールして使える (PWA)。",
    ],
  },
];

/** 最新の更新日。未読判定に使う。 */
export const LATEST_UPDATE = CHANGELOG[0]?.date ?? "";

const SEEN_KEY = "shogi-atlas:updates-seen";

function readSeen(): string {
  try {
    return localStorage.getItem(SEEN_KEY) ?? "";
  } catch {
    return "";
  }
}

/** まだ見ていない更新があるか (最後に開いたときの最新日より新しい更新があるか) */
export function hasUnseenUpdates(): boolean {
  return LATEST_UPDATE > readSeen();
}

/** 更新情報を開いたときに呼ぶ */
export function markUpdatesSeen(): void {
  try {
    localStorage.setItem(SEEN_KEY, LATEST_UPDATE);
  } catch {
    // プライベートモードなどで保存できなくても画面は動く
  }
}
