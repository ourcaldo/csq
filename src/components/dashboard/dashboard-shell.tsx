// Shared dashboard layout: sidebar nav + topbar (user name + role + Keluar).
// Each dashboard page wraps its content with this component — Pages Router has
// no app-level layout, so this is the cleanest shared shell (per task notes).
//
// Session user info comes from useSession() (client-side; pages are SSR-guarded
// by withAuth, so a session always exists once mounted). Sidebar is static on
// md+ and a togglable overlay on mobile.
import { useState } from "react";
import type { ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/router";
import { useSession, signOut } from "next-auth/react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const NAV_ITEMS: { href: string; label: string }[] = [
  { href: "/dashboard", label: "Overview" },
  { href: "/dashboard/products", label: "Produk" },
  { href: "/dashboard/inventory", label: "Inventaris" },
  { href: "/dashboard/orders", label: "Pesanan" },
  { href: "/dashboard/knowledge", label: "Pengetahuan" },
  { href: "/dashboard/contacts", label: "Kontak" },
  { href: "/dashboard/tags", label: "Tag" },
  { href: "/dashboard/memory", label: "Memori" },
  { href: "/dashboard/sources", label: "Sumber Data" },
];

type DashboardShellProps = {
  title: string;
  description?: string;
  actions?: ReactNode;
  children: ReactNode;
};

export function DashboardShell({ title, description, actions, children }: DashboardShellProps) {
  const router = useRouter();
  const { data: session } = useSession();
  const [navOpen, setNavOpen] = useState(false);

  function isActive(href: string) {
    if (href === "/dashboard") return router.pathname === "/dashboard";
    return router.pathname === href || router.pathname.startsWith(href + "/");
  }

  const userName = session?.user?.name ?? session?.user?.email ?? "Pengguna";
  const role = session?.user?.role;

  return (
    <div className="min-h-screen bg-background">
      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-40 w-60 border-r bg-card transition-transform md:translate-x-0",
          navOpen ? "translate-x-0" : "-translate-x-full"
        )}
      >
        <div className="flex h-14 items-center border-b px-4 font-semibold">
          UMKM Agent
        </div>
        <nav className="flex flex-col gap-1 p-2">
          {NAV_ITEMS.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              onClick={() => setNavOpen(false)}
              className={cn(
                "rounded-md px-3 py-2 text-sm",
                isActive(item.href)
                  ? "bg-accent font-medium text-accent-foreground"
                  : "text-muted-foreground hover:bg-accent/60 hover:text-foreground"
              )}
            >
              {item.label}
            </Link>
          ))}
        </nav>
      </aside>

      {navOpen && (
        <div
          className="fixed inset-0 z-30 bg-black/50 md:hidden"
          onClick={() => setNavOpen(false)}
          aria-hidden
        />
      )}

      <div className="md:pl-60">
        <header className="flex h-14 items-center justify-between gap-2 border-b px-4">
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              className="md:hidden"
              onClick={() => setNavOpen(true)}
            >
              Menu
            </Button>
            <h1 className="text-base font-semibold">{title}</h1>
          </div>
          <div className="flex items-center gap-3">
            <div className="hidden text-right sm:block">
              <div className="text-sm font-medium">{userName}</div>
              {role && (
                <div className="text-xs text-muted-foreground">
                  {role === "OWNER" ? "Owner" : "Staff"}
                </div>
              )}
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => signOut({ callbackUrl: "/login" })}
            >
              Keluar
            </Button>
          </div>
        </header>

        <main className="p-4 md:p-6">
          {description && (
            <p className="mb-4 text-sm text-muted-foreground">{description}</p>
          )}
          {actions && (
            <div className="mb-4 flex items-center justify-end gap-2">{actions}</div>
          )}
          {children}
        </main>
      </div>
    </div>
  );
}
