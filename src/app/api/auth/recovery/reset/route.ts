import { z, ZodError } from "zod";
import { strongPasswordSchema } from "@/lib/auth-validation";
import { completePasswordRecovery } from "@/lib/recovery";
import { ApiError, assertSameOrigin, enforceRateLimit, errorResponse, readJson } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const schema = z.object({
  resetToken: z.string().min(40).max(128),
  password: strongPasswordSchema,
  confirmPassword: strongPasswordSchema,
}).refine((input) => input.password === input.confirmPassword, {
  path: ["confirmPassword"],
  message: "Passwords do not match.",
});

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    await enforceRateLimit(request, "password-recovery-reset", 5, 60 * 60 * 1000);
    const input = await readJson(request, schema);
    await completePasswordRecovery(input.resetToken, input.password);
    return Response.json({ ok: true, message: "Password reset. Sign in with your username and new password." }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof ZodError) return errorResponse(new ApiError(400, "INVALID_INPUT", "Use a password of at least 12 characters, confirm it exactly, and submit a valid reset token."));
    return errorResponse(error);
  }
}
