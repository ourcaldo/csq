import type { NextApiRequest, NextApiResponse } from "next";
import { z } from "zod";
import { getAuthSession } from "@csq/core/lib/auth";
import prisma from "@csq/core/lib/db";
import { requireTenant, respondError } from "@csq/core/lib/queries";
import { withTenantContext } from "@csq/core/lib/tenant-context";
import { apiOk, type ApiResponse } from "@csq/core/types/api";
import { inboxNotifyScope, type InboxNotifyScope } from "@csq/core/lib/push-notify";
import { toJsonValue } from "@csq/core/lib/audit";

// PRD 30: the user's own inbox notification preference + the VAPID public
// key the client needs to subscribe to Web Push. Self-service only: a
// user reads and writes exactly their own row, never anyone else's.

const bodySchema = z.object({
  inboxNotify: z.enum(["all", "assigned", "off"]),
});

export type NotificationPrefsView = {
  inboxNotify: InboxNotifyScope;
  vapidPublicKey: string | null;
};

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<ApiResponse<NotificationPrefsView>>
) {
  const session = await getAuthSession(req, res);
  if (!session) return respondError(res, "UNAUTHORIZED", "Masuk diperlukan.");
  const tenantId = requireTenant(session);

  return withTenantContext(tenantId, async () => {
    if (req.method === "GET") {
      const user = await prisma.user.findUnique({
        where: { id: session.user.id },
        select: { notificationPrefs: true },
      });
      return res.status(200).json(
        apiOk({
          inboxNotify: inboxNotifyScope(user?.notificationPrefs),
          vapidPublicKey: process.env.VAPID_PUBLIC_KEY ?? null,
        })
      );
    }
    if (req.method === "POST") {
      const parsed = bodySchema.safeParse(req.body);
      if (!parsed.success) {
        return respondError(res, "VALIDATION_ERROR", "Preferensi notifikasi tidak valid.");
      }
      const existing = await prisma.user.findUnique({
        where: { id: session.user.id },
        select: { notificationPrefs: true },
      });
      const current: Record<string, unknown> = {};
      if (
        existing?.notificationPrefs &&
        typeof existing.notificationPrefs === "object" &&
        !Array.isArray(existing.notificationPrefs)
      ) {
        for (const [k, v] of Object.entries(existing.notificationPrefs)) {
          current[k] = v;
        }
      }
      const merged = toJsonValue({ ...current, inboxNotify: parsed.data.inboxNotify });
      await prisma.user.update({
        where: { id: session.user.id },
        data: { notificationPrefs: merged },
      });
      return res.status(200).json(
        apiOk({
          inboxNotify: parsed.data.inboxNotify,
          vapidPublicKey: process.env.VAPID_PUBLIC_KEY ?? null,
        })
      );
    }
    return respondError(res, "VALIDATION_ERROR", "Metode tidak didukung.");
  });
}
