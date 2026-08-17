import type { NextApiRequest, NextApiResponse } from "next";
import { getAuthSession } from "@/lib/auth";
import prisma from "@/lib/db";
import { parseFile, applyMapping } from "@/services/excel";
import { excelConfirmSchema } from "@/types/import";
import { apiError, apiOk, type ApiResponse } from "@/types/api";

type ConfirmResponse = { imported: number; dataSourceId: string };

// Step 2: owner has confirmed the column mapping. Re-parse, apply the mapping,
// upsert products + inventory (tenant-scoped), and record an EXCEL DataSource
// with the mapping stored in config. Transactional; tenant from session only.
export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<ApiResponse<ConfirmResponse>>
) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json(apiError("INTERNAL_ERROR", "Method not allowed"));
  }

  const session = await getAuthSession(req, res);
  if (!session) return res.status(401).json(apiError("UNAUTHORIZED", "Masuk dulu."));

  const parsed = excelConfirmSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json(apiError("VALIDATION_ERROR", parsed.error.issues[0]?.message ?? "Invalid input"));
  }

  const { filename, base64, mapping } = parsed.data;
  const tenantId = session.user.tenantId;
  const { rows } = await parseFile(Buffer.from(base64, "base64"), filename);
  const products = applyMapping(rows, mapping);

  const result = await prisma.$transaction(async (tx) => {
    const dataSource = await tx.dataSource.create({
      data: {
        tenantId,
        type: "EXCEL",
        name: filename,
        config: { filename, mapping },
        status: "ACTIVE",
        lastSyncAt: new Date(),
      },
    });

    let imported = 0;
    for (const p of products) {
      const existing = p.sku ? await tx.product.findFirst({ where: { tenantId, sku: p.sku } }) : null;
      const product = existing
        ? await tx.product.update({
            where: { id: existing.id },
            data: { name: p.name, price: p.price, description: p.description },
          })
        : await tx.product.create({
            data: { tenantId, name: p.name, sku: p.sku, price: p.price, description: p.description },
          });

      if (p.stock != null) {
        await tx.inventory.upsert({
          where: { productId: product.id },
          update: { quantity: p.stock, source: "EXCEL", sourceRef: filename },
          create: { tenantId, productId: product.id, quantity: p.stock, source: "EXCEL", sourceRef: filename },
        });
      }
      imported++;
    }
    return { imported, dataSourceId: dataSource.id };
  });

  return res.status(201).json(apiOk(result));
}
