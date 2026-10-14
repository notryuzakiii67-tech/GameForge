import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { execute, query, newId, nowIso } from "@/lib/db";
import { ApiError, assertSameOrigin, errorResponse, readJson, requireUuid } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const schema = z.object({ rating: z.number().int().min(1).max(5) });

export async function POST(request: Request, context: { params: Promise<{ slug: string }> }) {
  try {
    assertSameOrigin(request);
    const user = await requireUser();
    const { slug: gameId } = await context.params;
    requireUuid(gameId, "game id");
    const input = await readJson(request, schema);
    const games = await query<{ id: string }>(`SELECT id FROM games WHERE id = ? AND status = 'published' AND visibility = 'public'`, [gameId]);
    if (!games.length) throw new ApiError(404, "GAME_NOT_FOUND", "That game is not available.");
    const timestamp = nowIso();
    await execute(
      `INSERT INTO ratings(id, game_id, user_id, rating, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(game_id, user_id) DO UPDATE SET rating = excluded.rating, updated_at = excluded.updated_at`,
      [newId(), gameId, user.id, input.rating, timestamp, timestamp],
    );
    return Response.json({ ok: true, rating: input.rating }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return errorResponse(error);
  }
}
