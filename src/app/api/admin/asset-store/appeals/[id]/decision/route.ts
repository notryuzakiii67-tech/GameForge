import { z } from "zod";
import { requireAdmin } from "@/lib/auth";
import { reviewAssetStoreAppeal } from "@/lib/asset-store";
import { ApiError, assertSameOrigin, errorResponse, readJson, requireUuid } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const decisionSchema = z.object({ decision: z.enum(["reopen", "uphold"]), note: z.string().trim().min(3).max(500) });

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    assertSameOrigin(request);
    const actor = await requireAdmin();
    const { id } = await context.params;
    requireUuid(id, "appeal id");
    const input = await readJson(request, decisionSchema, 4_000);
    if (input.note.trim().length < 3) throw new ApiError(400, "MODERATION_NOTE_REQUIRED", "Provide a moderation note between 3 and 500 characters.");
    const result = await reviewAssetStoreAppeal(id, actor.id, input.decision, input.note);
    return Response.json({ ok: true, ...result }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return errorResponse(error);
  }
}
