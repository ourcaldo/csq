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
  Gear,
  ClipboardText,
  Key,
  Tag,
  UsersThree,
  SignOut,
} from "@phosphor-icons/react";

// Admin console shell (PRD 13). Flat Swiss-style operator chrome: white
// surfaces, hairline rules, one green accent. No gradients or shadows.

type NavItem = { href: string; label: string; icon: ReactNode };
type NavGroup = { label: string; items: NavItem[] };

const NAV: NavGroup[] = [
  {
    label: "Platform",
    items: [
      { href: "/admin", label: "Ringkasan", icon: <SquaresFour size={15} /> },
      { href: "/admin/tenants", label: "Tenant", icon: <Storefront size={15} /> },
      { href: "/admin/channels", label: "Saluran", icon: <ChatCircleDots size={15} /> },
    ],
  },
  {
    label: "Operasi",
    items: [
      { href: "/admin/operations", label: "Operasional", icon: <Gear size={15} /> },
      { href: "/admin/audit", label: "Audit", icon: <ClipboardText size={15} /> },
    ],
  },
  {
    label: "Konfigurasi",
    items: [
      { href: "/admin/api-keys", label: "Kunci API", icon: <Key size={15} /> },
      { href: "/admin/plans", label: "Paket & penggunaan", icon: <Tag size={15} /> },
      { href: "/admin/admins", label: "Admin", icon: <UsersThree size={15} /> },
    ],
  },
];

function isActive(pathname: string, href: string): boolean {
  return href === "/admin" ? pathname === "/admin" : pathname.startsWith(href);
}

export function AdminShell({ title, children }: { title: string; children: ReactNode }) {
  const router = useRouter();
  const { data: session } = useSession();
  const name = session?.user?.name ?? session?.user?.email ?? "Operator";
  const email = session?.user?.email ?? "";

  return (
    <div className="flex h-screen bg-[#F6F7F9] text-slate-800">
      <Head>
        <title>{title} - CSQ Admin</title>
        <meta name="robots" content="noindex,nofollow" />
      </Head>

      <aside className="hidden w-56 shrink-0 flex-col border-r border-slate-200 bg-white lg:flex">
        <div className="flex h-14 shrink-0 items-center gap-2.5 border-b border-slate-200 px-4">
          <span className="flex h-6 w-6 items-center justify-center rounded bg-green-700 text-[11px] font-bold text-white">
            C
          </span>
          <span className="text-[15px] font-semibold tracking-tight text-slate-900">
            CSQ Admin
          </span>
        </div>

        <nav className="flex-1 overflow-y-auto py-3">
          {NAV.map((group) => (
            <div key={group.label} className="mb-4">
              <p className="px-4 pb-1 text-[10px] font-semibold uppercase tracking-[0.08em] text-slate-400">
                {group.label}
              </p>
              {group.items.map((item) => {
                const active = isActive(router.pathname, item.href);
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={cn(
                      "mx-2 flex items-center gap-2.5 rounded px-2 py-1.5 text-[13px] transition-colors",
                      active
                        ? "bg-slate-100 font-medium text-slate-900"
                        : "text-slate-600 hover:bg-slate-50 hover:text-slate-900"
                    )}
                  >
                    <span className={active ? "text-green-700" : "text-slate-400"}>
                      {item.icon}
                    </span>
                    {item.label}
                  </Link>
                );
              })}
            </div>
          ))}
        </nav>

        <div className="shrink-0 border-t border-slate-200 px-4 py-3">
          <p className="truncate text-[12px] font-medium text-slate-800">{name}</p>
          {email && <p className="truncate text-[11px] text-slate-400">{email}</p>}
          <button
            onClick={() => void signOut({ callbackUrl: "/login" })}
            className="mt-2 flex items-center gap-1.5 text-[12px] text-slate-500 transition-colors hover:text-slate-900"
          >
            <SignOut size={13} />
            Keluar
          </button>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 shrink-0 items-center justify-between border-b border-slate-200 bg-white px-4 lg:px-6">
          <h1 className="truncate text-[15px] font-semibold tracking-tight text-slate-900">
            {title}
          </h1>
          <button
            onClick={() => void signOut({ callbackUrl: "/login" })}
            className="flex items-center gap-1.5 text-[12px] text-slate-500 hover:text-slate-900 lg:hidden"
          >
            <SignOut size={14} />
            Keluar
          </button>
        </header>

        {/* Mobile nav: the sidebar is desktop-only, so small screens get a
            scrolling strip instead of an overlay. */}
        <nav className="flex shrink-0 gap-1 overflow-x-auto border-b border-slate-200 bg-white px-2 py-1.5 lg:hidden">
          {NAV.flatMap((g) => g.items).map((item) => {
            const active = isActive(router.pathname, item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  "whitespace-nowrap rounded px-2.5 py-1 text-[12px]",
                  active
                    ? "bg-slate-100 font-medium text-slate-900"
                    : "text-slate-500 hover:text-slate-900"
                )}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>

        <main className="min-h-0 flex-1 overflow-y-auto p-4 lg:p-6">
          <div className="mx-auto max-w-[1180px]">{children}</div>
        </main>
      </div>
    </div>
  );
}
