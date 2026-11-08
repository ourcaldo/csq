import type { ReactNode } from "react";
import Head from "next/head";
import Link from "next/link";
import { useRouter } from "next/router";
import { signOut, useSession } from "next-auth/react";
import { cn } from "@csq/ui/lib/utils";
import { Button } from "@csq/ui/components/ui/button";
import {
  SquaresFour,
  Storefront,
  ChatCircleDots,
  Gear,
  ClipboardText,
  Key,
  Tag,
  UsersThree,
  SignOut,
  CircleNotch,
  SealCheck,
} from "@phosphor-icons/react";

// Admin console shell (PRD 13): professional operations-console feel.
// Same design system as the tenant dashboard (slate surfaces, green brand)
// but denser - it's an operator tool. Built on @csq/ui.

type NavItem = { href: string; label: string; icon: ReactNode; desc: string };
type NavGroup = { label: string; items: NavItem[] };

const NAV: NavGroup[] = [
  {
    label: "Platform",
    items: [
      { href: "/admin", label: "Ringkasan", icon: <SquaresFour size={17} />, desc: "KPI & kesehatan" },
      { href: "/admin/tenants", label: "Tenant", icon: <Storefront size={17} />, desc: "Kelola tenant" },
      { href: "/admin/channels", label: "Saluran", icon: <ChatCircleDots size={17} />, desc: "Channel fleet" },
    ],
  },
  {
    label: "Operasi",
    items: [
      { href: "/admin/operations", label: "Operasional", icon: <Gear size={17} />, desc: "Queue & locks" },
      { href: "/admin/audit", label: "Audit", icon: <ClipboardText size={17} />, desc: "Log aktivitas" },
    ],
  },
  {
    label: "Konfigurasi",
    items: [
      { href: "/admin/api-keys", label: "Kunci API", icon: <Key size={17} />, desc: "Token & integrasi" },
      { href: "/admin/plans", label: "Paket & Penggunaan", icon: <Tag size={17} />, desc: "Plan & metering" },
      { href: "/admin/admins", label: "Admin", icon: <UsersThree size={17} />, desc: "Operator" },
    ],
  },
];

function isActive(pathname: string, href: string): boolean {
  return href === "/admin" ? pathname === "/admin" : pathname.startsWith(href);
}

export function AdminShell({
  title,
  children,
  flush = false,
}: {
  title: string;
  children: ReactNode;
  flush?: boolean;
}) {
  const router = useRouter();
  const { data: session } = useSession();

  return (
    <div className="flex h-screen bg-slate-50 text-foreground">
      <Head>
        <title>{title} - CSQ Admin</title>
        <meta name="robots" content="noindex,nofollow" />
      </Head>

      {/* Sidebar */}
      <aside className="hidden w-60 shrink-0 flex-col border-r border-slate-200 bg-white lg:flex">
        {/* Brand */}
        <div className="flex h-16 shrink-0 items-center gap-3 border-b border-slate-100 px-5">
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-green-600 to-green-800 text-sm font-bold text-white shadow-sm">
            C
          </span>
          <div className="min-w-0">
            <p className="truncate text-sm font-bold tracking-tight text-slate-900">CSQ Admin</p>
            <p className="truncate text-[10px] font-medium uppercase tracking-wider text-green-600">
              Platform Console
            </p>
          </div>
        </div>

        {/* Nav */}
        <nav className="flex-1 overflow-y-auto px-3 py-4">
          {NAV.map((group) => (
            <div key={group.label} className="mb-5">
              <p className="mb-1.5 px-3 text-[10px] font-semibold uppercase tracking-widest text-slate-300">
                {group.label}
              </p>
              <div className="space-y-0.5">
                {group.items.map((item) => {
                  const active = isActive(router.pathname, item.href);
                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      className={cn(
                        "group flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm transition-all",
                        active
                          ? "bg-green-50 font-semibold text-green-800 shadow-[inset_0_0_0_1px_rgba(21,128,61,0.15)]"
                          : "text-slate-500 hover:bg-slate-50 hover:text-slate-900"
                      )}
                    >
                      <span className={cn(
                        "flex h-8 w-8 shrink-0 items-center justify-center rounded-lg transition-colors",
                        active ? "bg-green-600 text-white" : "bg-slate-100 text-slate-400 group-hover:bg-slate-200 group-hover:text-slate-600"
                      )}>
                        {item.icon}
                      </span>
                      <span className="min-w-0">
                        <span className="block leading-tight">{item.label}</span>
                        <span className={cn("block text-[10px] leading-tight", active ? "text-green-600" : "text-slate-300")}>
                          {item.desc}
                        </span>
                      </span>
                    </Link>
                  );
                })}
              </div>
            </div>
          ))}
        </nav>

        {/* User */}
        <div className="shrink-0 border-t border-slate-100 p-4">
          <div className="flex items-center gap-3">
            <span className="flex h-9 w-9 items-center justify-center rounded-full bg-slate-800 text-sm font-semibold text-white">
              {(session?.user?.name ?? session?.user?.email ?? "?").charAt(0).toUpperCase()}
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-slate-700">{session?.user?.name ?? session?.user?.email}</p>
              <p className="flex items-center gap-1 truncate text-[10px] text-green-600">
                <SealCheck size={10} weight="fill" /> Operator
              </p>
            </div>
            <button
              onClick={() => void signOut({ callbackUrl: "/login" })}
              className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-300 transition-colors hover:bg-red-50 hover:text-red-600"
              title="Keluar"
            >
              <SignOut size={15} />
            </button>
          </div>
        </div>
      </aside>

      {/* Main */}
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        {/* Top bar */}
        <header className="flex h-16 shrink-0 items-center justify-between border-b border-slate-200 bg-white/80 px-6 backdrop-blur">
          <div className="flex items-center gap-3">
            <h1 className="text-xl font-bold tracking-tight text-slate-900">{title}</h1>
          </div>
          <div className="flex items-center gap-3">
            <span className="flex items-center gap-1.5 rounded-full bg-green-50 px-3 py-1 text-xs font-medium text-green-700">
              <CircleNotch size={10} className="animate-spin" style={{ animationDuration: "3s" }} />
              Platform v4.0
            </span>
          </div>
        </header>

        {/* Content */}
        <div className={cn("min-h-0 flex-1 overflow-y-auto", flush ? "" : "p-6 lg:p-8")}>
          <div className="mx-auto max-w-7xl">{children}</div>
        </div>
      </div>
    </div>
  );
}
