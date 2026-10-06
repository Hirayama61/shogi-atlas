import { LOSS_THRESHOLD } from "../core/analysis";

/** 「平均損失」の意味と目安。見出しや数値の横に置く */
export function LossHelp() {
  return (
    <details className="help">
      <summary>平均損失とは</summary>
      <p>
        各手で、エンジンの最善手を指した場合と比べて評価値 (cp, 歩 1 枚 ≒ 100cp)
        をどれだけ失ったかを 1 手あたりで平均したもの。0 以上で、小さいほど最善に近い。
      </p>
      <p>
        目安: 50 未満は精度が高い、50〜{LOSS_THRESHOLD.inaccuracy} はふつう、
        {LOSS_THRESHOLD.inaccuracy} 以上は平均が疑問手の水準で乱れが大きい。1 手の損失が{" "}
        {LOSS_THRESHOLD.inaccuracy} 以上で疑問手、{LOSS_THRESHOLD.mistake} 以上で悪手、
        {LOSS_THRESHOLD.blunder} 以上で大悪手 (勝率の落ち幅でも判定)。
      </p>
    </details>
  );
}
