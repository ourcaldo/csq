import type { ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/router";
import { signOut, useSession } from "next-auth/react";
import { cn } from "@csq/ui/lib/utils";
import { Button } from "@csq/ui/components/ui/button";
import { Input } from "@csq/ui/components/ui/input";
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

// Admin console shell (PRD 13): the tenant dashboard's design language -
// sidebar nav, slate surfaces, green brand - built entirely on @csq/ui.
// App-specific: stays in apps/admin, never in the shared package.

type MenuItem = { href: string; label: string; icon: ReactNode };

const MENU: MenuItem[] = [
  { href: "/admin", label: "Ringkasan", icon: <SquaresFour size={18} /> },
  { href: "/admin/tenants", label: "Tenant", icon: <Storefront size={18} /> },
  { href: "/admin/channels", label: "Saluran", icon: <ChatCircleDots size={18} /> },
  { href: "/admin/operations", label: "Operasional", icon: <Gear size={18} /> },
  { href: "/admin/audit", label: "Audit", icon: <ClipboardText size={18} /> },
  { href: "/admin/api-keys", label: "Kunci API", icon: <Key size={18} /> },
  { href: "/admin/plans", label: "Paket & Penggunaan", icon: <Tag size={18} /> },
  { href: "/admin/admins", label: "Admin", icon: <UsersThree size={18} /> },
];

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
    <div className="flex h-screen bg-background text-foreground">
      <aside className="hidden w-56 shrink-0 flex-col border-r border-slate-200 bg-white lg:flex">
        <div className="flex h-14 items-center gap-2 border-b border-slate-100 px-4">
          <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-slate-900 text-sm font-bold text-white">
            C
          </span>
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-slate-900">CSQ Admin</p>
            <p className="truncate text-[10px] uppercase tracking-wider text-slate-400">
              Platform Console
            </p>
          </div>
        </div>
        <nav className="flex-1 space-y-0.5 overflow-y-auto p-2">
          {MENU.map((item) => {
            const active =
              item.href === "/admin"
                ? router.pathname === "/admin"
                : router.pathname.startsWith(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  "flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition-colors",
                  active
                    ? "bg-slate-100 font-semibold text-slate-900"
                    : "text-slate-500 hover:bg-slate-50 hover:text-slate-900"
                )}
              >
                {item.icon}
                {item.label}
              </Link>
            );
          })}
        </nav>
        <div className="border-t border-slate-100 p-3">
          <p className="truncate px-1 text-xs text-slate-400">{session?.user?.email}</p>
          <button
            onClick={() => void signOut({ callbackUrl: "/login" })}
            className="mt-2 flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-slate-500 transition-colors hover:bg-red-50 hover:text-red-700"
          >
            <SignOut size={16} /> Keluar
          </button>
        </div>
      </aside>

      <main className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <header className="flex h-14 shrink-0 items-center justify-between border-b border-slate-200 bg-white px-4 lg:px-6">
          <div className="flex items-center gap-3 lg:hidden">
            {/* Mobile: menu collapses to the page title; the console is an
                operator tool used on desktop - the sidebar stays lg+. */}
            <span className="text-sm font-semibold text-slate-900">CSQ Admin</span>
          </div>
          <h1 className="hidden text-base font-semibold text-slate-900 lg:block">{title}</h1>
          <div className="flex items-center gap-2">
            <Link href="/admin/tenants">
              <Button variant="outline" size="sm">
                <Storefront size={14} className="mr-1.5" /> Tenant
              </Button>
            </Link>
          </div>
        </header>
        <div className={cn("min-h-0 flex-1 overflow-y-auto", flush ? "" : "p-4 lg:p-6")}>
          {children}
        </div>
      </main>
    </div>
  );
}

export { Input };
