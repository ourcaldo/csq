// PRD 30 (owner 2026-11-24): personal browser-notification preferences,
// reachable by EVERY role from the avatar menu (not just the owner-only
// Pengaturan page). Bell = internal notification center; this is where the
// OS-level toasts are controlled.
import { useNotifications, type InboxNotifyScope } from "./notifications-context";
import { cn } from "@csq/ui/lib/utils";

const OPTIONS: { value: InboxNotifyScope; label: string }[] = [
  { value: "all", label: "Semua" },
  { value: "assigned", label: "Ditugaskan ke saya" },
  { value: "off", label: "Nonaktif" },
];

export function NotificationPrefsMenu() {
  const { scope, setScope, permission, requestPermission } = useNotifications();
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
