import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { CheckCircle } from "@phosphor-icons/react";

// Non-blocking toast (template's #toast): module-level push, single fixed
// host in the shell. Auto-hides after 2.5s.

type Toast = { id: number; msg: string };
type Listener = (msg: string) => void;

let listeners: Listener[] = [];

export function showToast(msg: string): void {
  listeners.forEach((l) => l(msg));
}

export function ToastHost() {
  const [items, setItems] = useState<Toast[]>([]);
  const seq = useRef(0);

  useEffect(() => {
    const listener: Listener = (msg) => {
      const id = ++seq.current;
      setItems((prev) => [...prev, { id, msg }]);
      setTimeout(() => setItems((prev) => prev.filter((t) => t.id !== id)), 2500);
    };
    listeners.push(listener);
    return () => {
      listeners = listeners.filter((l) => l !== listener);
    };
  }, []);

  if (typeof window === "undefined") return null;

  return createPortal(
    <div className="fixed bottom-5 right-5 z-50 flex flex-col items-end gap-2">
      {items.map((t) => (
        <div
          key={t.id}
          className="rise flex items-center gap-2 rounded-md bg-slate-900 px-3.5 py-2.5 text-xs font-medium text-white shadow-lg"
        >
          <CheckCircle size={14} weight="fill" className="text-emerald-400" />
          {t.msg}
        </div>
      ))}
    </div>,
    document.body
  );
}
