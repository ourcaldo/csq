// Form primitives shared by the channel wizard steps. The same height and
// border as the dashboard's inputs, kept local because the wizard uses a
// denser layout than the shadcn form fields.

export const inputCls =
  "w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm placeholder-slate-400 focus:border-green-500 focus:outline-none focus:ring-2 focus:ring-green-500/20";

export function Field(props: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  hint?: string;
  disabled?: boolean;
  type?: string;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-slate-600">
        {props.label}
      </span>
      <input
        type={props.type ?? "text"}
        value={props.value}
        onChange={(e) => props.onChange(e.target.value)}
        disabled={props.disabled}
        className={inputCls}
      />
      {props.hint && (
        <span className="mt-1 block text-xs text-slate-400">{props.hint}</span>
      )}
    </label>
  );
}

// Read-only credential display for server-generated values (webhook URL,
// verify token): same height/padding as Field's input, with an inline copy
// button so it visually matches the editable fields beside it.
export function ReadOnlyField(props: { label: string; value: string; hint?: string }) {
  return (
    <div className="block">
      <span className="mb-1 block text-xs font-medium text-slate-600">
        {props.label}
      </span>
      <div className="flex items-center gap-2">
        <code className="min-w-0 flex-1 truncate rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700">
          {props.value}
        </code>
        <button
          type="button"
          className="shrink-0 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-green-700 hover:bg-green-50"
          onClick={() => {
            void navigator.clipboard.writeText(props.value);
          }}
        >
          Salin
        </button>
      </div>
      {props.hint && (
        <span className="mt-1 block text-xs text-slate-400">{props.hint}</span>
      )}
    </div>
  );
}
