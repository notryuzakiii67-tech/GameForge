import { z, ZodError } from "zod";
import { startPasswordRecovery } from "@/lib/recovery";
import { ApiError, assertSameOrigin, enforceRateLimit, errorResponse, readJson } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const schema = z.object({ identifier: z.string().trim().min(3).max(254) });

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    await enforceRateLimit(request, "password-recovery-start", 5, 60 * 60 * 1000);
    const input = await readJson(request, schema);
    const { requestId } = await startPasswordRecovery(input.identifier);
    return Response.json({
      requestId,
      message: "If an account with a verified recovery email exists and delivery succeeds, it will receive a one-time code. This response is the same for every request.",
    }, { status: 202, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof ZodError) return errorResponse(new ApiError(400, "INVALID_INPUT", "Enter a username or email address."));
    return errorResponse(error);
  }
}
