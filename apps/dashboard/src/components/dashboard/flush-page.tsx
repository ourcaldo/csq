// Scroll container for pages that render their own header inside DashboardShell
// flush mode. Flush sets <main> to overflow-hidden (correct for fixed-pane
// screens like the inbox and pipeline), so a normal document-style page needs
// its own scroller or tall content is clipped with no way to reach it.
// Owner bug report 2026-11-22: "I can't scroll on the single agent page".
import type { ReactNode } from "react";

export function FlushPage({ children }: { children: ReactNode }) {
  return (
    <div className="scrollbar-slim min-h-0 flex-1 overflow-y-auto">
      {/* Full-width canvas like the owner's request (2026-11-22): no
          max-width cap, no centering - content fills the space beside the
          sidebar on any screen size. */}
      <div className="w-full px-4 py-7 md:px-8">{children}</div>
    </div>
  );
}
