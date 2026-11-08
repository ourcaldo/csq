// Sample data mirroring the existing CSQ admin. Replace with real API calls.
export const tenants = [
  { name: "Toko Kopi Nusantara", slug: "toko-kopi-nusantara", status: "active" as const, users: 1, channels: 2, conversations: 20, messages30d: 90, plan: null as string | null },
];

export const channels = [
  { tenant: "Toko Kopi Nusantara", slug: "toko-kopi-nusantara", provider: "BAILEYS", status: "disconnected" as const, lease: null as string | null },
  { tenant: "Toko Kopi Nusantara", slug: "toko-kopi-nusantara", provider: "CLOUD_API", status: "disconnected" as const, lease: null as string | null },
];

export const outbox = { queued: 0, sending: 0, sent: 0, failed: 0 };

// Messages per day, last 30 days (oldest → newest).
export const messages30 = [0,0,1,0,2,0,0,3,1,0,0,4,2,0,1,5,3,0,2,6,4,1,0,8,5,3,9,12,14,4];

export const audit = [
  { tenant: "Toko Kopi Nusantara", action: "user.api_token_issued", entity: "User", id: "ed7937f1", time: "2026-11-08 17:54:25" },
  { tenant: "Toko Kopi Nusantara", action: "user.api_token_issued", entity: "User", id: "ed7937f1", time: "2026-11-08 17:02:13" },
  { tenant: "Toko Kopi Nusantara", action: "user.api_token_issued", entity: "User", id: "ed7937f1", time: "2026-11-08 17:00:29" },
  { tenant: "Toko Kopi Nusantara", action: "user.api_token_issued", entity: "User", id: "ed7937f1", time: "2026-11-08 16:59:59" },
  { tenant: "Toko Kopi Nusantara", action: "campaign.fire", entity: "CampaignRun", id: "83a73b03", time: "2026-11-08 10:45:00" },
  { tenant: "Toko Kopi Nusantara", action: "campaign.activate", entity: "Campaign", id: "82df2aa5", time: "2026-11-08 10:43:25" },
  { tenant: "Toko Kopi Nusantara", action: "campaign.create", entity: "Campaign", id: "82df2aa5", time: "2026-11-08 10:43:23" },
  { tenant: "Toko Kopi Nusantara", action: "conversation.agent_error", entity: "Message", id: "0b7938fb", time: "2026-11-08 10:42:40" },
  { tenant: "Toko Kopi Nusantara", action: "conversation.human_reply", entity: "Message", id: "b3f8a0bf", time: "2026-11-08 10:42:29" },
  { tenant: "Toko Kopi Nusantara", action: "conversation.human_reply", entity: "Message", id: "4f45b2f0", time: "2026-11-08 02:32:51" },
  { tenant: "Toko Kopi Nusantara", action: "conversation.human_reply", entity: "Message", id: "23aa7a26", time: "2026-11-08 02:32:46" },
  { tenant: "Toko Kopi Nusantara", action: "conversation.human_reply", entity: "Message", id: "a54d9f75", time: "2026-11-08 02:31:42" },
];

export const usage = [{ tenant: "Toko Kopi Nusantara", plan: null as string | null, ai: 4, out: 14, in: 3, media: "383.8 KB" }];

export const admins = [{ name: "Platform Operator", email: "admin@csq.id", you: true, since: "2026-10-02" }];
