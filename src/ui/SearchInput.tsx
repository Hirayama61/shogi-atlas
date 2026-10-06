/** 絞り込み欄。文字が入っているときだけ右端にクリアボタンを出す。 */
export function SearchInput({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
}) {
  return (
    <div className="search">
      <input
        type="search"
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
      {value && (
        <button
          type="button"
          className="search-clear"
          aria-label="クリア"
          onClick={() => onChange("")}
        >
          ×
        </button>
      )}
    </div>
  );
}
