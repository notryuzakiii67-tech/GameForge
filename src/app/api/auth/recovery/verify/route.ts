import { z, ZodError } from "zod";
import { verifyPasswordRecoveryCode } from "@/lib/recovery";
import { ApiError, assertSameOrigin, enforceRateLimit, errorResponse, readJson } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const schema = z.object({ requestId: z.string().uuid(), code: z.string().regex(/^\d{6}$/) });

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    await enforceRateLimit(request, "password-recovery-verify", 10, 60 * 60 * 1000);
    const input = await readJson(request, schema);
    const result = await verifyPasswordRecoveryCode(input.requestId, input.code);
    return Response.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof ZodError) return errorResponse(new ApiError(400, "INVALID_INPUT", "Enter the recovery request and six-digit code."));
    return errorResponse(error);
  }
}
