export type Provider = "CLOUD_API" | "BAILEYS";

export type ChannelView = {
  id: string;
  provider: Provider;
  type: "WHATSAPP";
  status: string;
  agentId: string | null;
  phoneNumberId?: string;
  tosAcknowledged?: boolean;
  createdAt: string;
  updatedAt: string;
};

export type AgentItem = { id: string; name: string; status: string };

export type CloudForm = {
  phoneNumberId: string;
  token: string;
  appSecret: string;
  businessAccountId: string;
};

export const EMPTY_CLOUD: CloudForm = {
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
