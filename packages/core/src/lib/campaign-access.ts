import type { Session } from "next-auth";

// Campaign access gate (feature plan 2026-11-01, decision 2.2): the OWNER
// role always has it; a STAFF member only when the owner has toggled the
// per-staff "Boleh jalankan kampanye" switch on the Team page.
export function canRunCampaigns(session: Session): boolean {
  return session.user.role === "OWNER" || session.user.canRunCampaigns;
}
