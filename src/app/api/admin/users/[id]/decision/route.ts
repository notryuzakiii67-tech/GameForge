import { z } from "zod";
import { requireSiteAdmin } from "@/lib/auth";
import { nowIso } from "@/lib/db";
import { ApiError, assertSameOrigin, errorResponse, readJson, requireUuid } from "@/lib/http";
import { setAccountStatus } from "@/lib/moderation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const schema = z.object({ decision: z.enum(["suspend", "restore"]), note: z.string().trim().min(3).max(500) });

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    assertSameOrigin(request);
    const actor = await requireSiteAdmin();
    const { id } = await context.params;
    requireUuid(id, "user id");
    const input = await readJson(request, schema);
    const status = input.decision === "suspend" ? "suspended" : "active";
    const timestamp = nowIso();
    await setAccountStatus(actor.id, id, status, timestamp, input.note);
    return Response.json({ ok: true, status }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof z.ZodError) return errorResponse(new ApiError(400, "INVALID_INPUT", "Provide a moderation note and valid account decision."));
    return errorResponse(error);
  }
}
