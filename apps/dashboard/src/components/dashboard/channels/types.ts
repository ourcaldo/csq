export type Provider = "CLOUD_API" | "BAILEYS";

export type ChannelView = {
  id: string;
  provider: Provider;
  type: "WHATSAPP";
  status: string;
  label: string;
  agentId: string | null;
  phoneNumber: string | null;
  externalId: string | null;
  wabaId: string | null;
  archivedAt: string | null;
  phoneNumberId?: string;
  tosAcknowledged?: boolean;
  createdAt: string;
  updatedAt: string;
};

export type AgentItem = { id: string; name: string; status: string };

export type CloudForm = {
  label: string;
  phoneNumberId: string;
  token: string;
  appSecret: string;
  businessAccountId: string;
};

export const EMPTY_CLOUD: CloudForm = {
  label: "",
  phoneNumberId: "",
  token: "",
  appSecret: "",
  businessAccountId: "",
};

export type ToastState = { msg: string; tone: "success" | "error" };

export type ConnectResult = {
  channelId: string;
  provider: string;
  status: string;
  qr: string | null;
};
