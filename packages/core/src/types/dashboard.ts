// Client-side entity types for the dashboard UI.
//
// The dashboard API routes return Prisma models via `res.json()`. Prisma
// serializes `Decimal` as a string (Decimal.toJSON) and `DateTime` as an ISO
// string, and enums as their string values. Importing the Prisma-generated
// types directly would type these fields as `Decimal` / `Date` / enum classes,
// which does not match the JSON the browser receives - and reconciling that
// without `as` is impossible. So we declare the exact serialized shapes here
// and use them on the client. The API layer remains the source of truth; these
// mirror its output for type-safe rendering.

export type ListResult<T> = {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
};

export type Product = {
  id: string;
  tenantId: string;
  name: string;
  description: string | null;
  sku: string | null;
  price: string;
  // FEA-7 (PRD 16): present on list responses (one-to-one Inventory include);
  // create/update responses return the bare Product, so it stays optional.
  inventory?: { quantity: number } | null;
  createdAt: string;
  updatedAt: string;
};

export type InventorySource = "MANUAL" | "EXCEL" | "GOOGLE_SHEETS";

export type InventoryWithProduct = {
  id: string;
  tenantId: string;
  productId: string;
  quantity: number;
  source: InventorySource;
  sourceRef: string | null;
  createdAt: string;
  updatedAt: string;
  product: Product;
};

// FEA-8 (PRD 16): per-source stock snapshot row as serialized by the
// inventory detail API (confidence is 0-1, 1 = fully trusted observation).
export type InventorySnapshotRow = {
  id: string;
  tenantId: string;
  productId: string;
  source: InventorySource;
  quantity: number;
  sourceRef: string | null;
  confidence: number;
  syncedAt: string;
  createdAt: string;
  updatedAt: string;
};

export type OrderStatus = "PENDING" | "CONFIRMED" | "CANCELLED";

export type OrderItem = {
  id: string;
  orderId: string;
  productId: string;
  quantity: number;
  unitPrice: string;
  subtotal: string;
};

export type Order = {
  id: string;
  tenantId: string;
  customerName: string | null;
  customerPhone: string | null;
  status: OrderStatus;
  totalAmount: string;
  createdByAgentId: string | null;
  createdAt: string;
  updatedAt: string;
  items: OrderItem[];
  refunds?: Refund[];
};

// FEA-2 (PRD 16): serialized Refund rows included with an order.
export type RefundStatus = "PENDING" | "APPROVED" | "REJECTED";

export type Refund = {
  id: string;
  orderId: string;
  amount: string;
  reason: string | null;
  status: RefundStatus;
  createdAt: string;
};

// FEA-3 (PRD 16): serialized SupportTicket rows for the tickets page.
export type SupportTicketStatus = "OPEN" | "RESOLVED";

export type SupportTicket = {
  id: string;
  tenantId: string;
  conversationId: string | null;
  contactPhone: string | null;
  subject: string;
  body: string;
  status: SupportTicketStatus;
  createdByAgentId: string | null;
  resolvedById: string | null;
  resolvedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type KnowledgeType = "FAQ" | "POLICY" | "BUSINESS_INFO";

export type Knowledge = {
  id: string;
  tenantId: string;
  type: KnowledgeType;
  title: string;
  content: string;
  // FEA-1 (PRD 16): provenance for uploaded documents; null for manual entries.
  sourceName: string | null;
  mimeType: string | null;
  createdAt: string;
  updatedAt: string;
};

// Serialized joined classification rows - the shape the API returns for a
// contact's categories/tags (the join rows carry the resolved taxonomy row).
export type ContactCategoryRef = {
  id: string;
  categoryId: string;
  category: Category;
};

export type ContactTagRef = {
  id: string;
  tagId: string;
  tag: Tag;
};

export type Contact = {
  id: string;
  tenantId: string;
  phone: string;
  phoneDisplay?: string;
  name: string | null;
  email: string | null;
  notes: string | null;
  categories?: ContactCategoryRef[];
  tags?: ContactTagRef[];
  createdAt: string;
  updatedAt: string;
};

export type Category = {
  id: string;
  tenantId: string;
  name: string;
  color: string | null;
  createdAt: string;
  updatedAt: string;
};

export type Tag = {
  id: string;
  tenantId: string;
  name: string;
  color: string | null;
  createdAt: string;
};

export type MemorySource = "CONVERSATION" | "MANUAL";
export type MemoryImportance = "LOW" | "MEDIUM" | "HIGH";

export type Memory = {
  id: string;
  tenantId: string;
  agentId: string;
  // The customer this memory belongs to (scoping owner decision 2026-11-11);
  // stamped server-side from the conversation, never model-supplied.
  customerPhone: string | null;
  key: string;
  value: string;
  source: MemorySource;
  importance: MemoryImportance;
  createdAt: string;
};

export type DataSourceType = "MANUAL" | "EXCEL" | "GOOGLE_SHEETS";
export type DataSourceStatus = "ACTIVE" | "INACTIVE" | "ERROR";

export type DataSource = {
  id: string;
  tenantId: string;
  type: DataSourceType;
  name: string;
  dataType: string;
  config: unknown;
  status: DataSourceStatus;
  lastSyncAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type DataSourceStatusResult = {
  id: string;
  status: string;
  lastSyncAt: string | null;
};
