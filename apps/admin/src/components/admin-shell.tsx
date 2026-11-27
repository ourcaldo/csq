import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import Head from "next/head";
import Link from "next/link";
import { useRouter } from "next/router";
import { useSession, signOut } from "next-auth/react";
import {
  SquaresFour,
  Storefront,
  ChatCircleDots,
  Key,
  Pulse,
  ShieldCheck,
  Scroll,
  Tag,
  Coins,
  Receipt,
  EnvelopeSimple,
  UsersThree,
  SlidersHorizontal,
  CaretRight,
  ArrowLeft,
  MagnifyingGlass,
  Bell,
  X,
  List,
  SignOut,
} from "@phosphor-icons/react";
import { cn } from "@csq/ui/lib/utils";
import { ConfirmDialogHost } from "@/components/confirm-dialog";
import { ToastHost } from "@/components/toast";
import { Skeleton } from "@/components/console";
import { useAdminApi } from "@/lib/admin-api";


// Admin shell - "Enterprise Control Plane" direction (owner-approved
// template 2026-11-22). Fixed off-canvas sidebar that switches to a Settings
// sub-nav on configuration routes, sticky utility header with quick-jump
// search and live fleet pill, settings routes rendered with full-width
// centered content.

const MAIN_NAV: { group: string; items: { href: string; label: string; icon: ReactNode; countKey?: string }[] }[] = [
  {
    group: "Platform",
    items: [
      { href: "/admin", label: "Overview", icon: <SquaresFour size={16} /> },
      { href: "/admin/tenants", label: "Tenants", icon: <Storefront size={16} />, countKey: "tenants" },
      { href: "/admin/channels", label: "Channels", icon: <ChatCircleDots size={16} />, countKey: "channels" },
      { href: "/admin/api-keys", label: "API Keys", icon: <Key size={16} />, countKey: "apiKeys" },
      { href: "/admin/llm-usage", label: "LLM Usage", icon: <Coins size={16} /> },
    ],
  },
  {
    group: "Operations",
    items: [
      { href: "/admin/operations", label: "Operations", icon: <Pulse size={16} /> },
      { href: "/admin/guardrails", label: "Guardrails", icon: <ShieldCheck size={16} /> },
      { href: "/admin/audit", label: "Audit Log", icon: <Scroll size={16} /> },
    ],
  },
];

const SETTINGS_NAV: { group: string; items: { href: string; label: string; icon: ReactNode }[] }[] = [
  {
    group: "Monetization & Quotas",
    items: [
      { href: "/admin/plans", label: "Plans & Usage", icon: <Tag size={16} /> },
      { href: "/admin/billing", label: "Billing & Invoices", icon: <Receipt size={16} /> },
    ],
  },
  {
    group: "System & Access",
    items: [
      { href: "/admin/email", label: "Platform Email", icon: <EnvelopeSimple size={16} /> },
      { href: "/admin/admins", label: "Operators & Admins", icon: <UsersThree size={16} /> },
    ],
  },
];

const SETTINGS_ROUTES = ["/admin/plans", "/admin/billing", "/admin/email", "/admin/admins"];

function isActive(pathname: string, href: string): boolean {
  return href === "/admin" ? pathname === "/admin" : pathname.startsWith(href);
}

// Quick-jump: match a nav item or tenant by name/slug (template's handleQuickJump).
function useQuickJump() {
  const router = useRouter();
  const { data: tenantsData } = useAdminApi<{ items: { id: string; name: string; slug: string }[] }>(
    "/api/admin/tenants"
  );
  return (val: string) => {
    const q = val.trim().toLowerCase();
    if (!q) return;
    const all = [...MAIN_NAV, ...SETTINGS_NAV].flatMap((g) => g.items);
    const routeMatch = all.find(
      (i) => i.label.toLowerCase().includes(q) || i.href.toLowerCase().includes(q.replace(/\s+/g, "-"))
    );
    if (routeMatch) {
      router.push(routeMatch.href);
      return;
    }
    const tenantMatch = (tenantsData?.items ?? []).find(
      (t) => t.name.toLowerCase().includes(q) || t.slug.toLowerCase().includes(q)
    );
    if (tenantMatch) router.push(`/admin/tenants/${tenantMatch.id}`);
  };
}

export function AdminShell({ title, children }: { title: string; children: ReactNode }) {
  const router = useRouter();
  const { data: session } = useSession();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [jump, setJump] = useState("");
  const quickJump = useQuickJump();

  const isSettings = SETTINGS_ROUTES.some((r) => isActive(router.pathname, r));

  // Fleet counts + health for the sidebar badges and header pill.
  const { data: tenantsData } = useAdminApi<{ items: { status: string }[] }>("/api/admin/tenants");
  const { data: channelsData } = useAdminApi<{ items: { status: string }[] }>("/api/admin/channels");
  const { data: apiKeysData } = useAdminApi<{ items: { revokedAt: string | null }[] }>("/api/admin/api-keys");
  const { data: opsData } = useAdminApi<{
    failedMessages: { id: string }[];
    health: { db: { ok: boolean; ms: number } };
  }>("/api/admin/operations");

  const counts = useMemo(() => ({
    tenants: tenantsData?.items.length ?? 0,
    channels: channelsData?.items.length ?? 0,
    apiKeys: (apiKeysData?.items ?? []).filter((k) => !k.revokedAt).length,
  }), [tenantsData, channelsData, apiKeysData]);
  const failedCount = opsData?.failedMessages.length ?? 0;
  const connected = (channelsData?.items ?? []).filter((c) => c.status === "CONNECTED").length;
  const dbMs = opsData?.health.db.ok ? `${opsData.health.db.ms}ms DB` : "DB down";
  // Skeletons only on the genuine first load (no cached response yet) -
  // afterwards the module cache in lib/admin-api serves the last data
  // instantly on every navigation, so no value ever flashes.
  const opsLoaded = opsData !== null;
  const channelsLoaded = channelsData !== null;
  const name = session?.user?.name ?? "Operator";
  const initials = name.split(" ").map((w) => w[0]).join("").slice(0, 2).toUpperCase();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        document.getElementById("global-search")?.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => setMobileOpen(false), [router.pathname]);

  const matchedGroup = [...MAIN_NAV, ...SETTINGS_NAV].find((g) =>
    g.items.some((i) => isActive(router.pathname, i.href))
  );

  return (
    <div className="min-h-screen bg-background text-slate-900 selection:bg-emerald-100 selection:text-emerald-950">
      <Head>
        <title>{title} - CSQ Admin Console</title>
        <meta name="description" content="CSQ platform operator console - tenant, plan, and operations management." />
        <meta name="robots" content="noindex,nofollow" />
      </Head>

      {/* Mobile overlay */}
      {mobileOpen && (
        <div className="fixed inset-0 z-30 bg-slate-900/45 backdrop-blur-[2px] md:hidden" onClick={() => setMobileOpen(false)} />
      )}

      {/* Sidebar */}
      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-40 flex w-64 shrink-0 flex-col border-r border-slate-200 bg-card transition-transform duration-200 md:translate-x-0",
          mobileOpen ? "translate-x-0" : "-translate-x-full"
        )}
      >
        <div className="flex h-14 items-center justify-between border-b border-slate-100 px-5">
          <div className="flex items-center gap-2.5">
            <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-green-600 text-white">
              <ChatCircleDots size={17} weight="fill" />
            </div>
            <div className="flex items-center gap-1.5">
              <span className="text-lg font-bold tracking-tight">CSQ</span>
              <span className="rounded border border-slate-200 bg-muted px-1.5 py-0.5 font-mono text-[10px] font-semibold uppercase tracking-wider text-slate-600">
                Admin
              </span>
            </div>
          </div>
          <button
            onClick={() => setMobileOpen(false)}
            aria-label="Close navigation"
            className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700 md:hidden"
          >
            <X size={16} />
          </button>
        </div>

        <div className="border-b border-slate-100 bg-muted/70 px-5 py-2.5">
          <div className="flex items-center justify-between text-[11px]">
            <span className="flex items-center gap-1.5 font-medium text-slate-700">
              {opsLoaded ? (
                <>
                  <span className={`h-1.5 w-1.5 rounded-full ${failedCount === 0 ? "live-dot bg-emerald-500" : "bg-red-500"}`} />
                  <span>{failedCount === 0 ? "All systems operational" : `${failedCount} failed sends`}</span>
                </>
              ) : (
                <Skeleton className="h-2 w-32" />
              )}
            </span>
            {channelsLoaded ? (
              <span className="font-mono text-[10px] text-slate-500">{connected}/{counts.channels} channels up</span>
            ) : (
              <Skeleton className="h-2 w-20" />
            )}
          </div>
        </div>

        <nav className="flex-1 space-y-5 overflow-y-auto px-3 py-4">
          {isSettings ? (
            <>
              <button
                type="button"
                onClick={() => router.push("/admin")}
                className="mb-4 flex w-full items-center gap-2 rounded-md border border-slate-200 bg-muted px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-100 hover:text-slate-900"
              >
                <ArrowLeft size={14} />
                <span>Back to Control Plane</span>
              </button>
              {SETTINGS_NAV.map((grp) => (
                <div key={grp.group}>
                  <p className="px-3 pb-1.5 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                    {grp.group}
                  </p>
                  <div className="space-y-0.5">
                    {grp.items.map((item) => {
                      const active = isActive(router.pathname, item.href);
                      return (
                        <Link
                          key={item.href}
                          href={item.href}
                          className={cn(
                            "flex items-center gap-2.5 rounded-lg px-3 py-2 text-[13px] font-medium transition-colors",
                            active ? "bg-emerald-50 font-semibold text-emerald-700" : "text-slate-500 hover:bg-slate-50 hover:text-slate-900"
                          )}
                        >
                          <span className={active ? "text-emerald-600" : "text-slate-400"}>{item.icon}</span>
                          {item.label}
                        </Link>
                      );
                    })}
                  </div>
                </div>
              ))}
            </>
          ) : (
            MAIN_NAV.map((grp) => (
              <div key={grp.group}>
                <p className="px-3 pb-1.5 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                  {grp.group}
                </p>
                <div className="space-y-0.5">
                  {grp.items.map((item) => {
                    const active = isActive(router.pathname, item.href);
                    const count = item.countKey ? counts[item.countKey as keyof typeof counts] : null;
                    const alert = item.href === "/admin/operations" && failedCount > 0;
                    return (
                      <Link
                        key={item.href}
                        href={item.href}
                        className={cn(
                          "flex items-center justify-between gap-2.5 rounded-lg px-3 py-2 text-[13px] font-medium transition-colors",
                          active ? "bg-emerald-50 font-semibold text-emerald-700" : "text-slate-500 hover:bg-slate-50 hover:text-slate-900"
                        )}
                      >
                        <span className="flex items-center gap-2.5">
                          <span className={active ? "text-emerald-600" : "text-slate-400"}>{item.icon}</span>
                          {item.label}
                        </span>
                        {count !== null ? (
                          <span className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[10px] text-slate-600">
                            {count}
                          </span>
                        ) : alert ? (
                          <span className="h-1.5 w-1.5 rounded-full bg-red-500" />
                        ) : null}
                      </Link>
                    );
                  })}
                </div>
              </div>
            ))
          )}
        </nav>

        {!isSettings && (
          <div className="border-t border-slate-200 p-3">
            <Link
              href="/admin/plans"
              className="flex items-center justify-between rounded-lg px-3 py-2 text-[13px] font-medium text-slate-500 transition-colors hover:bg-slate-50 hover:text-slate-900"
            >
              <span className="flex items-center gap-2.5">
                <SlidersHorizontal size={16} className="text-slate-400" />
                Platform Settings
              </span>
              <CaretRight size={12} className="text-slate-400" />
            </Link>
          </div>
        )}

        <div className="border-t border-slate-200 p-3">
          <div className="flex items-center justify-between gap-2 px-1.5 pt-1">
            <div className="flex min-w-0 items-center gap-2.5">
              <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-slate-900 text-xs font-semibold text-white">
                {initials}
              </div>
              <div className="min-w-0">
                <p className="truncate text-xs font-semibold text-slate-900">
                  {session?.user?.name ?? "Operator"}
                </p>
                <p className="truncate font-mono text-[10px] text-slate-500">
                  {session?.user?.email ?? ""}
                </p>
              </div>
            </div>
            <button
              onClick={() => void signOut({ callbackUrl: "/login" })}
              aria-label="Sign out"
              className="rounded-md p-1.5 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700"
            >
              <SignOut size={14} />
            </button>
          </div>
        </div>
      </aside>

      {/* Main workspace */}
      <div className="flex min-h-screen min-w-0 flex-col md:pl-64">
        <header className="sticky top-0 z-20 flex h-14 shrink-0 items-center justify-between border-b border-slate-200 bg-card/95 px-4 backdrop-blur md:px-8">
          <div className="flex items-center gap-3">
            <button
              onClick={() => setMobileOpen(true)}
              aria-label="Open menu"
              className="rounded p-1.5 text-slate-600 hover:bg-slate-100 md:hidden"
            >
              <List size={18} />
            </button>
            <div className="hidden items-center gap-2 text-xs lg:flex">
              <span className="text-slate-400">{matchedGroup?.group ?? "Platform"}</span>
              <span className="text-slate-300">/</span>
              <span className="font-semibold text-slate-900">{title}</span>
            </div>
            <div className="relative sm:ml-2">
              <MagnifyingGlass size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                id="global-search"
                type="text"
                value={jump}
                onChange={(e) => {
                  setJump(e.target.value);
                  quickJump(e.target.value);
                }}
                placeholder="Jump to view or search tenant... (Ctrl+K)"
                className="h-8 w-56 rounded-md border border-slate-200 bg-muted pl-8 pr-3 text-xs text-slate-900 placeholder:text-slate-400 transition focus:w-80 focus:border-slate-300 focus:bg-card focus:outline-none"
              />
            </div>
          </div>

          <div className="flex items-center gap-3">
            <Link
              href="/admin/operations"
              className="hidden items-center gap-2 rounded-full border border-slate-200 bg-muted/80 px-2.5 py-1 text-xs font-medium text-slate-700 transition hover:bg-slate-100 sm:inline-flex"
            >
              {opsLoaded ? (
                <>
                  <span className={`h-2 w-2 rounded-full ${failedCount === 0 ? "live-dot bg-emerald-500" : "bg-red-500"}`} />
                  <span>{failedCount === 0 ? "Worker OK" : "Needs attention"}</span>
                  <span className="font-mono text-[10px] text-slate-400">{dbMs}</span>
                </>
              ) : (
                <Skeleton className="h-2.5 w-24" />
              )}
            </Link>
            <Link
              href="/admin/operations"
              aria-label="Outbox alerts"
              title="View outbox failures"
              className="relative rounded-md p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-800"
            >
              <Bell size={18} />
              {failedCount > 0 && (
                <span className="absolute right-1.5 top-1.5 h-2 w-2 rounded-full border-2 border-card bg-red-500" />
              )}
            </Link>
          </div>
        </header>

        <main className="flex-1 px-4 py-7 md:px-8">
          <div className="w-full max-w-6xl">{children}</div>
        </main>
      </div>

      <ConfirmDialogHost />
      <ToastHost />
    </div>
  );
}
