// Client-side inbox entity types (serialized shapes from the inbox API routes).
// Prisma serializes DateTime → ISO string and enums → their string values.

export type ConversationStatus = "OPEN" | "PENDING" | "RESOLVED";
export type MessageDirection = "INBOUND" | "OUTBOUND";
export type MessageSenderType = "CUSTOMER" | "AGENT" | "HUMAN";

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
  notes: string | null;
};

export type ConversationTag = { tag: Tag };

export type ConversationListItem = {
  id: string;
  tenantId: string;
  channelId: string;
  customerPhone: string; // full JID (e.g. <lid>@lid) — used for sending
  customerPhoneDisplay: string; // real phone number for display (LID resolved)
  contactId: string | null;
  assignedAgentId: string | null;
  assigneeUserId: string | null;
  status: ConversationStatus;
  lastMessageAt: string | null;
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
  isInternal: boolean;
  createdAt: string;
};
