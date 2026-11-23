import type { NextApiRequest, NextApiResponse } from "next";
import { z } from "zod";
import { getAuthSession, requirePermission } from "@csq/core/lib/auth";
import { canManageChannel } from "@csq/core/lib/channel-access";
import prisma from "@csq/core/lib/db";
import { requireTenant, respondError } from "@csq/core/lib/queries";
import { withTenantContext, withSystemContext } from "@csq/core/lib/tenant-context";
import { apiOk, type ApiResponse } from "@csq/core/types/api";
import {
  cloudApiConfigSchema,
  baileysConfigSchema,
  type CloudApiConfig,
  type BaileysConfig,
} from "@csq/core/types/whatsapp";
import { isFatalDisconnect } from "@csq/core/services/baileys";
import { createChannelCommand, awaitChannelCommand } from "@csq/core/lib/channel-commands";
import { getTenantEntitlements } from "@csq/core/lib/entitlements";

// Connect a WhatsApp channel (PRD 15, multi-channel). Each call connects ONE
// channel: reconfiguring an existing channel (channelId given) keeps its
// identity; without channelId a NEW channel row is created. Baileys is gated
// on tosAcknowledged (ToS/ban risk, FR-WA-011) - enforced HERE in the backend,
// not just the UI. For Baileys, starts the socket and returns the QR to scan;
// for Cloud API, the Graph API verifies the phone number ID before anything
// is stored, so a wrong ID fails here instead of at first webhook.

const connectSchema = z.object({
  provider: z.enum(["CLOUD_API", "BAILEYS"]),
  channelId: z.string().uuid().optional(),
  label: z.string().min(1).max(60),
  agentId: z.string().uuid().optional(),
  config: z.unknown(),
});

export type ConnectResult = {
  channelId: string;
  provider: string;
  status: string;
  qr: string | null;
};

// Verify a Cloud API phone number ID against the Graph API and fetch the
// display number + WABA (PRD 15 connect flow). Throws a plain Error with a
// user-facing Indonesian message on failure.
async function verifyPhoneNumberId(
  phoneNumberId: string,
  token: string
): Promise<{ displayNumber: string; wabaId: string | null }> {
  let res: Response;
  try {
    res = await fetch(
      `https://graph.facebook.com/v25.0/${phoneNumberId}?fields=display_phone_number,quality_rating`,
      { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(15_000) }
    );
  } catch {
    throw new Error("Tidak dapat menghubungi Meta. Coba lagi sebentar.");
  }
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    // Surface Meta's own error (wrong ID, bad token, or the registered-
    // number cap) - never fail silently (PRD 15 limits).
    throw new Error(`Verifikasi Meta gagal (${res.status}): ${text.slice(0, 300)}`);
  }
  const json: unknown = await res.json();
  const parsed = z
    .object({
      display_phone_number: z.string().optional(),
      // The phone number's parent WABA comes back on the id-with-fields call.
      id: z.string(),
    })
    .safeParse(json);
  if (!parsed.success) {
    throw new Error("Respon Meta tidak dikenal. Periksa Phone Number ID dan token.");
  }
  return {
    displayNumber: parsed.data.display_phone_number ?? "",
    wabaId: null,
  };
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<ApiResponse<ConnectResult>>
) {
  if (req.method !== "POST") {
    return respondError(res, "VALIDATION_ERROR", "Metode tidak didukung.");
  }

  const session = await getAuthSession(req, res);
  if (!session) return respondError(res, "UNAUTHORIZED", "Masuk diperlukan.");
  // PRD 29: adding a channel needs saluran.tambah, reconfiguring an
  // existing one saluran.ubah - refined per case after the body parses.
  if (
    !requirePermission(session, "saluran.tambah") &&
    !requirePermission(session, "saluran.ubah")
  ) {
    return respondError(res, "PERMISSION_DENIED", "Tidak punya izin mengelola saluran.");
  }
  const tenantId = requireTenant(session);

  return withTenantContext(tenantId, async () => {
    const parsed = connectSchema.safeParse(req.body);
    if (!parsed.success) {
      return respondError(res, "VALIDATION_ERROR", parsed.error.message);
    }
    const { provider, channelId, label, agentId } = parsed.data;
    // Audit run-4 (connect-kelola-overscope): a KELOLA-only caller (no
    // saluran.ubah) reaches this branch for the branch QR-scan scenario -
    // that is RE-PAIRING, not reconfiguration. Everything below restricts
    // their writes to the pairing config; label, agent binding, provider
    // switch, and Cloud API credential swaps keep requiring saluran.ubah.
    let rePairOnly = false;
    if (channelId && !requirePermission(session, "saluran.ubah")) {
      const chan = await prisma.channel.findFirst({ where: { id: channelId, tenantId } });
      if (!chan || !(await canManageChannel(session, chan.id))) {
        return respondError(res, "PERMISSION_DENIED", "Tidak punya izin mengubah saluran.");
      }
      rePairOnly = true;
      if (provider !== chan.provider) {
        return respondError(
          res,
          "PERMISSION_DENIED",
          "Perubahan provider membutuhkan izin saluran.ubah."
        );
      }
      if (provider === "CLOUD_API") {
        return respondError(
          res,
          "PERMISSION_DENIED",
          "Konfigurasi Cloud API membutuhkan izin saluran.ubah."
        );
      }
    }
    if (!channelId && !requirePermission(session, "saluran.tambah")) {
      return respondError(res, "PERMISSION_DENIED", "Tidak punya izin menambah saluran.");
    }
    // Audit run-4 (connect-agentid-tenant): the agent binding is a
    // cross-entity reference - verify the agent belongs to this tenant
    // before writing it (mirrors channels/[id].ts PATCH).
    if (agentId) {
      const agent = await prisma.agent.findFirst({
        where: { id: agentId, tenantId },
        select: { id: true },
      });
      if (!agent) {
        return respondError(res, "VALIDATION_ERROR", "Agent tidak ditemukan dalam tenant ini.");
      }
    }

    // Existing row only when reconfiguring that specific channel.
    const existing = channelId
      ? await prisma.channel.findFirst({ where: { id: channelId, tenantId } })
      : null;
    if (channelId && !existing) {
      return respondError(res, "NOT_FOUND", "Channel tidak ditemukan.");
    }

    // Plan channel limit (PRD 14/15): only CONNECTED channels count.
    // Reconfiguring an already-connected channel is always allowed.
    const alreadyConnected = existing?.status === "CONNECTED";
    if (!alreadyConnected) {
      const entitlements = await getTenantEntitlements(tenantId);
      if (entitlements.channelLimit !== null) {
        const active = await prisma.channel.count({
          where: { tenantId, status: "CONNECTED" },
        });
        if (active >= entitlements.channelLimit) {
          return respondError(
            res,
            "PERMISSION_DENIED",
            `Paket ${entitlements.planName ?? "tenant"} hanya mendukung ${entitlements.channelLimit} saluran aktif.`
          );
        }
      }
    }

    let config: CloudApiConfig | BaileysConfig;
    let status: "CONNECTED" | "DISCONNECTED";
    // Identity columns written on connect (PRD 15 data model).
    let phoneNumber: string | null = null;
    let externalId: string | null = null;
    let wabaId: string | null = null;
    if (provider === "CLOUD_API") {
      const cfg = cloudApiConfigSchema.parse(parsed.data.config);
      // Verify against Meta BEFORE storing anything or checking duplicates:
      // a wrong ID/token must fail immediately with Meta's own error.
      try {
        const verified = await verifyPhoneNumberId(cfg.phoneNumberId, cfg.token);
        phoneNumber = verified.displayNumber || null;
        wabaId = verified.wabaId;
      } catch (err) {
        return respondError(
          res,
          "VALIDATION_ERROR",
          err instanceof Error ? err.message : "Verifikasi Meta gagal."
        );
      }
      externalId = cfg.phoneNumberId;
      // One phone number ID belongs to exactly one tenant (PRD 15 security).
      // Cross-tenant lookup: bypass context.
      const dupe = await withSystemContext(async () =>
        prisma.channel.findFirst({
          where: { provider: "CLOUD_API", externalId: cfg.phoneNumberId },
        })
      );
      if (dupe && dupe.id !== existing?.id) {
        return respondError(
          res,
          "VALIDATION_ERROR",
          "Nomor WhatsApp ini sudah terdaftar di workspace lain."
        );
      }
      // Keep the per-channel verifyToken when reconfiguring (it may hold the
      // legacy token Meta verified); it is app-level now but harmless.
      const parsedExisting = cloudApiConfigSchema.safeParse(existing?.config);
      const legacyToken =
        parsedExisting.success ? parsedExisting.data.verifyToken : undefined;
      config = {
        ...cfg,
        ...(legacyToken ? { verifyToken: legacyToken } : {}),
      };
      status = "CONNECTED";
    } else {
      const cfg = baileysConfigSchema.parse(parsed.data.config);
      if (!cfg.tosAcknowledged) {
        return respondError(
          res,
          "PERMISSION_DENIED",
          "Baileys berisiko banned. Owner harus menyetujui tosAcknowledged sebelum mengaktifkan."
        );
      }
      config = cfg;
      status = "DISCONNECTED"; // until the QR is scanned and the socket opens
    }

    // Create a new channel, or reconfigure the named one. Baileys: do NOT
    // write status here - socket events own it (open writes CONNECTED, a
    // fatal close writes DISCONNECTED).
    const channel = existing
      ? await prisma.channel.update({
          where: { id: existing.id },
          data: rePairOnly
            ? // KELOLA re-pair: pairing config only (audit run-4).
              { config }
            : {
                agentId: agentId ?? existing.agentId,
                label,
                ...(provider === "CLOUD_API"
                  ? { config, status, phoneNumber, externalId, wabaId }
                  : { config }),
              },
        })
      : await prisma.channel.create({
          data: {
            tenantId,
            agentId,
            type: "WHATSAPP",
            provider,
            label,
            config,
            status,
            ...(provider === "CLOUD_API"
              ? { phoneNumber, externalId, wabaId }
              : {}),
          },
        });

    let qr: string | null = null;
    let open = false;
    // Baileys reconfigure of an already-connected channel: a label/agent
    // edit must NOT re-pair (spawns a needless QR flow and can 440-fight
    // the live session). The QR command runs only for new channels or
    // disconnected ones - re-pairing is Tautkan Ulang's explicit job.
    const skipBaileysPair = provider === "BAILEYS" && existing?.status === "CONNECTED";
    if (provider === "BAILEYS" && !skipBaileysPair) {
      // Phase 6: the socket lives in the worker - pairing is a command the
      // worker executes (it applies stealLease on the owner's behalf).
      const cmdId = await createChannelCommand({
        tenantId,
        channelId: channel.id,
        kind: "CONNECT",
        requestedBy: session.user.id,
      });
      const result = await awaitChannelCommand(cmdId, 25_000);
      qr = result.qr;
      open = result.open;
      if (!qr && !open) {
        if (isFatalDisconnect(result.closeCode)) {
          return respondError(
            res,
            "VALIDATION_ERROR",
            "WhatsApp menolak koneksi (401). Di telepon: hapus perangkat lama CSQ dari WhatsApp > Setelan > Perangkat Tertaut, tunggu sekitar 1 jam tanpa mencoba lagi, lalu klik Tampilkan QR sekali lagi."
          );
        }
        if (!result.done && !result.failed) {
          return respondError(
            res,
            "INTERNAL_ERROR",
            "Worker tidak merespons - layanan pesan belum siap. Coba lagi sebentar."
          );
        }
        return respondError(
          res,
          "VALIDATION_ERROR",
          result.error ??
            "QR tidak berhasil dibuat. Tunggu sebentar, lalu klik Tampilkan QR lagi."
        );
      }
    }

    return res.status(200).json(
      apiOk({
        channelId: channel.id,
        provider: channel.provider,
        status: open ? "CONNECTED" : channel.status,
        qr,
      })
    );
  });
}
