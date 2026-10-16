import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { submitAssetStoreAppeal } from "@/lib/asset-store";
import { ApiError, assertSameOrigin, enforceRateLimit, errorResponse, readJson, requireUuid } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const appealSchema = z.object({ explanation: z.string().trim().min(20).max(2_000) });

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    assertSameOrigin(request);
    const user = await requireUser();
    await enforceRateLimit(request, `asset-store-appeal:${user.id}`, 5, 24 * 60 * 60 * 1000);
    const { id } = await context.params;
    requireUuid(id, "asset id");
    const input = await readJson(request, appealSchema, 4_000);
    const result = await submitAssetStoreAppeal(user.id, id, input.explanation);
    return Response.json({ ok: true, ...result, message: "Your appeal is in the moderation queue. The asset remains private while it is reviewed." }, { status: 201, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof ApiError && error.code === "INVALID_INPUT") {
      return errorResponse(new ApiError(400, "INVALID_APPEAL", "Provide an appeal explanation between 20 and 2,000 characters."));
    }
    return errorResponse(error);
  }
}
