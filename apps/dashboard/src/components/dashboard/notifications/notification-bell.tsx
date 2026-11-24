// PRD 30: the bell in the dashboard topbar. Owns the scope dropdown
// (semua / ditugaskan / nonaktif), the browser-permission enable button,
// and the unread badge fed by the notifications provider in the shell.
import { useEffect, useRef, useState } from "react";
import { Bell, Info, SpeakerHigh } from "@phosphor-icons/react";
import { cn } from "@csq/ui/lib/utils";
import {
  useNotifications,
  type InboxNotifyScope,
} from "./notifications-context";

const OPTIONS: { value: InboxNotifyScope; label: string; desc: string }[] = [
  { value: "all", label: "Semua percakapan", desc: "Semua pesan masuk di saluran yang Anda lihat" },
  { value: "assigned", label: "Hanya ditugaskan ke saya", desc: "Hanya percakapan yang ditugaskan ke Anda" },
  { value: "off", label: "Nonaktif", desc: "Tanpa notifikasi" },
];

export function NotificationBell() {
  const { scope, setScope, permission, requestPermission, unread } = useNotifications();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onDocClick(e: MouseEvent) {
      if (ref.current && (!(e.target instanceof Node) || !ref.current.contains(e.target))) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [open]);

  function pick(next: InboxNotifyScope) {
    setScope(next);
    if (permission === "default") void requestPermission();
  }

  return (
    <div className="relative" ref={ref}>
      <button
        className="relative rounded-md p-1.5 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600"
        onClick={() => setOpen((o) => !o)}
        aria-label="Notifikasi percakapan"
        title="Notifikasi percakapan"
      >
        <Bell size={22} />
        {unread > 0 && (
          <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full border-2 border-white bg-red-500 px-1 text-[10px] font-semibold text-white">
            {unread > 99 ? "99+" : unread}
          </span>
        )}
        {unread === 0 && permission === "granted" && scope !== "off" && (
          <span className="absolute right-1 top-1 h-2 w-2 rounded-full border-2 border-white bg-green-500" />
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-12 z-50 w-72 rounded-xl border border-slate-200 bg-white p-2 shadow-lg">
          <div className="px-3 pb-2 pt-1">
            <p className="text-sm font-semibold text-slate-900">Notifikasi Percakapan</p>
            <p className="mt-0.5 flex items-center gap-1 text-[11px] text-slate-500">
              <SpeakerHigh size={12} className="shrink-0" />
              Suaranya memakai bunyi bawaan perangkat
            </p>
          </div>
          {OPTIONS.map((opt) => (
            <button
              key={opt.value}
              onClick={() => pick(opt.value)}
              className={cn(
                "flex w-full items-start gap-2 rounded-lg px-3 py-2 text-left transition",
                scope === opt.value ? "bg-slate-100" : "hover:bg-slate-50"
              )}
            >
              <span
                className={cn(
                  "mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border",
                  scope === opt.value ? "border-green-600 bg-green-600" : "border-slate-300"
                )}
              >
                {scope === opt.value && <span className="h-1.5 w-1.5 rounded-full bg-white" />}
              </span>
              <span>
                <span className="block text-sm text-slate-800">{opt.label}</span>
                <span className="block text-[11px] text-slate-500">{opt.desc}</span>
              </span>
            </button>
          ))}

          <div className="mt-1 border-t border-slate-100 px-3 py-2">
            {permission === "granted" && (
              <p className="flex items-center gap-1.5 text-[11px] text-slate-500">
                <Info size={12} className="shrink-0" />
                Notifikasi browser aktif - tetap muncul walau dashboard ditutup.
              </p>
            )}
            {permission === "default" && (
              <button
                onClick={() => void requestPermission()}
                className="w-full rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-slate-800"
              >
                Aktifkan notifikasi browser
              </button>
            )}
            {permission === "denied" && (
              <p className="flex items-start gap-1.5 text-[11px] text-red-600">
                <Info size={12} className="mt-0.5 shrink-0" />
                Notifikasi diblokir browser. Izinkan CSQ di pengaturan situs
                (ikon kunci di address bar) untuk menerima notifikasi.
              </p>
            )}
            {permission === "unsupported" && (
              <p className="flex items-start gap-1.5 text-[11px] text-slate-500">
                <Info size={12} className="mt-0.5 shrink-0" />
                Browser ini tidak mendukung notifikasi. Di iPhone, pasang CSQ
                ke layar utama (Safari &gt; Bagikan &gt; Tambah ke Layar Utama)
                agar notifikasi tersedia.
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
