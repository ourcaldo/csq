import type { ButtonHTMLAttributes, ReactNode } from "react";
import { Scroll } from "@phosphor-icons/react";
import { Card as UiCard } from "@csq/ui/components/ui/card";

// Console primitives for the "Ledger" direction. Ported from the approved
// reference (docs/assets/admin-console-reference): flat paper surfaces,
// hairline rules, mono numerals, one signal color. Nothing decorative.

export function PageHead({
  eyebrow,
  title,
  sub,
  action,
}: {
  eyebrow?: string;
  title: string;
  sub?: string;
  action?: ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div>
        {eyebrow && <div className="eyebrow mb-1.5">{eyebrow}</div>}
        <h1 className="text-[28px] font-bold leading-tight tracking-tight">{title}</h1>
        {sub && <p className="mt-1 text-[13.5px] text-muted-foreground">{sub}</p>}
      </div>
      {action && <div className="flex items-center gap-2">{action}</div>}
    </div>
  );
}

type BtnVariant = "ink" | "line" | "ghost";

export function btnClass(variant: BtnVariant = "ink"): string {
  const v = {
    ink: "bg-foreground text-background hover:bg-foreground/85",
    line: "bg-card ring-1 ring-border hover:bg-accent",
    ghost: "text-muted-foreground hover:bg-accent hover:text-foreground",
  }[variant];
  return `inline-flex h-9 items-center gap-1.5 rounded-full px-4 text-[13px] font-medium transition-colors disabled:pointer-events-none disabled:opacity-50 ${v}`;
}

export function Btn({
  variant = "ink",
  className = "",
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: BtnVariant }) {
  return (
    <button {...props} className={`${btnClass(variant)} ${className}`}>
      {children}
    </button>
  );
}

export function Status({
  tone,
  children,
}: {
  tone: "ok" | "off" | "warn" | "bad";
  children: ReactNode;
}) {
  const pill = {
    ok: "bg-signal-soft text-ok ring-ok/20",
    off: "bg-muted text-muted-foreground ring-border",
    warn: "bg-muted text-foreground ring-border",
    bad: "bg-bad/8 text-bad ring-bad/20",
  }[tone];
  const dot = {
    ok: "bg-ok",
    off: "bg-muted-foreground/60",
    warn: "bg-warn",
    bad: "bg-bad",
  }[tone];
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11.5px] font-medium ring-1 ${pill}`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${dot}`} />
      {children}
    </span>
  );
}

export function Tag({ children }: { children: ReactNode }) {
  return (
    <span className="font-mono rounded-md bg-muted px-1.5 py-0.5 text-[11px] ring-1 ring-border">
      {children}
    </span>
  );
}

export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <UiCard
      className={`rounded-xl border-border shadow-[0_1px_2px_rgba(0,0,0,0.04)] ${className}`}
    >
      {children}
    </UiCard>
  );
}

export function Group({
  label,
  meta,
  children,
}: {
  label: string;
  meta?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="mb-4 rounded-2xl border border-border bg-panel p-4">
      <div className="mb-3 flex items-center justify-between px-1">
        <span className="eyebrow">{label}</span>
        {meta && <span className="font-mono text-[11.5px] text-muted-foreground">{meta}</span>}
      </div>
      {children}
    </div>
  );
}

export function Section({
  title,
  meta,
  children,
}: {
  title: string;
  meta?: ReactNode;
  children: ReactNode;
}) {
  return (
    <Group label={title} meta={meta}>
      {children}
    </Group>
  );
}

export function Empty({
  title,
  hint,
  icon,
}: {
  title: string;
  hint?: string;
  icon?: ReactNode;
}) {
  return (
    <Card className="flex flex-col items-center justify-center px-5 py-12 text-center">
      <span className="mb-3 flex h-9 w-9 items-center justify-center rounded-lg bg-muted ring-1 ring-border">
        {icon ?? <Scroll size={16} className="text-muted-foreground" />}
      </span>
      <div className="text-[13.5px] font-medium">{title}</div>
      {hint && <div className="mt-1 max-w-sm text-[12.5px] text-muted-foreground">{hint}</div>}
    </Card>
  );
}

export function Stat({
  label,
  value,
  note,
  icon,
}: {
  label: string;
  value: ReactNode;
  note?: ReactNode;
  icon?: ReactNode;
}) {
  return (
    <Card className="p-5">
      <div className="flex items-center gap-2.5">
        {icon && (
          <span className="flex h-7 w-7 items-center justify-center rounded-md ring-1 ring-border">
            {icon}
          </span>
        )}
        <span className="text-[10.5px] font-semibold uppercase tracking-[0.14em]">{label}</span>
      </div>
      <div className="mt-4 flex items-center gap-2">
        <span className="font-mono text-[30px] font-medium leading-none tracking-tight tabular-nums">
          {value}
        </span>
      </div>
      {note && <div className="mt-2.5 text-[12px] text-muted-foreground">{note}</div>}
    </Card>
  );
}

export function TableCard({ children }: { children: ReactNode }) {
  return (
    <Card className="overflow-hidden [&_.ledger]:rounded-none [&_.ledger]:border-0">
      {children}
    </Card>
  );
}

export const pad = (n: number) => String(n).padStart(2, "0");
