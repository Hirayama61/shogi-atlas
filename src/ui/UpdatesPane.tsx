import { useEffect } from "react";
import { CHANGELOG, markUpdatesSeen } from "../changelog";

/** 追加した機能の一覧。開いた時点で既読にする。 */
export function UpdatesPane({ onSeen }: { onSeen?: () => void }) {
  useEffect(() => {
    markUpdatesSeen();
    onSeen?.();
  }, [onSeen]);

  return (
    <section>
      <div className="panel">
        <h2 style={{ marginTop: 0, fontSize: 16 }}>更新情報</h2>
        <p className="muted">追加した機能を新しい順に並べています。</p>
        <ul className="changelog">
          {CHANGELOG.map((e, i) => (
            <li key={i}>
              <div className="changelog-head">
                <time dateTime={e.date} className="muted">
                  {e.date}
                </time>
                <strong>{e.title}</strong>
              </div>
              {e.details && e.details.length > 0 && (
                <ul className="changelog-details">
                  {e.details.map((d, j) => (
                    <li key={j}>{d}</li>
                  ))}
                </ul>
              )}
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
