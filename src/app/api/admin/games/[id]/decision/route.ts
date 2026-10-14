import { z } from "zod";
import { requireAdmin } from "@/lib/auth";
import { execute, query, nowIso } from "@/lib/db";
import { ApiError, assertSameOrigin, errorResponse, logAudit, readJson, requireUuid } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const schema = z.object({ decision: z.enum(["approve", "reject"]), reason: z.string().trim().max(500).default("") });

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    assertSameOrigin(request);
    const actor = await requireAdmin();
    const { id } = await context.params;
    requireUuid(id, "game id");
    const input = await readJson(request, schema);
    const games = await query<{ id: string; source_project_id: string | null }>(`SELECT id, source_project_id FROM games WHERE id = ? AND status = 'pending' LIMIT 1`, [id]);
    if (!games[0]) throw new ApiError(404, "SUBMISSION_NOT_FOUND", "This submission is no longer awaiting review.");
    if (input.decision === "approve") {
      const builds = await query<{ id: string }>(`SELECT id FROM game_versions WHERE game_id = ? AND validation_status = 'validated' ORDER BY version_number DESC LIMIT 1`, [id]);
      if (!builds[0]) throw new ApiError(409, "BUILD_NOT_VALIDATED", "The submission has no validated game build.");
      await execute(`UPDATE games SET status = 'published', visibility = 'public', published_at = ?, updated_at = ? WHERE id = ? AND status = 'pending'`, [nowIso(), nowIso(), id]);
    } else {
      await execute(`UPDATE games SET status = 'rejected', visibility = 'private', updated_at = ? WHERE id = ? AND status = 'pending'`, [nowIso(), id]);
    }
    if (games[0].source_project_id) await execute(`UPDATE ai_projects SET status = 'draft', updated_at = ? WHERE id = ? AND status = 'submitted'`, [nowIso(), games[0].source_project_id]);
    await logAudit(actor.id, `game.${input.decision}`, "game", id, { reason: (input.reason ?? "").slice(0, 300) });
    return Response.json({ ok: true, status: input.decision === "approve" ? "published" : "rejected" }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return errorResponse(error);
  }
}
