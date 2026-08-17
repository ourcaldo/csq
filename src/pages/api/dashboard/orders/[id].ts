import type { NextApiRequest, NextApiResponse } from "next";
import type { Prisma } from "@prisma/client";
import { getAuthSession } from "@/lib/auth";
import prisma from "@/lib/db";
import { requireTenant, respondError } from "@/lib/queries";
import { apiOk, type ApiResponse } from "@/types/api";
import { orderStatusUpdateSchema } from "@/types/order";

type OrderWithItems = Prisma.OrderGetPayload<{ include: { items: true } }>;

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<ApiResponse<OrderWithItems>>
) {
  const session = await getAuthSession(req, res);
  if (!session) return respondError(res, "UNAUTHORIZED", "Masuk diperlukan.");
  const tenantId = requireTenant(session);

  const { id } = req.query;
  if (typeof id !== "string") {
    return respondError(res, "VALIDATION_ERROR", "ID pesanan tidak valid.");
  }

  if (req.method === "GET") {
    const order = await prisma.order.findFirst({
      where: { id, tenantId },
      include: { items: true },
    });
    if (!order) return respondError(res, "NOT_FOUND", "Pesanan tidak ditemukan.");
    return res.status(200).json(apiOk(order));
  }

  if (req.method === "PUT") {
    const parsed = orderStatusUpdateSchema.safeParse(req.body);
    if (!parsed.success) {
      return respondError(res, "VALIDATION_ERROR", parsed.error.message);
    }
    const existing = await prisma.order.findFirst({ where: { id, tenantId } });
    if (!existing) return respondError(res, "NOT_FOUND", "Pesanan tidak ditemukan.");
    const order = await prisma.order.update({
      where: { id },
      data: { status: parsed.data.status },
      include: { items: true },
    });
    return res.status(200).json(apiOk(order));
  }

  return respondError(res, "VALIDATION_ERROR", "Metode tidak didukung.");
}
