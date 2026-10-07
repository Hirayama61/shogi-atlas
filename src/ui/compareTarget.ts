const COMPARE_KEY = "shogi-atlas.compare";

/** マイページで選んだ比較相手 (端末に覚えておく) */
export function loadCompareTarget(): string | null {
  try {
    return localStorage.getItem(COMPARE_KEY);
  } catch {
    return null;
  }
}

export function saveCompareTarget(name: string): void {
  try {
    localStorage.setItem(COMPARE_KEY, name);
  } catch {
    // 保存できなくても比較は開ける
  }
}
