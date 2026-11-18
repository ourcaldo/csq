import type { NextApiRequest, NextApiResponse } from "next";
import { getAuthSession } from "@csq/core/lib/auth";
import prisma from "@csq/core/lib/db";
import { requireTenant, respondError } from "@csq/core/lib/queries";
import { withTenantContext } from "@csq/core/lib/tenant-context";

// Contact export (owner request 2026-11-18): CSV download of the tenant's
// contacts, including category and tag names. Any signed-in team member can
// pull it (read-only, same data the table shows).
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "GET") {
    return respondError(res, "VALIDATION_ERROR", "Metode tidak didukung.");
  }
  const session = await getAuthSession(req, res);
  if (!session) return respondError(res, "UNAUTHORIZED", "Masuk diperlukan.");
  const tenantId = requireTenant(session);

  return withTenantContext(tenantId, async () => {
    const rows = await prisma.contact.findMany({
      where: { tenantId },
      orderBy: { createdAt: "desc" },
      include: {
        categories: { include: { category: true } },
        tags: { include: { tag: true } },
      },
    });

    const esc = (v: string | null) => {
      const s = v ?? "";
      return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const header = "nama,nomor,email,catatan,kategori,tag,dibuat";
    const lines = rows.map((c) =>
      [
        esc(c.name),
        c.phone,
        esc(c.email),
        esc(c.notes),
        esc(c.categories.map((x) => x.category.name).join("; ")),
        esc(c.tags.map((x) => x.tag.name).join("; ")),
        c.createdAt.toISOString(),
      ].join(",")
    );
    const csv = [header, ...lines].join("\r\n");

    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="kontak-${new Date().toISOString().slice(0, 10)}.csv"`
    );
    return res.status(200).send(csv);
  });
}
