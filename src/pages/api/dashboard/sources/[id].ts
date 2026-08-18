import type { NextApiRequest, NextApiResponse } from "next";
import type { DataSource } from "@prisma/client";
import { getAuthSession } from "@/lib/auth";
import prisma from "@/lib/db";
import { logHuman } from "@/lib/audit";
import { requireTenant, respondError } from "@/lib/queries";
import { apiOk, type ApiResponse } from "@/types/api";

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<ApiResponse<DataSource | { id: string }>>
) {
  const session = await getAuthSession(req, res);
  if (!session) return respondError(res, "UNAUTHORIZED", "Masuk diperlukan.");
  const tenantId = requireTenant(session);

  const { id } = req.query;
  if (typeof id !== "string") {
    return respondError(res, "VALIDATION_ERROR", "ID sumber data tidak valid.");
  }

  if (req.method === "GET") {
    const source = await prisma.dataSource.findFirst({ where: { id, tenantId } });
    if (!source) return respondError(res, "NOT_FOUND", "Sumber data tidak ditemukan.");
    return res.status(200).json(apiOk(source));
  }

  if (req.method === "DELETE") {
    // "Disconnect" a source: hard delete the record. Credentials stored in
    // config Json are removed with it. Phase 4 wires the actual sync teardown.
    const existing = await prisma.dataSource.findFirst({ where: { id, tenantId } });
    if (!existing) return respondError(res, "NOT_FOUND", "Sumber data tidak ditemukan.");
    await prisma.dataSource.delete({ where: { id } });
    await logHuman({
      tenantId,
      action: "source.delete",
      entityType: "DataSource",
      entityId: id,
      beforeValue: existing,
    });
    return res.status(200).json(apiOk({ id }));
  }

  return respondError(res, "VALIDATION_ERROR", "Metode tidak didukung.");
}
