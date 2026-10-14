import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { execute, query, nowIso } from "@/lib/db";
import { getGameBySlug } from "@/lib/games";
import { ApiError, assertSameOrigin, errorResponse, readJson } from "@/lib/http";
import { genres } from "@/lib/demo-games";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const updateSchema = z.object({
  title: z.string().trim().min(2).max(80),
  description: z.string().trim().max(5000),
  genre: z.string().trim().max(64),
  tags: z.array(z.string().trim().min(1).max(24)).max(12),
  controls: z.string().trim().max(1000),
  instructions: z.string().trim().max(2000),
  remixEnabled: z.boolean(),
  license: z.enum(["all-rights-reserved", "cc-by-4.0", "cc-by-sa-4.0", "cc0-1.0"]),
});

export async function GET(_request: Request, context: { params: Promise<{ slug: string }> }) {
  try {
    const { slug } = await context.params;
    const game = await getGameBySlug(slug);
    if (!game) throw new ApiError(404, "GAME_NOT_FOUND", "That game is not available.");
    const { storageKey: _privateStorageKey, ...publicGame } = game;
    return Response.json({ game: publicGame }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function PATCH(request: Request, context: { params: Promise<{ slug: string }> }) {
  try {
    assertSameOrigin(request);
    const user = await requireUser();
    const { slug: gameId } = await context.params;
    const input = await readJson(request, updateSchema);
    const existing = await query<{ id: string; status: string }>(`SELECT id, status FROM games WHERE id = ? AND developer_id = ? LIMIT 1`, [gameId, user.id]);
    if (!existing[0]) throw new ApiError(404, "GAME_NOT_FOUND", "That game does not exist in your library.");
    if (existing[0].status === "removed") throw new ApiError(409, "CONTENT_REMOVED", "This game was removed by moderation and cannot be edited or resubmitted.");
    if (existing[0].status === "published" || existing[0].status === "pending") {
      throw new ApiError(409, "GAME_NOT_EDITABLE", "Unpublish or wait for moderation before editing this build.");
    }
    const genre = genres.find((item) => item.toLowerCase() === input.genre.toLowerCase()) ?? "Experimental";
    const tags = [...new Set(input.tags.map((tag) => tag.toLowerCase()))].slice(0, 12);
    await execute(
      `UPDATE games SET title = ?, description = ?, genre = ?, tags_json = ?, controls = ?, instructions = ?,
                       remix_enabled = ?, license = ?, updated_at = ? WHERE id = ? AND developer_id = ?`,
      [input.title, input.description, genre, JSON.stringify(tags), input.controls, input.instructions, input.remixEnabled ? 1 : 0, input.license, nowIso(), gameId, user.id],
    );
    return Response.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return errorResponse(error);
  }
}
