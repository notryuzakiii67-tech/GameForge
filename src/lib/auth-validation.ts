import { z } from "zod";

export const usernameSchema = z.string().trim().min(3).max(24).regex(/^[a-zA-Z0-9_]+$/, "Use letters, numbers, and underscores only.");

export const strongPasswordSchema = z.string().min(12).max(72).refine((value) => Buffer.byteLength(value, "utf8") <= 72, "Password must be 72 bytes or fewer with bcrypt.");

export const registrationSchema = z.object({
  username: usernameSchema,
  displayName: z.string().trim().min(1).max(48),
  email: z.union([z.string().trim().email().max(254), z.literal("")]).optional(),
  password: strongPasswordSchema,
  confirmPassword: strongPasswordSchema,
}).refine((input) => input.password === input.confirmPassword, {
  path: ["confirmPassword"],
  message: "Passwords do not match.",
});

export const loginSchema = z.object({ username: usernameSchema, password: z.string().min(1).max(128) });

export function normalizeUsername(username: string): string {
  return username.trim().toLowerCase();
}

/** Reserved, non-deliverable address used only to satisfy legacy NOT NULL schemas for username-only accounts. */
export function noContactEmail(userId: string): string {
  return `no-contact+${userId}@users.gameforge.invalid`;
}

export function isNoContactEmail(email: string): boolean {
  return email.toLowerCase().endsWith("@users.gameforge.invalid");
}

export function isUniqueConstraintError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const value = error as { code?: unknown; message?: unknown };
  return value.code === "23505" || (typeof value.message === "string" && /unique constraint|duplicate key/i.test(value.message));
}
