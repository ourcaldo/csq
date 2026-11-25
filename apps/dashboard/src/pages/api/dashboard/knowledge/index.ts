import type { NextApiRequest, NextApiResponse } from "next";
import type { Knowledge, KnowledgeType, Prisma } from "@prisma/client";
import { getAuthSession, requirePermission } from "@csq/core/lib/auth";
import prisma from "@csq/core/lib/db";
import { paginate, requireTenant, respondError, strQuery } from "@csq/core/lib/queries";
import { withTenantContext } from "@csq/core/lib/tenant-context";
import { apiOk, type ApiResponse } from "@csq/core/types/api";
import type { KnowledgeGroup, KnowledgeStats } from "@csq/core/types/dashboard";

// String → enum lookup (avoids `as`-narrowing from a Set.has guard).
const TYPE_BY_KEY: Record<string, KnowledgeType> = {
  FAQ: "FAQ",
  POLICY: "POLICY",
  BUSINESS_INFO: "BUSINESS_INFO",
};

type ListResult = {
  items: KnowledgeGroup[];
  stats: KnowledgeStats;
  total: number;
  page: number;
  pageSize: number;
};

// PRD 31: rows sharing a groupId collapse into one list item. Pagination is
// over GROUPS (groupBy on groupId with skip/take), never raw rows, so the
// page size stays 10 entries regardless of how many pairs an entry holds.
function toGroup(rows: Knowledge[]): KnowledgeGroup {
  const first = rows[0];
  const pairCount = rows.length;
  const preview =
    first.type === "FAQ"
      ? `${pairCount} pertanyaan: ${rows
          .map((r) => r.title)
          .slice(0, 2)
          .join(" | ")}${pairCount > 2 ? ` (+${pairCount - 2} lagi)` : ""}`
      : first.content;
  let updatedAt = rows[0].updatedAt;
  for (const row of rows) {
    if (row.updatedAt > updatedAt) updatedAt = row.updatedAt;
  }
  return {
    id: first.groupId,
    type: first.type,
    category: first.category,
    title: first.title,
    preview,
    pairCount,
    pairs: rows.map((r) => ({ id: r.id, q: r.title, a: r.content })),
    sourceName: first.sourceName,
    updatedAt: updatedAt.toISOString(),
  };
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<ApiResponse<KnowledgeGroup[] | ListResult>>
) {
  const session = await getAuthSession(req, res);
  if (!session) return respondError(res, "UNAUTHORIZED", "Masuk diperlukan.");
  const tenantId = requireTenant(session);
  // Audit run-4 (ungated-list-read): the catalog's read key gates this
  // route - a role without pengetahuan.kelola must not read this data.
  if (!requirePermission(session, "pengetahuan.kelola")) {
    return respondError(res, "PERMISSION_DENIED", "Tidak punya akses.");
  }

  return withTenantContext(tenantId, async () => {
    if (req.method === "GET") {
      const { skip, take, page, pageSize } = paginate(req.query);
      const typeKey = strQuery(req.query, "type");
      const type = typeKey ? TYPE_BY_KEY[typeKey] : undefined;
      const q = strQuery(req.query, "q")?.trim();
      const sortKey = strQuery(req.query, "sort");

      const where: Prisma.KnowledgeWhereInput = {
        tenantId,
        ...(type ? { type } : {}),
        ...(q
          ? {
              OR: [
                { title: { contains: q, mode: "insensitive" } },
                { content: { contains: q, mode: "insensitive" } },
                { category: { contains: q, mode: "insensitive" } },
              ],
            }
          : {}),
      };

      const orderBy: Prisma.KnowledgeOrderByWithAggregationInput[] =
        sortKey === "title"
          ? [{ _min: { title: "asc" } }]
          : sortKey === "type"
            ? [{ _max: { type: "asc" } }, { _max: { updatedAt: "desc" } }]
            : [{ _max: { updatedAt: "desc" } }];

      const [groupPage, allGroups, statGroups] = await Promise.all([
        prisma.knowledge.groupBy({
          by: ["groupId"],
          where,
          orderBy,
          skip,
          take,
        }),
        prisma.knowledge.groupBy({ by: ["groupId"], where }),
        prisma.knowledge.groupBy({ by: ["groupId", "type"], where: { tenantId } }),
      ]);
      const pageIds = groupPage.map((g) => g.groupId);
      const pageRows = await prisma.knowledge.findMany({
        where: { tenantId, groupId: { in: pageIds } },
        orderBy: { createdAt: "asc" },
      });
      const byGroup = new Map<string, Knowledge[]>();
      for (const row of pageRows) {
        const list = byGroup.get(row.groupId);
        if (list) list.push(row);
        else byGroup.set(row.groupId, [row]);
      }

      const stats: KnowledgeStats = {
        total: statGroups.length,
        FAQ: statGroups.filter((g) => g.type === "FAQ").length,
        POLICY: statGroups.filter((g) => g.type === "POLICY").length,
        BUSINESS_INFO: statGroups.filter((g) => g.type === "BUSINESS_INFO").length,
      };

      const items = pageIds
        .map((id) => byGroup.get(id))
        .filter((rowsInGroup): rowsInGroup is Knowledge[] => !!rowsInGroup)
        .map(toGroup);

      return res
        .status(200)
        .json(apiOk({ items, stats, total: allGroups.length, page, pageSize }));
    }

    return respondError(res, "VALIDATION_ERROR", "Metode tidak didukung.");
  });
}
