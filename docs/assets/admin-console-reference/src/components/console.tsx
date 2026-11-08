import { Link, useRouterState } from "@tanstack/react-router";
import { useState, type ReactNode } from "react";
import {
  Activity, Bell, ChevronRight, ChevronsUpDown, KeyRound, LayoutGrid, MessageCircle,
  MoreHorizontal, PanelLeft, ScrollText, Search, Store, Tag as TagIcon, Users, type LucideIcon,
} from "lucide-react";

const nav: { group: string; items: { to: string; label: string; icon: LucideIcon }[] }[] = [
  { group: "Platform", items: [
    { to: "/", label: "Ringkasan", icon: LayoutGrid },
    { to: "/tenants", label: "Tenant", icon: Store },
    { to: "/channels", label: "Saluran", icon: MessageCircle },
  ] },
  { group: "Operasi", items: [
    { to: "/operations", label: "Operasional", icon: Activity },
    { to: "/audit", label: "Audit", icon: ScrollText },
  ] },
  { group: "Konfigurasi", items: [
    { to: "/api-keys", label: "Kunci API", icon: KeyRound },
    { to: "/plans", label: "Paket & Penggunaan", icon: TagIcon },
    { to: "/admins", label: "Admin", icon: Users },
  ] },
];

export function ConsoleShell({ children }: { children: ReactNode }) {
  const path = useRouterState({ select: (s) => s.location.pathname });
  const [collapsed, setCollapsed] = useState(false);
  const group = nav.find((g) => g.items.some((i) => i.to === path));
  const item = group?.items.find((i) => i.to === path);

  return (
    <div className="flex min-h-screen w-full bg-background p-2">
      <aside className={`sticky top-2 flex h-[calc(100vh-1rem)] shrink-0 flex-col transition-[width] ${collapsed ? "w-14" : "w-60"}`}>
        <div className="flex h-12 items-center gap-2 px-3">
          <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-primary text-[11px] font-bold text-primary-foreground">C</span>
          {!collapsed && <span className="text-[15px] font-semibold tracking-tight">CSQ <span className="font-normal text-muted-foreground">Console</span></span>}
        </div>
        <nav className="mt-3 flex-1 overflow-y-auto px-2">
          {nav.map((g) => (
            <div key={g.group} className="mb-5">
              {!collapsed && <div className="eyebrow px-2 pb-1.5">{g.group}</div>}
              {g.items.map((it) => {
                const active = path === it.to;
                const Icon = it.icon;
                return (
                  <Link
                    key={it.to}
                    to={it.to}
                    title={it.label}
                    className={`flex h-8 items-center gap-2.5 rounded-md px-2 text-[13.5px] transition-colors ${
                      active ? "bg-card font-medium text-foreground shadow-[0_1px_2px_oklch(0_0_0/0.06)] ring-1 ring-border" : "text-muted-foreground hover:bg-card/60 hover:text-foreground"
                    }`}
                  >
                    <Icon className="h-4 w-4 shrink-0" strokeWidth={1.75} />
                    {!collapsed && <span className="truncate">{it.label}</span>}
                  </Link>
                );
              })}
            </div>
          ))}
        </nav>
        <button className="flex items-center gap-2.5 rounded-lg px-2 py-2 text-left transition-colors hover:bg-card/60">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-card text-[11px] font-semibold ring-1 ring-border">PO</span>
          {!collapsed && (
            <>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13px] font-medium">Platform Operator</span>
                <span className="block truncate text-[11.5px] text-muted-foreground">Administrator</span>
              </span>
              <ChevronsUpDown className="h-3.5 w-3.5 text-muted-foreground" />
            </>
          )}
        </button>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col pl-2">
        <header className="flex h-12 items-center gap-3 px-2">
          <button onClick={() => setCollapsed((c) => !c)} aria-label="Toggle sidebar" className="rounded-md p-1.5 text-muted-foreground hover:bg-card hover:text-foreground">
            <PanelLeft className="h-4 w-4" strokeWidth={1.75} />
          </button>
          <span className="h-4 w-px bg-border" />
          <div className="flex items-center gap-1.5 text-[13px]">
            <span className="eyebrow">{group?.group ?? "Platform"}</span>
            <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
            <span className="font-medium">{item?.label ?? ""}</span>
          </div>
          <div className="ml-auto flex h-8 w-64 items-center gap-2 rounded-full border border-border bg-card px-3 text-[13px] text-muted-foreground">
            <Search className="h-3.5 w-3.5" />
            <span>Cari tenant, saluran…</span>
            <kbd className="mono ml-auto text-[10.5px]">⌘K</kbd>
          </div>
          <button aria-label="Notifikasi" className="relative rounded-full p-2 text-muted-foreground hover:bg-card hover:text-foreground">
            <Bell className="h-4 w-4" strokeWidth={1.75} />
            <span className="absolute right-1 top-1 flex h-3.5 min-w-3.5 items-center justify-center rounded-full bg-bad px-1 text-[9px] font-semibold text-primary-foreground">2</span>
          </button>
        </header>
        <main className="flex-1 rounded-2xl border border-border bg-panel p-6 shadow-[0_1px_3px_oklch(0_0_0/0.04)]">
          <div className="rise mx-auto max-w-[1240px]">{children}</div>
        </main>
      </div>
    </div>
  );
}

export function PageHead({ eyebrow, title, sub, action }: { index?: string; eyebrow?: string; title: string; sub?: string; action?: ReactNode }) {
  return (
    <div className="mb-6 flex items-end justify-between gap-6">
      <div>
        {eyebrow && <div className="eyebrow mb-1.5">{eyebrow}</div>}
        <h1 className="text-[28px] font-bold leading-tight tracking-tight">{title}</h1>
        {sub && <p className="mt-1 text-[13.5px] text-muted-foreground">{sub}</p>}
      </div>
      {action && <div className="flex items-center gap-2">{action}</div>}
    </div>
  );
}

export function Btn({ children, variant = "ink", ...p }: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "ink" | "line" | "ghost" }) {
  const v = {
    ink: "bg-foreground text-background hover:bg-foreground/85",
    line: "bg-card ring-1 ring-border hover:bg-accent",
    ghost: "text-muted-foreground hover:bg-accent hover:text-foreground",
  }[variant];
  return (
    <button {...p} className={`inline-flex h-9 items-center gap-1.5 rounded-full px-4 text-[13px] font-medium transition-colors ${v} ${p.className ?? ""}`}>
      {children}
    </button>
  );
}

export function Status({ tone, children }: { tone: "ok" | "off" | "warn" | "bad"; children: ReactNode }) {
  const pill = {
    ok: "bg-signal-soft text-ok ring-ok/20",
    off: "bg-muted text-muted-foreground ring-border",
    warn: "bg-muted text-foreground ring-border",
    bad: "bg-bad/8 text-bad ring-bad/20",
  }[tone];
  const dot = { ok: "bg-ok", off: "bg-muted-foreground/60", warn: "bg-warn", bad: "bg-bad" }[tone];
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11.5px] font-medium ring-1 ${pill}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${dot}`} />
      {children}
    </span>
  );
}

export function Tag({ children }: { children: ReactNode }) {
  return <span className="mono rounded-md bg-muted px-1.5 py-0.5 text-[11px] ring-1 ring-border">{children}</span>;
}

export function Trend({ value }: { value: number }) {
  const up = value >= 0;
  return (
    <span className={`mono rounded-md px-1.5 py-0.5 text-[11px] ${up ? "bg-signal-soft text-ok" : "bg-bad/8 text-bad"}`}>
      {up ? "↑" : "↓"} {Math.abs(value)}%
    </span>
  );
}

export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`rounded-xl border border-border bg-card shadow-[0_1px_2px_oklch(0_0_0/0.04)] ${className}`}>{children}</div>;
}

export function Group({ label, meta, children }: { label: string; meta?: ReactNode; children: ReactNode }) {
  return (
    <div className="mb-4 rounded-2xl border border-border bg-panel p-4">
      <div className="mb-3 flex items-center justify-between px-1">
        <span className="eyebrow">{label}</span>
        {meta && <span className="mono text-[11.5px] text-muted-foreground">{meta}</span>}
      </div>
      {children}
    </div>
  );
}

export function Section({ title, meta, children }: { title: string; meta?: ReactNode; children: ReactNode }) {
  return <Group label={title} meta={meta}>{children}</Group>;
}

export function Empty({ title, hint, icon: Icon = ScrollText }: { title: string; hint?: string; icon?: LucideIcon }) {
  return (
    <Card className="flex flex-col items-center justify-center px-5 py-12 text-center">
      <span className="mb-3 flex h-9 w-9 items-center justify-center rounded-lg bg-muted ring-1 ring-border">
        <Icon className="h-4 w-4 text-muted-foreground" strokeWidth={1.75} />
      </span>
      <div className="text-[13.5px] font-medium">{title}</div>
      {hint && <div className="mt-1 max-w-sm text-[12.5px] text-muted-foreground">{hint}</div>}
    </Card>
  );
}

export function Stat({ label, value, note, icon: Icon, trend }: { label: string; value: ReactNode; note?: ReactNode; icon?: LucideIcon; trend?: number; tone?: "signal" }) {
  return (
    <Card className="p-5">
      <div className="flex items-center gap-2.5">
        {Icon && (
          <span className="flex h-7 w-7 items-center justify-center rounded-md ring-1 ring-border">
            <Icon className="h-3.5 w-3.5" strokeWidth={1.75} />
          </span>
        )}
        <span className="text-[10.5px] font-semibold uppercase tracking-[0.14em]">{label}</span>
        <MoreHorizontal className="ml-auto h-4 w-4 text-muted-foreground" />
      </div>
      <div className="mt-4 flex items-center gap-2">
        <span className="mono num text-[30px] font-medium leading-none tracking-tight">{value}</span>
        {trend !== undefined && <Trend value={trend} />}
      </div>
      {note && <div className="mt-2.5 text-[12px] text-muted-foreground">{note}</div>}
    </Card>
  );
}

export function TableCard({ children }: { children: ReactNode }) {
  return <Card className="overflow-hidden [&_.ledger]:rounded-none [&_.ledger]:border-0">{children}</Card>;
}

export const pad = (n: number) => String(n).padStart(2, "0");

export function headFor(title: string, description: string) {
  return {
    meta: [
      { title: `${title} — CSQ Console` },
      { name: "description", content: description },
      { property: "og:title", content: `${title} — CSQ Console` },
      { property: "og:description", content: description },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  };
}
