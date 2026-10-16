import { z } from "zod";
import { requireAdmin } from "@/lib/auth";
import { removeAssetFromStore, reviewAssetStoreSubmission } from "@/lib/asset-store";
import { ApiError, assertSameOrigin, errorResponse, readJson, requireUuid } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const decisionSchema = z.object({ decision: z.enum(["approve", "reject", "remove"]), note: z.string().trim().max(500).default("") });

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    assertSameOrigin(request);
    const actor = await requireAdmin();
    const { id } = await context.params;
    requireUuid(id, "asset id");
    const input = await readJson(request, decisionSchema);
    const note = input.note ?? "";
    if ((input.decision === "reject" || input.decision === "remove") && note.trim().length < 3) {
      throw new ApiError(400, "MODERATION_NOTE_REQUIRED", "A moderation note of at least 3 characters is required for rejection or removal.");
    }
    if (input.decision === "remove") {
      await removeAssetFromStore(id, actor.id, note, true);
      return Response.json({ ok: true, status: "removed" }, { headers: { "Cache-Control": "no-store" } });
    }
    const result = await reviewAssetStoreSubmission(id, actor.id, input.decision, note);
    return Response.json({ ok: true, ...result }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return errorResponse(error);
  }
}
