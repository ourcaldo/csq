import type { NextApiRequest, NextApiResponse } from "next";
import { z } from "zod";
import { getAuthSession } from "@csq/core/lib/auth";
import prisma from "@csq/core/lib/db";
import { requireTenant, respondError } from "@csq/core/lib/queries";
import { withTenantContext } from "@csq/core/lib/tenant-context";
import { apiOk, type ApiResponse } from "@csq/core/types/api";

// PRD 30: store / remove one Web Push subscription for the CALLING user.
// Self-service: userId always comes from the session, never the body. The
// endpoint is unique globally, so re-subscribing the same browser upserts
// instead of duplicating (a shared device that changes accounts moves the
// row to the new user).

const subscribeSchema = z.object({
  endpoint: z.string().url().max(2000),
  keys: z.object({
    p256dh: z.string().min(1).max(500),
    auth: z.string().min(1).max(500),
  }),
});

const unsubscribeSchema = z.object({
  endpoint: z.string().url().max(2000),
});

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<ApiResponse<{ subscribed: boolean }>>
) {
  const session = await getAuthSession(req, res);
  if (!session) return respondError(res, "UNAUTHORIZED", "Masuk diperlukan.");
  const tenantId = requireTenant(session);

  return withTenantContext(tenantId, async () => {
    if (req.method === "POST") {
      const parsed = subscribeSchema.safeParse(req.body);
      if (!parsed.success) {
        return respondError(res, "VALIDATION_ERROR", "Langganan push tidak valid.");
      }
      await prisma.pushSubscription.upsert({
        where: { endpoint: parsed.data.endpoint },
        update: {
          tenantId,
          userId: session.user.id,
          p256dh: parsed.data.keys.p256dh,
          auth: parsed.data.keys.auth,
        },
        create: {
          tenantId,
          userId: session.user.id,
          endpoint: parsed.data.endpoint,
          p256dh: parsed.data.keys.p256dh,
          auth: parsed.data.keys.auth,
        },
      });
      return res.status(200).json(apiOk({ subscribed: true }));
    }
    if (req.method === "DELETE") {
      const parsed = unsubscribeSchema.safeParse(req.body);
      if (!parsed.success) {
        return respondError(res, "VALIDATION_ERROR", "Langganan push tidak valid.");
      }
      // Scoped to the caller: a user can only remove their own row.
      await prisma.pushSubscription.deleteMany({
        where: { endpoint: parsed.data.endpoint, userId: session.user.id, tenantId },
      });
      return res.status(200).json(apiOk({ subscribed: false }));
    }
    return respondError(res, "VALIDATION_ERROR", "Metode tidak didukung.");
  });
}
