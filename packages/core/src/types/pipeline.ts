// Client-side pipeline board types (serialized shapes from the deals API).
// Prisma serializes DateTime -> ISO string and enums -> their string values.
import type { Stage, Tag } from "@csq/core/types/inbox";

export type PipelineDeal = {
  id: string;
  conversationId: string;
  // Estimated deal value in whole rupiah (pipeline revamp 2026-11-16).
  value: number;
  stage: Stage;
  // INBOUND messages after the viewer's last-read watermark.
  unreadCount: number;
  conversation: {
    id: string;
    customerPhone: string;
    customerPhoneDisplay: string;
    lastMessageAt: string | null;
    contact: {
      id: string;
      name: string | null;
      phone: string;
      email: string | null;
      notes: string | null;
      // Lead source: "Placement Test", an API key name, "Input Manual"...
      source: string | null;
    } | null;
    assignee: { id: string; name: string | null; email: string } | null;
    channel: { provider: "CLOUD_API" | "BAILEYS" };
    tags: { tag: Tag }[];
    lastMessage: {
      body: string;
      senderType: string;
      kind: "TEXT" | "MEDIA" | "OTHER";
    } | null;
  };
};

export type PipelineBoardResult = {
  items: PipelineDeal[];
  total: number;
  page: number;
  pageSize: number;
};
