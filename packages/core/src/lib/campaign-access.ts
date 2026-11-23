import type { Session } from "next-auth";

// Campaign access gate. PRD 29: the per-staff canRunCampaigns toggle is
// retired - kampanye.kelola is a role permission; the owner always has it.
export function canRunCampaigns(session: Session): boolean {
  return session.user.isOwner || session.user.permissions.includes("kampanye.kelola");
}
