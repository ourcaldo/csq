import { useState } from "react";
import type { ReactNode } from "react";
import Head from "next/head";
import Link from "next/link";
import { useRouter } from "next/router";
import { signOut, useSession } from "next-auth/react";
import { cn } from "@csq/ui/lib/utils";
import {
  SquaresFour,
  Storefront,
  ChatCircleDots,
  Pulse,
  Scroll,
  ShieldCheck,
  Key,
  Receipt,
  Tag,
  EnvelopeSimple,
  UsersThree,
  SidebarSimple,
  CaretRight,
  SignOut,
} from "@phosphor-icons/react";

// Admin console shell (PRD 13), "Ledger" direction: the app sits on warm
// paper, the content is one hairline-bounded panel, the sidebar is plain
// type. Collapsible to an icon rail on desktop; a scrolling pill strip on
// small screens. Console copy is English (owner direction 2026-11-13).

const NAV = [
  {
    group: "Platform",
    items: [
      { href: "/admin", label: "Overview", icon: <SquaresFour size={16} /> },
      { href: "/admin/tenants", label: "Tenants", icon: <Storefront size={16} /> },
      { href: "/admin/channels", label: "Channels", icon: <ChatCircleDots size={16} /> },
    ],
  },
  {
    group: "Operations",
    items: [
      { href: "/admin/operations", label: "Operations", icon: <Pulse size={16} /> },
      { href: "/admin/guardrails", label: "Guardrails", icon: <ShieldCheck size={16} /> },
      { href: "/admin/audit", label: "Audit", icon: <Scroll size={16} /> },
    ],
  },
  {
    group: "Configuration",
    items: [
      { href: "/admin/api-keys", label: "API Keys", icon: <Key size={16} /> },
      { href: "/admin/plans", label: "Plans & Usage", icon: <Tag size={16} /> },
      { href: "/admin/billing", label: "Billing", icon: <Receipt size={16} /> },
      { href: "/admin/email", label: "Email", icon: <EnvelopeSimple size={16} /> },
      { href: "/admin/admins", label: "Admins", icon: <UsersThree size={16} /> },
    ],
  },
];

function isActive(pathname: string, href: string): boolean {
  return href === "/admin" ? pathname === "/admin" : pathname.startsWith(href);
}

export function AdminShell({ title, children }: { title: string; children: ReactNode }) {
  const router = useRouter();
  const { data: session } = useSession();
  const [collapsed, setCollapsed] = useState(false);

  const group = NAV.find((g) => g.items.some((i) => isActive(router.pathname, i.href)));
  const item = group?.items.find((i) => isActive(router.pathname, i.href));
  const email = session?.user?.email ?? "";
  const name = session?.user?.name ?? email;
  const initials = name.slice(0, 2).toUpperCase();

  return (
    <div className="flex min-h-screen w-full bg-background p-2">
      <Head>
        <title>{title} - CSQ Console</title>
        <meta name="robots" content="noindex,nofollow" />
      </Head>

      <aside
        className={cn(
          "sticky top-2 hidden h-[calc(100vh-1rem)] shrink-0 flex-col transition-[width] md:flex",
          collapsed ? "w-14" : "w-60"
        )}
      >
        <div className="flex h-12 items-center gap-2 px-3">
          <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-primary text-[11px] font-bold text-primary-foreground">
            C
          </span>
          {!collapsed && (
            <span className="text-[15px] font-semibold tracking-tight">
              CSQ <span className="font-normal text-muted-foreground">Console</span>
            </span>
          )}
        </div>

        <nav className="mt-3 flex-1 overflow-y-auto px-2">
          {NAV.map((g) => (
            <div key={g.group} className="mb-5">
              {!collapsed && <div className="eyebrow px-2 pb-1.5">{g.group}</div>}
              {g.items.map((it) => {
                const active = isActive(router.pathname, it.href);
                return (
                  <Link
                    key={it.href}
                    href={it.href}
                    title={it.label}
                    className={cn(
                      "flex h-8 items-center gap-2.5 rounded-md px-2 text-[13.5px] transition-colors",
                      active
                        ? "bg-card font-medium text-foreground shadow-[0_1px_2px_rgba(0,0,0,0.06)] ring-1 ring-border"
                        : "text-muted-foreground hover:bg-card/60 hover:text-foreground"
                    )}
                  >
                    <span className="shrink-0">{it.icon}</span>
                    {!collapsed && <span className="truncate">{it.label}</span>}
                  </Link>
                );
              })}
            </div>
          ))}
        </nav>

        <div className="flex items-center gap-2.5 px-2 py-2">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-card text-[11px] font-semibold ring-1 ring-border">
            {initials}
          </span>
          {!collapsed && (
            <>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13px] font-medium">{name}</span>
                <span className="block truncate text-[11.5px] text-muted-foreground">
                  Administrator
                </span>
              </span>
              <button
                onClick={() => void signOut({ callbackUrl: "/login" })}
                aria-label="Sign out"
                className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-card hover:text-foreground"
              >
                <SignOut size={15} />
              </button>
            </>
          )}
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col md:pl-2">
        <header className="flex h-12 items-center gap-3 px-2">
          <button
            onClick={() => setCollapsed((c) => !c)}
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            className="hidden rounded-md p-1.5 text-muted-foreground hover:bg-card hover:text-foreground md:block"
          >
            <SidebarSimple size={16} />
          </button>
          <span className="hidden h-4 w-px bg-border md:block" />

          <div className="flex min-w-0 items-center gap-1.5 text-[13px]">
            <span className="eyebrow hidden sm:block">{group?.group ?? "Platform"}</span>
            <CaretRight size={13} className="hidden text-muted-foreground sm:block" />
            <span className="truncate font-medium">{item?.label ?? title}</span>
          </div>

          <div className="ml-auto flex items-center gap-3">
            {email && (
              <span className="hidden font-mono text-[11.5px] text-muted-foreground lg:block">
                {email}
              </span>
            )}
            <button
              onClick={() => void signOut({ callbackUrl: "/login" })}
              aria-label="Sign out"
              className="rounded-full p-2 text-muted-foreground transition-colors hover:bg-card hover:text-foreground md:hidden"
            >
              <SignOut size={16} />
            </button>
          </div>
        </header>

        <main className="flex-1 rounded-2xl border border-border bg-panel p-4 shadow-[0_1px_3px_rgba(0,0,0,0.04)] md:p-6">
          <nav className="mb-5 flex gap-1 overflow-x-auto md:hidden">
            {NAV.flatMap((g) => g.items).map((it) => {
              const active = isActive(router.pathname, it.href);
              return (
                <Link
                  key={it.href}
                  href={it.href}
                  className={cn(
                    "whitespace-nowrap rounded-full px-3 py-1 text-[12.5px] transition-colors",
                    active
                      ? "bg-foreground font-medium text-background"
                      : "bg-card text-muted-foreground ring-1 ring-border"
                  )}
                >
                  {it.label}
                </Link>
              );
            })}
          </nav>
          <div className="rise mx-auto max-w-[1240px]">{children}</div>
        </main>
      </div>
    </div>
  );
}
