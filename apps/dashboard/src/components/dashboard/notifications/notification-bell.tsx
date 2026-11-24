// PRD 30 (owner 2026-11-24): the topbar bell is the INTERNAL notification
// center - the user's unread-conversation feed, like Facebook's bell. It is
// not about the browser's notification permission; that lives in the avatar
// menu and Pengaturan > Umum. Clicking an item opens the conversation and
// the read watermark clears it from this list.
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/router";
import { Bell, ChatCircle } from "@phosphor-icons/react";
import { useNotifications } from "./notifications-context";

function relativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "";
  const diffMin = Math.max(0, Math.floor((Date.now() - then) / 60_000));
  if (diffMin < 1) return "baru saja";
  if (diffMin < 60) return `${diffMin} mnt lalu`;
  const hours = Math.floor(diffMin / 60);
  if (hours < 24) return `${hours} jam lalu`;
  const days = Math.floor(hours / 24);
  return `${days} hari lalu`;
}

export function NotificationBell() {
  const router = useRouter();
  const { items, total, refresh } = useNotifications();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    refresh();
    function onDocClick(e: MouseEvent) {
      if (ref.current && (!(e.target instanceof Node) || !ref.current.contains(e.target))) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [open, refresh]);

  function openConversation(conversationId: string) {
    setOpen(false);
    void router.push(`/dashboard/inbox?c=${encodeURIComponent(conversationId)}`);
  }

  return (
    <div className="relative" ref={ref}>      <button
        className="relative rounded-md p-1.5 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600"
        onClick={() => setOpen((o) => !o)}
        aria-label="Notifikasi"
        title="Notifikasi"
      >
        <Bell size={22} />
        {total > 0 && (
          <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full border-2 border-white bg-red-500 px-1 text-[10px] font-semibold text-white">
            {total > 99 ? "99+" : total}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-12 z-50 w-80 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-lg">
          <div className="flex items-center justify-between border-b border-slate-100 px-4 py-2.5">
            <span className="text-sm font-semibold text-slate-900">Notifikasi</span>
            {total > 0 && (
              <span className="rounded-full bg-red-50 px-2 py-0.5 text-[11px] font-semibold text-red-600">
                {total} belum dibaca
              </span>
            )}
          </div>

          {items.length === 0 ? (
            <div className="px-4 py-8 text-center">
              <ChatCircle size={28} className="mx-auto text-slate-300" />
              <p className="mt-2 text-sm text-slate-500">Belum ada notifikasi baru.</p>
            </div>
          ) : (
            <ul className="max-h-96 divide-y divide-slate-100 overflow-y-auto">
              {items.map((item) => (
                <li key={item.conversationId}>
                  <button
                    onClick={() => openConversation(item.conversationId)}
                    className="flex w-full items-start gap-2.5 px-4 py-2.5 text-left transition hover:bg-slate-50"
                  >
                    <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-green-50 text-[13px] font-semibold text-green-700">
                      {item.title.charAt(0).toUpperCase()}
                    </div>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-baseline justify-between gap-2">
                        <span className="truncate text-[13px] font-semibold text-slate-900">
                          {item.title}
                        </span>
                        <span className="shrink-0 text-[10px] text-slate-400">
                          {relativeTime(item.at)}
                        </span>
                      </span>
                      <span className="mt-0.5 block truncate text-xs text-slate-500">
                        {item.snippet}
                      </span>
                      <span className="mt-0.5 block text-[10px] font-medium uppercase tracking-wide text-slate-400">
                        {item.channelLabel}
                      </span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}

          <button
            onClick={() => {
              setOpen(false);
              void router.push("/dashboard/inbox");
            }}
            className="block w-full border-t border-slate-100 px-4 py-2.5 text-center text-xs font-medium text-green-700 transition hover:bg-slate-50"
          >
            Buka Percakapan
          </button>
        </div>
      )}
    </div>
  );
}
