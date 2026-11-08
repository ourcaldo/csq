import { z } from "zod";

export const registerSchema = z.object({
  businessName: z.string().min(2, "Nama usaha minimal 2 karakter"),
  name: z.string().min(1, "Nama wajib diisi"),
  email: z.string().email("Email tidak valid"),
  password: z.string().min(8, "Password minimal 8 karakter"),
});

export type RegisterInput = z.infer<typeof registerSchema>;
