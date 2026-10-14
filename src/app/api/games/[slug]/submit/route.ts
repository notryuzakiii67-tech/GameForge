import { requireUser } from "@/lib/auth";
import { execute, query, nowIso } from "@/lib/db";
import { ApiError, assertSameOrigin, errorResponse, requireUuid } from "@/lib/http";
import { assertStorageReadyForPublishing } from "@/lib/storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request, context: { params: Promise<{ slug: string }> }) {
  try {
    assertSameOrigin(request);
    const user = await requireUser();
    const { slug: gameId } = await context.params;
    requireUuid(gameId, "game id");
    assertStorageReadyForPublishing();
    const rows = await query<{ status: string; has_build: number }>(
      `SELECT g.status, CASE WHEN EXISTS (
         SELECT 1 FROM game_versions v WHERE v.game_id = g.id AND v.validation_status = 'validated'
       ) THEN 1 ELSE 0 END AS has_build
       FROM games g WHERE g.id = ? AND g.developer_id = ? LIMIT 1`,
      [gameId, user.id],
    );
    if (!rows[0]) throw new ApiError(404, "GAME_NOT_FOUND", "That project is not in your account.");
    if (rows[0].status === "removed") throw new ApiError(409, "CONTENT_REMOVED", "This project was removed by moderation and cannot be resubmitted.");
    if (rows[0].status !== "draft" && rows[0].status !== "rejected") throw new ApiError(409, "INVALID_GAME_STATE", "Only a draft can be submitted for review.");
    if (rows[0].has_build !== 1) throw new ApiError(400, "BUILD_REQUIRED", "Upload and validate a game build before submitting it for review.");
    await execute(`UPDATE games SET status = 'pending', visibility = 'private', updated_at = ? WHERE id = ? AND developer_id = ?`, [nowIso(), gameId, user.id]);
    return Response.json({ ok: true, status: "pending", message: "Your build is in the moderation queue. It is not public yet." }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return errorResponse(error);
  }
}
