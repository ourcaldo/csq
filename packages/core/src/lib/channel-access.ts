import type { Session } from "next-auth";
import prisma from "@csq/core/lib/db";
import { ROLE_AKSES_PENUH } from "@csq/core/lib/permissions-catalog";

// PRD 29 section 6: per-channel access resolution. Three independent
// grants per ChannelAccess row: canView (LIHAT), canCompose (KIRIM),
// canManage (KELOLA - the WhatsApp session pairing power, section 6.1).
//
// Lockout rules (PRD 29 section 7): the OWNER always sees every channel,
// and so does every user holding the system role Akses Penuh (system-role
// check, not an implicit true) - a channel with no grants stays visible to
// them and a freshly-added channel is never invisible to everyone.
//
// All functions must run inside withTenantContext (ChannelAccess is a
// tenant table under RLS).

type ChannelFlag = "canView" | "canCompose" | "canManage";

async function isUnrestricted(session: Session): Promise<boolean> {
  if (session.user.isOwner) return true;
  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { role: { select: { name: true, isSystem: true } } },
  });
  const role = user?.role;
  return !!role && role.isSystem && role.name === ROLE_AKSES_PENUH;
}

async function grantedChannelIds(
  session: Session,
  flag: ChannelFlag
): Promise<string[]> {
  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { roleId: true },
  });
  const rows = await prisma.channelAccess.findMany({
    where: {
      tenantId: session.user.tenantId,
      OR: [
        { principal: "USER", principalId: session.user.id },
        ...(user?.roleId
          ? [{ principal: "ROLE" as const, principalId: user.roleId }]
          : []),
      ],
      ...(flag === "canView"
        ? { canView: true }
        : flag === "canCompose"
          ? { canCompose: true }
          : { canManage: true }),
    },
    select: { channelId: true },
  });
  return [...new Set(rows.map((r) => r.channelId))];
}

// The channel ids the user may SEE (inbox scope, channel pills, composer
// override list). null = unrestricted (owner / Akses Penuh).
export async function visibleChannelIds(session: Session): Promise<string[] | null> {
  if (await isUnrestricted(session)) return null;
  return grantedChannelIds(session, "canView");
}

// The channel ids the user may COMPOSE on. null = unrestricted.
export async function composeChannelIds(session: Session): Promise<string[] | null> {
  if (await isUnrestricted(session)) return null;
  return grantedChannelIds(session, "canCompose");
}

// The channel ids the user may MANAGE (KELOLA). null = unrestricted.
export async function manageChannelIds(session: Session): Promise<string[] | null> {
  if (await isUnrestricted(session)) return null;
  return grantedChannelIds(session, "canManage");
}

// KELOLA on one channel: QR scan, connect, disconnect, test send. The
// strongest grant in the system (session pairing power, section 6.1).
export async function canManageChannel(
  session: Session,
  channelId: string
): Promise<boolean> {
  if (await isUnrestricted(session)) return true;
  const ids = await grantedChannelIds(session, "canManage");
  return ids.includes(channelId);
}

// Can the user send on this conversation's channel at all (compose grant or
// unrestricted)? Used by the inbox send paths.
export async function canComposeOn(
  session: Session,
  channelId: string
): Promise<boolean> {
  const ids = await composeChannelIds(session);
  return ids === null || ids.includes(channelId);
}
