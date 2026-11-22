import type { NextApiRequest, NextApiResponse } from "next";
import { getAuthSession, requireRole } from "@csq/core/lib/auth";
import prisma from "@csq/core/lib/db";
import { requireTenant, respondError, strQuery } from "@csq/core/lib/queries";
import { withTenantContext } from "@csq/core/lib/tenant-context";
import { apiOk, type ApiResponse } from "@csq/core/types/api";
import { logHuman } from "@csq/core/lib/audit";

// Permanently delete a channel (owner request 2026-11-18 - this overrides
// the PRD 15 archive-only rule; archive stays available as the safe path).
// DISCONNECTED-only: a live socket must be torn down first. The FK cascade
// removes conversations, messages, outbox rows and commands; Campaign rows
// keep their plain channelId scalar by design (they fail their fire-time
// channel check instead of vanishing). BaileysAuth, LidMapping and the
// baileys-socket lease have no FK to Channel, so they are removed here.
export type DeleteResult = { id: string };

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<ApiResponse<DeleteResult>>
) {
  if (req.method !== "POST") {
    return respondError(res, "VALIDATION_ERROR", "Metode tidak didukung.");
  }

  const session = await getAuthSession(req, res);
  if (!session) return respondError(res, "UNAUTHORIZED", "Masuk diperlukan.");
  if (!requireRole(session, "OWNER")) {
    return respondError(res, "PERMISSION_DENIED", "Hanya owner yang dapat menghapus channel.");
  }
  const tenantId = requireTenant(session);

  return withTenantContext(tenantId, async () => {
    const id = strQuery(req.query, "id");
    if (!id) return respondError(res, "VALIDATION_ERROR", "ID channel tidak valid.");

    const channel = await prisma.channel.findFirst({ where: { id, tenantId } });
    if (!channel) return respondError(res, "NOT_FOUND", "Channel tidak ditemukan.");
    if (channel.status === "CONNECTED") {
      return respondError(
        res,
        "VALIDATION_ERROR",
        "Putuskan saluran ini sebelum menghapus."
      );
    }

    // No-FK satellites: Baileys auth state, LID mappings, socket lease.
    await prisma.baileysAuth.deleteMany({ where: { channelId: channel.id } });
    await prisma.lidMapping.deleteMany({ where: { channelId: channel.id } });
    await prisma.systemLock.deleteMany({
      where: { key: { startsWith: `baileys-socket:${channel.id}` } },
    });

    // FK cascade: conversations + messages, outbox, channel commands.
    await prisma.channel.delete({ where: { id: channel.id } });

    await logHuman({
        actorEmail: session.user.email ?? undefined,
      tenantId,
      action: "channel.delete",
      entityType: "Channel",
      entityId: channel.id,
      afterValue: { label: channel.label, provider: channel.provider },
    });

    return res.status(200).json(apiOk({ id: channel.id }));
  });
}
