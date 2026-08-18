import type { NextApiRequest, NextApiResponse } from "next";
import { Decimal } from "@prisma/client/runtime/library";
import type { Prisma } from "@prisma/client";
import { getAuthSession } from "@/lib/auth";
import prisma from "@/lib/db";
import { HttpError, requireTenant, respondError } from "@/lib/queries";
import { apiOk, type ApiResponse } from "@/types/api";
import { orderCreateSchema } from "@/types/order";

type CreatedOrder = Prisma.OrderGetPayload<{ include: { items: true } }>;

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<ApiResponse<CreatedOrder>>
) {
  const session = await getAuthSession(req, res);
  if (!session) return respondError(res, "UNAUTHORIZED", "Masuk diperlukan.");
  const tenantId = requireTenant(session);

  if (req.method !== "POST") {
    return respondError(res, "VALIDATION_ERROR", "Metode tidak didukung.");
  }

  const parsed = orderCreateSchema.safeParse(req.body);
  if (!parsed.success) {
    return respondError(res, "VALIDATION_ERROR", parsed.error.message);
  }
  const { items: inputItems, customerName, customerPhone } = parsed.data;

  try {
    const order = await prisma.$transaction(async (tx) => {
      // Resolve every line item: product + its inventory, tenant-scoped.
      const lines = await Promise.all(
        inputItems.map(async (item) => {
          const product = await tx.product.findUnique({
            where: { id: item.productId },
            include: { inventory: true },
          });
          if (!product || product.tenantId !== tenantId) {
            throw new HttpError("NOT_FOUND", `Produk ${item.productId} tidak ditemukan.`);
          }
          const available = product.inventory?.quantity ?? 0;
          if (available < item.quantity) {
            throw new HttpError(
              "VALIDATION_ERROR",
              `Stok tidak cukup untuk ${product.name} (tersisa ${available}).`
            );
          }
          const unitPrice = product.price; // Prisma.Decimal
          const subtotal = unitPrice.mul(item.quantity);
          return {
            productId: item.productId,
            quantity: item.quantity,
            unitPrice,
            subtotal,
          };
        })
      );

      const totalAmount = lines.reduce(
        (sum, line) => sum.plus(line.subtotal),
        new Decimal(0)
      );

      // Decrement inventory for every line, atomically within the tx.
      for (const line of lines) {
        await tx.inventory.update({
          where: { productId: line.productId },
          data: { quantity: { decrement: line.quantity }, source: "MANUAL" },
        });
      }

      return tx.order.create({
        data: {
          tenantId,
          customerName,
          customerPhone,
          totalAmount,
          items: {
            create: lines.map((line) => ({
              tenantId,
              productId: line.productId,
              quantity: line.quantity,
              unitPrice: line.unitPrice,
              subtotal: line.subtotal,
            })),
          },
        },
        include: { items: true },
      });
    });

    return res.status(201).json(apiOk(order));
  } catch (err) {
    if (err instanceof HttpError) {
      return respondError(res, err.code, err.message);
    }
    return respondError(res, "INTERNAL_ERROR", "Gagal membuat pesanan.");
  }
}
