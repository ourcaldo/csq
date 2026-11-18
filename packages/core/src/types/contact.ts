import { z } from "zod";

// Contact update input (dashboard PUT). categoryIds/tagIds use replace-set
// semantics: the arrays become the new full set; unknown ids are rejected
// (feature plan 2026-11-01, section 2.4).
export const contactUpdateSchema = z.object({
  name: z.string().max(200).nullable().optional(),
  email: z.string().email().max(200).nullable().optional(),
  notes: z.string().max(2000).nullable().optional(),
  categoryIds: z.array(z.string().uuid()).max(50).optional(),
  tagIds: z.array(z.string().uuid()).max(50).optional(),
});
export type ContactUpdateInput = z.infer<typeof contactUpdateSchema>;

// Contact create (dashboard POST, single add). Phone is normalized server-side
// (08xx -> 628xx, same rule as createLead) so both entry forms agree.
export const contactCreateSchema = z.object({
  phone: z.string().min(8).max(25),
  name: z.string().max(200).optional(),
  email: z.string().email().max(200).optional(),
  notes: z.string().max(2000).optional(),
  categoryIds: z.array(z.string().uuid()).max(50).optional(),
  tagIds: z.array(z.string().uuid()).max(50).optional(),
});
export type ContactCreateInput = z.infer<typeof contactCreateSchema>;

// Bulk import (owner request 2026-11-18): file arrives as base64 JSON (same
// transport as the product Excel import), columns matched by header name.
export const contactImportSchema = z.object({
  filename: z.string().min(1),
  base64: z.string().min(1),
});
export type ContactImport = z.infer<typeof contactImportSchema>;

export const categoryCreateSchema = z.object({
  name: z.string().min(1).max(80),
  color: z.string().max(20).optional(),
});
export type CategoryCreateInput = z.infer<typeof categoryCreateSchema>;

export const categoryUpdateSchema = z.object({
  name: z.string().min(1).max(80).optional(),
  color: z.string().max(20).nullable().optional(),
});
export type CategoryUpdateInput = z.infer<typeof categoryUpdateSchema>;
