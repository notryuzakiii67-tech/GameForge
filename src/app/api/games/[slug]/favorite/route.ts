import { requireUser } from "@/lib/auth";
import { execute, query, nowIso } from "@/lib/db";
import { ApiError, assertSameOrigin, errorResponse, requireUuid } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function gameExists(id: string): Promise<boolean> {
  return (await query<{ id: string }>(`SELECT id FROM games WHERE id = ? AND status = 'published' AND visibility = 'public' LIMIT 1`, [id])).length > 0;
}

export async function GET(_request: Request, context: { params: Promise<{ slug: string }> }) {
  try {
    const user = await requireUser();
    const { slug } = await context.params;
    requireUuid(slug, "game id");
    const rows = await query<{ game_id: string }>(`SELECT game_id FROM favorites WHERE user_id = ? AND game_id = ?`, [user.id, slug]);
    return Response.json({ favorited: rows.length > 0 }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request, context: { params: Promise<{ slug: string }> }) {
  try {
    assertSameOrigin(request);
    const user = await requireUser();
    const { slug } = await context.params;
    requireUuid(slug, "game id");
    if (!(await gameExists(slug))) throw new ApiError(404, "GAME_NOT_FOUND", "That game is not available.");
    await execute(`INSERT INTO favorites(user_id, game_id, created_at) VALUES (?, ?, ?) ON CONFLICT(user_id, game_id) DO NOTHING`, [user.id, slug, nowIso()]);
    return Response.json({ favorited: true }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function DELETE(request: Request, context: { params: Promise<{ slug: string }> }) {
  try {
    assertSameOrigin(request);
    const user = await requireUser();
    const { slug } = await context.params;
    requireUuid(slug, "game id");
    await execute(`DELETE FROM favorites WHERE user_id = ? AND game_id = ?`, [user.id, slug]);
    return Response.json({ favorited: false }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return errorResponse(error);
  }
}
