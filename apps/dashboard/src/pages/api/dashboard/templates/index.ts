import type { NextApiRequest, NextApiResponse } from "next";
import { z } from "zod";
import { getAuthSession, requireRole } from "@/lib/auth";
import prisma from "@/lib/db";
import { requireTenant, respondError } from "@/lib/queries";
import { apiOk, type ApiResponse } from "@/types/api";
import {
  listTemplates,
  saveTemplates,
  messageTemplateSchema,
  SYSTEM_TEMPLATE_KEYS,
  type MessageTemplate,
} from "@/lib/message-templates";
import crypto from "crypto";

// CRUD for per-tenant message templates (Tenant.settings.messageTemplates).
// Read: any tenant user. Write: OWNER only.
// GET    → { items, systemKeys }
// PUT    → replace the whole list (simplest consistent save from the UI)
// POST   → append one template (server generates the id)
// DELETE → remove by id (query ?id=)

type ListResult = {
  items: MessageTemplate[];
  systemKeys: typeof SYSTEM_TEMPLATE_KEYS;
};

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<ApiResponse<ListResult | MessageTemplate>>
): Promise<void> {
  const session = await getAuthSession(req, res);
  if (!session) return respondError(res, "UNAUTHORIZED", "Masuk diperlukan.");
  const tenantId = requireTenant(session);

  if (req.method === "GET") {
    const items = await listTemplates(tenantId);
    return res
      .status(200)
      .json(apiOk({ items, systemKeys: SYSTEM_TEMPLATE_KEYS }));
  }

  if (!requireRole(session, "OWNER")) {
    return respondError(res, "PERMISSION_DENIED", "Hanya owner.");
  }

  if (req.method === "PUT") {
    const parsed = z.array(messageTemplateSchema).safeParse(req.body);
    if (!parsed.success) {
      return respondError(res, "VALIDATION_ERROR", parsed.error.message);
    }
    await saveTemplates(tenantId, parsed.data);
    return res
      .status(200)
      .json(apiOk({ items: parsed.data, systemKeys: SYSTEM_TEMPLATE_KEYS }));
  }

  if (req.method === "POST") {
    const base = z.object({
      key: messageTemplateSchema.shape.key,
      label: messageTemplateSchema.shape.label,
      kind: messageTemplateSchema.shape.kind,
      body: messageTemplateSchema.shape.body,
      metaName: messageTemplateSchema.shape.metaName,
      metaLanguage: messageTemplateSchema.shape.metaLanguage,
    });
    const parsed = base.safeParse(req.body);
    if (!parsed.success) {
      return respondError(res, "VALIDATION_ERROR", parsed.error.message);
    }
    const existing = await listTemplates(tenantId);
    // One template per (key, kind): editing replaces rather than duplicates.
    const filtered = existing.filter(
      (t) => !(t.key === parsed.data.key && t.kind === parsed.data.kind)
    );
    const created: MessageTemplate = {
      ...parsed.data,
      id: crypto.randomUUID(),
    };
    await saveTemplates(tenantId, [...filtered, created]);
    return res.status(200).json(apiOk(created));
  }

  if (req.method === "DELETE") {
    const id = typeof req.query.id === "string" ? req.query.id : "";
    if (!id) return respondError(res, "VALIDATION_ERROR", "ID tidak valid.");
    const existing = await listTemplates(tenantId);
    const next = existing.filter((t) => t.id !== id);
    await saveTemplates(tenantId, next);
    return res
      .status(200)
      .json(apiOk({ items: next, systemKeys: SYSTEM_TEMPLATE_KEYS }));
  }

  return respondError(res, "VALIDATION_ERROR", "Metode tidak didukung.");
}
