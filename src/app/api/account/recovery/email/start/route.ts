import bcrypt from "bcryptjs";
import { z, ZodError } from "zod";
import { requireUser } from "@/lib/auth";
import { query } from "@/lib/db";
import { isNoContactEmail } from "@/lib/auth-validation";
import { startEmailVerification } from "@/lib/recovery";
import { ApiError, assertSameOrigin, enforceRateLimit, errorResponse, readJson } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const schema = z.object({
  email: z.string().trim().email().max(254).refine((email) => !isNoContactEmail(email), "Use a real email address."),
  currentPassword: z.string().min(1).max(128),
});

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const user = await requireUser();
    await enforceRateLimit(request, "email-verification-start", 3, 60 * 60 * 1000);
    const input = await readJson(request, schema);
    const rows = await query<{ password_hash: string }>(`SELECT password_hash FROM users WHERE id = ? LIMIT 1`, [user.id]);
    if (!rows[0] || !(await bcrypt.compare(input.currentPassword, rows[0].password_hash))) {
      throw new ApiError(401, "REAUTHENTICATION_REQUIRED", "Enter your current password to change recovery contacts.");
    }
    const result = await startEmailVerification(user.id, input.email);
    return Response.json({ ...result, expiresInSeconds: 600 }, { status: 201, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof ZodError) return errorResponse(new ApiError(400, "INVALID_INPUT", "Enter a valid email address and your current password."));
    return errorResponse(error);
  }
}
