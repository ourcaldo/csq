import { useCallback, useState } from "react";
import { createPortal } from "react-dom";
import { Warning } from "@phosphor-icons/react";

// Centralized destructive-action confirmation (template's confirm-modal):
// every irreversible mutation in the console routes through here, optionally
// requiring the operator to type the target's exact name. No native confirm().

type ConfirmRequest = {
  title: string;
  desc: React.ReactNode;
  requireText?: string;
  btnLabel: string;
  onConfirm: () => void;
};

let pushRequest: ((r: ConfirmRequest) => void) | null = null;

export function confirmAction(req: ConfirmRequest): void {
  pushRequest?.(req);
}

export function ConfirmDialogHost() {
  const [req, setReq] = useState<ConfirmRequest | null>(null);
  const [typed, setTyped] = useState("");

  const push = useCallback((r: ConfirmRequest) => {
    setReq(r);
    setTyped("");
  }, []);

  // Mount-time registration; the module-level pusher is a stable singleton.
  useState(() => {
    pushRequest = push;
    return null;
  });

  if (!req || typeof window === "undefined") return null;

  const blocked = req.requireText !== undefined && typed.trim() !== req.requireText;

  const close = () => setReq(null);

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/45 p-4 backdrop-blur-[2px]">
      <div className="w-full max-w-md overflow-hidden rounded-lg border border-border bg-card shadow-xl">
        <div className="flex border-b border-slate-100 px-5 py-3.5">
          <Warning size={16} className="mt-0.5 mr-2 shrink-0 text-bad" />
          <h3 className="text-sm font-semibold">{req.title}</h3>
        </div>
        <div className="space-y-3 px-5 py-4">
          <p className="text-xs leading-relaxed text-slate-600">{req.desc}</p>
          {req.requireText !== undefined && (
            <div>
              <label htmlFor="confirm-type-input" className="block text-xs font-medium text-slate-700">
                Type &quot;{req.requireText}&quot; to confirm:
              </label>
              <input
                id="confirm-type-input"
                type="text"
                autoFocus
                value={typed}
                onChange={(e) => setTyped(e.target.value)}
                className="mt-1.5 h-9 w-full rounded-md border border-input bg-card px-3 text-xs focus:border-bad focus:outline-none"
              />
            </div>
          )}
        </div>
        <div className="flex justify-end gap-2 border-t border-slate-100 bg-muted/60 px-5 py-3">
          <button
            type="button"
            onClick={close}
            className="rounded-md border border-slate-300 bg-card px-3.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={blocked}
            onClick={() => {
              close();
              req.onConfirm();
            }}
            className="rounded-md bg-bad px-3.5 py-1.5 text-xs font-semibold text-white hover:bg-bad/85 disabled:pointer-events-none disabled:opacity-40"
          >
            {req.btnLabel}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
