// Client-side inbox entity types (serialized shapes from the inbox API routes).
// Prisma serializes DateTime → ISO string and enums → their string values.

export type ConversationStatus = "OPEN" | "PENDING" | "RESOLVED";
export type MessageDirection = "INBOUND" | "OUTBOUND";
export type MessageSenderType = "CUSTOMER" | "AGENT" | "HUMAN" | "SCENARIO" | "CAMPAIGN";

export type Tag = {
  id: string;
  name: string;
  color: string | null;
};

export type Agent = {
  id: string;
  name: string;
  status: "DRAFT" | "ACTIVE" | "PAUSED";
};

export type User = {
  id: string;
  name: string | null;
  email: string;
  role: "OWNER" | "STAFF";
};

export type Contact = {
  id: string;
  phone: string;
  name: string | null;
  email: string | null;
  notes: string | null;
  // Contact classification (feature plan 2026-11-01) - present on the shapes
  // returned by the conversations API, which includes the join rows.
  categories?: { categoryId: string; category: { id: string; name: string; color: string | null } }[];
  tags?: { tagId: string; tag: Tag }[];
};

export type ConversationTag = { tag: Tag };

export type StageKind = "OPENING" | "WON" | "LOST" | "NORMAL";

export type Stage = {
  id: string;
  name: string;
  order: number;
  winProbability: number | null;
  expectedDays: number | null;
  kind: StageKind;
};

export type ConversationListItem = {
  id: string;
  tenantId: string;
  channelId: string;
  // FEA-6 (PRD 16): channel provider for the Resmi/Pribadi badge in the list.
  channel: { provider: "CLOUD_API" | "BAILEYS" };
  customerPhone: string; // full JID (e.g. <lid>@lid) - used for sending
  customerPhoneDisplay: string; // real phone number for display (LID resolved)
  contactId: string | null;
  assignedAgentId: string | null;
  assigneeUserId: string | null;
  status: ConversationStatus;
  stage: Stage | null; // current pipeline stage (from Conversation.deal.stage)
  lastMessageAt: string | null;
  lastMessage: { body: string; senderType: string; kind: "TEXT" | "MEDIA" | "OTHER" } | null;
  // INBOUND messages after this user's last-read watermark (WhatsApp-style
  // unread badge); 0 when caught up.
  unreadCount: number;
  createdAt: string;
  updatedAt: string;
  contact: Contact | null;
  assignedAgent: Agent | null;
  assignee: User | null;
  tags: ConversationTag[];
};

export type Message = {
  id: string;
  conversationId: string;
  direction: MessageDirection;
  senderType: MessageSenderType;
  senderAgentId: string | null;
  senderUserId: string | null;
  body: string;
  waMessageId: string | null;
  // How the inbound content arrived (D6). Non-text rows are stored for the
  // inbox but never trigger an agent turn; the body is a display placeholder
  // like "[image]".
  kind: "TEXT" | "MEDIA" | "OTHER";
  // Outbound media reference (campaign image sends). When present the chat
  // renders the actual image from the api service's /api/media/[id].
  mediaId: string | null;
  isInternal: boolean;
  createdAt: string;
};
