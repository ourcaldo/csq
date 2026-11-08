import type { NextApiRequest, NextApiResponse } from "next";
import { getAuthSession } from "@/lib/auth";
import prisma from "@/lib/db";
import { requireTenant, respondError, strQuery } from "@/lib/queries";
import { apiOk, type ApiResponse } from "@/types/api";

type StatusResult = {
  id: string;
  status: string;
  lastSyncAt: string | null;
};

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<ApiResponse<StatusResult>>
) {
  const session = await getAuthSession(req, res);
  if (!session) return respondError(res, "UNAUTHORIZED", "Masuk diperlukan.");
  const tenantId = requireTenant(session);

  if (req.method !== "GET") {
    return respondError(res, "VALIDATION_ERROR", "Metode tidak didukung.");
  }

  const id = strQuery(req.query, "id");
  if (!id) return respondError(res, "VALIDATION_ERROR", "Parameter id diperlukan.");

  const source = await prisma.dataSource.findFirst({ where: { id, tenantId } });
  if (!source) return respondError(res, "NOT_FOUND", "Sumber data tidak ditemukan.");

  return res.status(200).json(
    apiOk({
      id: source.id,
      status: source.status,
      lastSyncAt: source.lastSyncAt ? source.lastSyncAt.toISOString() : null,
    })
  );
}
