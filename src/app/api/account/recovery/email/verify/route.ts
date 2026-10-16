import { z, ZodError } from "zod";
import { requireUser } from "@/lib/auth";
import { verifyEmailChallenge } from "@/lib/recovery";
import { isUniqueConstraintError } from "@/lib/auth-validation";
import { ApiError, assertSameOrigin, enforceRateLimit, errorResponse, readJson } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const schema = z.object({ requestId: z.string().uuid(), code: z.string().regex(/^\d{6}$/) });

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const user = await requireUser();
    await enforceRateLimit(request, "email-verification-code", 10, 60 * 60 * 1000);
    const input = await readJson(request, schema);
    const result = await verifyEmailChallenge(user.id, input.requestId, input.code);
    return Response.json({ ...result, verified: true }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof ZodError) return errorResponse(new ApiError(400, "INVALID_INPUT", "Enter the six-digit verification code."));
    if (isUniqueConstraintError(error)) return errorResponse(new ApiError(409, "EMAIL_UNAVAILABLE", "That email address cannot be linked to this account."));
    return errorResponse(error);
  }
}
