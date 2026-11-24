// PRD 30 (owner 2026-11-24): personal browser-notification preferences,
// reachable by EVERY role from the avatar menu (not just the owner-only
// Pengaturan page). Bell = internal notification center; this is where the
// OS-level toasts are controlled.
import { useState } from "react";
import { useNotifications, type InboxNotifyScope } from "./notifications-context";
import { cn } from "@csq/ui/lib/utils";

const OPTIONS: { value: InboxNotifyScope; label: string }[] = [
  { value: "all", label: "Semua" },
  { value: "assigned", label: "Ditugaskan ke saya" },
  { value: "off", label: "Nonaktif" },
];

export function NotificationPrefsMenu() {
  const { scope, setScope, permission, requestPermission } = useNotifications();
  const [testResult, setTestResult] = useState<string | null>(null);

  async function runTest() {
    setTestResult("Mengirim...");
    try {
      if (typeof Notification === "undefined") {
        setTestResult("Browser tidak mendukung notifikasi.");
        return;
      }
      if (Notification.permission !== "granted") {
        setTestResult(`Izin notifikasi: ${Notification.permission} (belum diizinkan).`);
        return;
      }
      const reg = await navigator.serviceWorker.register("/sw.js");
      await reg.showNotification("Tes Notifikasi CSQ", {
        body: "Kalau ini muncul, notifikasi berfungsi dengan benar.",
        tag: "csq-test",
        icon: "/icon.svg",
        silent: false,
        data: {},
      });
      setTestResult("Terkirim. Cek sudut kanan bawah layar; kalau tidak muncul, OS yang memblokir (lihat pengaturan Notifikasi Windows/Chrome).");
    } catch (err) {
      setTestResult(`Gagal: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  return (
    <div className="border-b border-slate-100 px-3 py-2">
      <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
        Notifikasi browser
      </p>
      <div className="flex gap-1">
        {OPTIONS.map((opt) => (
          <button
            key={opt.value}
            onClick={() => {
              setScope(opt.value);
              if (permission === "default") void requestPermission();
            }}
            className={cn(
              "flex-1 rounded-md border px-1.5 py-1.5 text-[11px] font-medium transition",
              scope === opt.value
                ? "border-green-600 bg-green-50 text-green-800"
                : "border-slate-200 text-slate-500 hover:bg-slate-50"
            )}
          >
            {opt.label}
          </button>
        ))}
      </div>
      <button
        onClick={() => void runTest()}
        className="mt-1.5 w-full rounded-md border border-slate-200 bg-white px-2 py-1.5 text-[11px] font-medium text-slate-600 transition hover:bg-slate-50"
      >
        Tes Notifikasi
      </button>
      {testResult && (
        <p className="mt-1.5 text-[10px] leading-snug text-slate-500">{testResult}</p>
      )}
      {permission === "denied" && (
        <p className="mt-1.5 text-[10px] leading-snug text-red-600">
          Diblokir browser - izinkan CSQ di pengaturan situs (ikon kunci).
        </p>
      )}
      {permission === "default" && (
        <button
          onClick={() => void requestPermission()}
          className="mt-1.5 w-full rounded-md bg-slate-900 px-2 py-1.5 text-[11px] font-medium text-white hover:bg-slate-800"
        >
          Aktifkan notifikasi browser
        </button>
      )}
    </div>
  );
}
