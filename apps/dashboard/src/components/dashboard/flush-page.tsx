// Scroll container for pages that render their own header inside DashboardShell
// flush mode. Flush sets <main> to overflow-hidden (correct for fixed-pane
// screens like the inbox and pipeline), so a normal document-style page needs
// its own scroller or tall content is clipped with no way to reach it.
// Owner bug report 2026-11-22: "I can't scroll on the single agent page".
import type { ReactNode } from "react";

export function FlushPage({ children }: { children: ReactNode }) {
  return (
    <div className="scrollbar-slim min-h-0 flex-1 overflow-y-auto">
      {/* Left-aligned like every enterprise template (no mx-auto): the canvas
          hugs the sidebar instead of floating centered on wide screens. */}
      <div className="w-full max-w-6xl px-4 py-7 md:px-8">{children}</div>
    </div>
  );
}
