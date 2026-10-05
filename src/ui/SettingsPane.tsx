import { useState } from "react";
import { db } from "../db/db";
import {
  loadConfig,
  pullFromDataRepo,
  saveConfig,
  type DataRepoConfig,
  type PullProgress,
} from "../sync/github";

export function SettingsPane() {
  const [config, setConfig] = useState<DataRepoConfig>(() => loadConfig());
  const [progress, setProgress] = useState<PullProgress | null>(null);
  const [message, setMessage] = useState<string>("");
  const [busy, setBusy] = useState(false);

  const update = (patch: Partial<DataRepoConfig>) => setConfig((c) => ({ ...c, ...patch }));

  const sync = async () => {
    saveConfig(config);
    setBusy(true);
    setMessage("");
    try {
      const r = await pullFromDataRepo(config, setProgress);
      setMessage(
        `同期完了: 追加 ${r.added} 局、更新 ${r.updated} 局 (リポジトリ全体 ${r.total} 局)`,
      );
    } catch (e) {
      setMessage(`同期失敗: ${(e as Error).message}`);
    } finally {
      setBusy(false);
      setProgress(null);
    }
  };

  const clearAll = async () => {
    if (!confirm("この端末に保存した棋譜をすべて削除します。よろしいですか？")) return;
    await db.games.clear();
    setMessage("ローカルの棋譜を削除しました");
  };

  return (
    <section>
      <div className="panel">
        <h2 style={{ marginTop: 0, fontSize: 16 }}>データリポジトリ</h2>
        <p className="muted">
          プライベートリポジトリの棋譜をこの端末に取り込みます。トークンは対象リポジトリの Contents
          読み取りだけを許可した Fine-grained PAT を使ってください。
        </p>
        <div className="row">
          <div className="field" style={{ flex: 1 }}>
            <label>owner</label>
            <input value={config.owner} onChange={(e) => update({ owner: e.target.value })} />
          </div>
          <div className="field" style={{ flex: 1 }}>
            <label>repo</label>
            <input value={config.repo} onChange={(e) => update({ repo: e.target.value })} />
          </div>
          <div className="field" style={{ width: 100 }}>
            <label>branch</label>
            <input value={config.branch} onChange={(e) => update({ branch: e.target.value })} />
          </div>
        </div>
        <div className="field">
          <label>トークン</label>
          <input
            type="password"
            autoComplete="off"
            value={config.token}
            onChange={(e) => update({ token: e.target.value })}
            placeholder="github_pat_..."
          />
        </div>
        <label className="row" style={{ marginBottom: 10 }}>
          <input
            type="checkbox"
            checked={config.remember}
            onChange={(e) => update({ remember: e.target.checked })}
          />
          <span className="muted">
            トークンをこの端末に保存する (外すとタブを閉じるまでだけ有効)
          </span>
        </label>
        <div className="row">
          <button className="primary" disabled={busy} onClick={sync}>
            同期する
          </button>
          <button
            className="ghost"
            onClick={() => {
              saveConfig(config);
              setMessage("保存しました");
            }}
          >
            保存のみ
          </button>
          {progress && (
            <span className="muted">
              {progress.phase === "index"
                ? "一覧を取得中…"
                : `${progress.done} / ${progress.total} 局`}
            </span>
          )}
        </div>
        {message && <p>{message}</p>}
      </div>
      <div className="panel">
        <h2 style={{ marginTop: 0, fontSize: 16 }}>ローカルデータ</h2>
        <button className="ghost" onClick={clearAll}>
          この端末の棋譜をすべて削除
        </button>
      </div>
    </section>
  );
}
