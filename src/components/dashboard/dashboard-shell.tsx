// CSQ dashboard shell — clean CRM look matching the reference design.
// White sidebar (w-64) with grouped Phosphor-icon nav + CSQ wordmark; top header
// with search, action icons, and an avatar menu (role + Keluar). Each page wraps
// its content with this shell; the title/description/actions render in a page
// header inside main, not the global header.
//
// Client-side: session user comes from useSession() (pages are SSR-guarded by
// withAuth, so a session always exists once mounted). Sidebar is static on md+
// and a togglable overlay on mobile.
import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/router";
import { useSession, signOut } from "next-auth/react";
import {
  ChartBar,
  ChatCircleDots,
  WhatsappLogo,
  Package,
  Stack,
  ShoppingCart,
  AddressBook,
  Tag,
  Books,
  Brain,
  Database,
  Robot,
  SealCheck,
  ClockCounterClockwise,
  Gear,
  Users,
  Bell,
  MagnifyingGlass,
  CaretDown,
  SignOut,
  List,
  Kanban,
  FlowArrow,
} from "@phosphor-icons/react";
import { cn } from "@/lib/utils";

type NavItem = { href: string; label: string; icon: ReactNode };
type NavGroup = { label: string; items: NavItem[] };

const NAV_GROUPS: NavGroup[] = [
  {
    label: "Utama",
    items: [
      { href: "/dashboard", label: "Ringkasan", icon: <ChartBar size={18} /> },
      { href: "/dashboard/inbox", label: "Percakapan", icon: <ChatCircleDots size={18} /> },
      { href: "/dashboard/saluran", label: "Saluran", icon: <WhatsappLogo size={18} /> },
      { href: "/dashboard/pipeline", label: "Manajemen Pipeline", icon: <Kanban size={18} /> },
    ],
  },
  {
    label: "Data Bisnis",
    items: [
      { href: "/dashboard/products", label: "Produk", icon: <Package size={18} /> },
      { href: "/dashboard/inventory", label: "Inventaris", icon: <Stack size={18} /> },
      { href: "/dashboard/orders", label: "Pesanan", icon: <ShoppingCart size={18} /> },
      { href: "/dashboard/contacts", label: "Kontak", icon: <AddressBook size={18} /> },
      { href: "/dashboard/tags", label: "Tag", icon: <Tag size={18} /> },
    ],
  },
  {
    label: "Pengetahuan",
    items: [
      { href: "/dashboard/knowledge", label: "Pengetahuan", icon: <Books size={18} /> },
      { href: "/dashboard/memory", label: "Memori", icon: <Brain size={18} /> },
      { href: "/dashboard/sources", label: "Sumber Data", icon: <Database size={18} /> },
    ],
  },
  {
    label: "Agent",
    items: [
      { href: "/dashboard/agents", label: "Agent", icon: <Robot size={18} /> },
      { href: "/dashboard/scenarios", label: "Skenario", icon: <FlowArrow size={18} /> },
      { href: "/dashboard/approvals", label: "Approval", icon: <SealCheck size={18} /> },
      { href: "/dashboard/activity", label: "Aktivitas", icon: <ClockCounterClockwise size={18} /> },
    ],
  },
];

const NAV_BOTTOM: NavItem[] = [
  { href: "/dashboard/settings", label: "Pengaturan", icon: <Gear size={18} /> },
  { href: "/dashboard/team", label: "Tim", icon: <Users size={18} /> },
];

type DashboardShellProps = {
  title: string;
  description?: string;
  actions?: ReactNode;
  /** Full-width content rendered below the title/actions row, inside the page
      header. Used for things like a mobile action dropdown that should span
      the header edge-to-edge. Ignored in flush mode. */
  headerExtra?: ReactNode;
  /** Flush mode: full-bleed content (no page header/padding). For the inbox. */
  flush?: boolean;
  children: ReactNode;
};

export function DashboardShell({ title, description, actions, headerExtra, flush, children }: DashboardShellProps) {
  const router = useRouter();
  const { data: session } = useSession();
  const [navOpen, setNavOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  function isActive(href: string) {
    if (href === "/dashboard") return router.pathname === "/dashboard";
    return router.pathname === href || router.pathname.startsWith(href + "/");
  }

  // Close the avatar menu on outside click.
  useEffect(() => {
    if (!menuOpen) return;
    function onDocClick(e: MouseEvent) {
      if (menuRef.current && (!(e.target instanceof Node) || !menuRef.current.contains(e.target))) {
        setMenuOpen(false);
      }
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [menuOpen]);

  const userName = session?.user?.name ?? session?.user?.email ?? "Pengguna";
  const userInitial = (session?.user?.name ?? session?.user?.email ?? "U").charAt(0).toUpperCase();
  const role = session?.user?.role;

  return (
    <div className="flex h-screen overflow-hidden bg-slate-50 text-slate-800">
      {/* Sidebar */}
      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-40 flex w-64 shrink-0 flex-col border-r border-slate-200 bg-white transition-transform md:translate-x-0",
          navOpen ? "translate-x-0" : "-translate-x-full"
        )}
      >
        {/* Logo */}
        <div className="flex h-16 items-center gap-2 border-b border-slate-100 px-6">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-green-600 text-white">
            <ChatCircleDots size={20} weight="fill" />
          </div>
          <span className="text-xl font-bold tracking-tight text-slate-900">CSQ</span>
        </div>

        {/* Nav groups */}
        <nav className="scrollbar-slim flex-1 space-y-4 overflow-y-auto py-4 px-3">
          {NAV_GROUPS.map((group) => (
            <div key={group.label}>
              <p className="px-3 pb-1 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                {group.label}
              </p>
              <div className="space-y-0.5">
                {group.items.map((item) => (
                  <Link
                    key={item.href}
                    href={item.href}
                    onClick={() => setNavOpen(false)}
                    className={cn(
                      "flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors",
                      isActive(item.href)
                        ? "nav-item-active"
                        : "text-slate-600 hover:bg-slate-50 hover:text-slate-900"
                    )}
                  >
                    <span className="text-slate-500">{item.icon}</span>
                    {item.label}
                  </Link>
                ))}
              </div>
            </div>
          ))}
        </nav>

        {/* Bottom actions */}
        <div className="space-y-0.5 border-t border-slate-200 p-3">
          {NAV_BOTTOM.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              onClick={() => setNavOpen(false)}
              className={cn(
                "flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors",
                isActive(item.href)
                  ? "nav-item-active"
                  : "text-slate-600 hover:bg-slate-50 hover:text-slate-900"
              )}
            >
              <span className="text-slate-500">{item.icon}</span>
              {item.label}
            </Link>
          ))}
        </div>
      </aside>

      {navOpen && (
        <div
          className="fixed inset-0 z-30 bg-black/50 md:hidden"
          onClick={() => setNavOpen(false)}
          aria-hidden
        />
      )}

      {/* Main */}
      <div className="flex min-w-0 flex-1 flex-col md:pl-64">
        <header className="flex h-16 shrink-0 items-center justify-between border-b border-slate-200 bg-white px-4 md:px-6">
          <button
            className="rounded-md p-2 text-slate-600 hover:bg-slate-100 md:hidden"
            onClick={() => setNavOpen(true)}
            aria-label="Buka menu"
          >
            <List size={20} />
          </button>

          {/* Search — hidden on mobile (decorative; no handler) to keep the
              header from overflowing on 360px. Visible from sm up. */}
          <div className="relative mx-2 hidden w-full max-w-xl sm:block">
            <MagnifyingGlass
              size={18}
              className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
            />
            <input
              type="text"
              placeholder="Cari atau ketik perintah…"
              className="w-full rounded-lg border border-slate-200 bg-slate-50 py-2 pl-10 pr-4 text-sm placeholder-slate-400 focus:border-slate-300 focus:outline-none focus:ring-2 focus:ring-slate-200"
            />
          </div>

          {/* Right actions */}
          <div className="flex items-center gap-3 md:gap-4">
            <button className="relative text-slate-400 transition-colors hover:text-slate-600">
              <Bell size={22} />
              <span className="absolute right-0 top-0 h-2 w-2 rounded-full border-2 border-white bg-red-500" />
            </button>
            <div className="mx-1 hidden h-6 w-px bg-slate-200 sm:block" />
            <div className="relative" ref={menuRef}>
              <button
                className="flex items-center gap-2 rounded-md p-1 hover:bg-slate-100"
                onClick={() => setMenuOpen((o) => !o)}
              >
                <div className="flex h-8 w-8 items-center justify-center rounded-full bg-green-600 text-sm font-semibold text-white">
                  {userInitial}
                </div>
                <CaretDown size={14} className="hidden text-slate-400 sm:block" />
              </button>
              {menuOpen && (
                <div className="absolute right-0 top-12 z-50 w-56 rounded-xl border border-slate-200 bg-white p-2 shadow-lg">
                  <div className="border-b border-slate-100 px-3 py-2">
                    <p className="truncate text-sm font-semibold text-slate-900">{userName}</p>
                    {role && (
                      <p className="text-xs text-slate-500">{role === "OWNER" ? "Owner" : "Staff"}</p>
                    )}
                  </div>
                  <button
                    className="mt-1 flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-slate-600 hover:bg-slate-50 hover:text-slate-900"
                    onClick={() => signOut({ callbackUrl: "/login" })}
                  >
                    <SignOut size={16} />
                    Keluar
                  </button>
                </div>
              )}
            </div>
          </div>
        </header>

        <main className={flush ? "flex min-h-0 flex-1 flex-col overflow-hidden" : "scrollbar-slim flex-1 overflow-y-auto"}>
          {!flush && (
            <div className="border-b border-slate-200 bg-white px-4 py-4 md:px-6">
              {headerExtra ? (
                <div>
                  {/* Title + status badge locked on one row (no wrap), badge
                      top-right aligned with the title. Description and the
                      full-width dropdown sit on their own lines below. */}
                  <div className="flex items-center justify-between gap-4">
                    <h1 className="text-xl font-bold text-slate-900">{title}</h1>
                    {actions && <div className="flex shrink-0 items-center justify-end gap-2">{actions}</div>}
                  </div>
                  {description && (
                    <p className="mt-0.5 text-sm text-slate-500">{description}</p>
                  )}
                  <div className="mt-3">{headerExtra}</div>
                </div>
              ) : (
                <div className="flex flex-wrap items-center justify-between gap-y-3 gap-x-4">
                  <div className="min-w-0">
                    <h1 className="text-xl font-bold text-slate-900">{title}</h1>
                    {description && (
                      <p className="mt-0.5 text-sm text-slate-500">{description}</p>
                    )}
                  </div>
                  {actions && <div className="flex flex-wrap items-center justify-end gap-2">{actions}</div>}
                </div>
              )}
            </div>
          )}

          <div className={flush ? "flex min-h-0 flex-1 flex-col" : "p-4 md:p-6"}>{children}</div>
        </main>
      </div>
    </div>
  );
}
