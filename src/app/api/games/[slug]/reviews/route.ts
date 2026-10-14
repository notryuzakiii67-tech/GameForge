import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { execute, query, newId, nowIso } from "@/lib/db";
import { ApiError, assertSameOrigin, enforceRateLimit, errorResponse, readJson, requireUuid } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const schema = z.object({ content: z.string().trim().min(5).max(1200) });

export async function GET(_request: Request, context: { params: Promise<{ slug: string }> }) {
  try {
    const { slug: gameId } = await context.params;
    requireUuid(gameId, "game id");
    const reviews = await query<{ id: string; content: string; created_at: string; display_name: string; username: string }>(
      `SELECT r.id, r.content, r.created_at, u.display_name, u.username
       FROM reviews r JOIN users u ON u.id = r.user_id
       WHERE r.game_id = ? AND r.status = 'visible'
       ORDER BY r.created_at DESC LIMIT 30`,
      [gameId],
    );
    return Response.json({ reviews: reviews.map((review) => ({ id: review.id, content: review.content, createdAt: review.created_at, displayName: review.display_name, username: review.username })) }, { headers: { "Cache-Control": "public, s-maxage=30, stale-while-revalidate=60" } });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request, context: { params: Promise<{ slug: string }> }) {
  try {
    assertSameOrigin(request);
    const user = await requireUser();
    await enforceRateLimit(request, `review:${user.id}`, 6, 60 * 60 * 1000);
    const { slug: gameId } = await context.params;
    requireUuid(gameId, "game id");
    const input = await readJson(request, schema);
    const games = await query<{ id: string }>(`SELECT id FROM games WHERE id = ? AND status = 'published' AND visibility = 'public'`, [gameId]);
    if (!games.length) throw new ApiError(404, "GAME_NOT_FOUND", "That game is not available.");
    const timestamp = nowIso();
    await execute(
      `INSERT INTO reviews(id, game_id, user_id, content, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'visible', ?, ?)
       ON CONFLICT(game_id, user_id) DO UPDATE SET content = excluded.content, status = 'visible', updated_at = excluded.updated_at`,
      [newId(), gameId, user.id, input.content, timestamp, timestamp],
    );
    return Response.json({ ok: true }, { status: 201, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return errorResponse(error);
  }
}
