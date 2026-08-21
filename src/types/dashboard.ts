// Client-side entity types for the dashboard UI.
//
// The dashboard API routes return Prisma models via `res.json()`. Prisma
// serializes `Decimal` as a string (Decimal.toJSON) and `DateTime` as an ISO
// string, and enums as their string values. Importing the Prisma-generated
// types directly would type these fields as `Decimal` / `Date` / enum classes,
// which does not match the JSON the browser receives — and reconciling that
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
};

export type KnowledgeType = "FAQ" | "POLICY" | "BUSINESS_INFO";

export type Knowledge = {
  id: string;
  tenantId: string;
  type: KnowledgeType;
  title: string;
  content: string;
  createdAt: string;
  updatedAt: string;
};

export type Contact = {
  id: string;
  tenantId: string;
  phone: string;
  phoneDisplay?: string;
  name: string | null;
  email: string | null;
  notes: string | null;
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
