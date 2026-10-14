import { requireUser } from "@/lib/auth";
import { query } from "@/lib/db";
import { errorResponse } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function parseTags(value: string): string[] {
  try { const parsed = JSON.parse(value); return Array.isArray(parsed) ? parsed.filter((tag): tag is string => typeof tag === "string") : []; } catch { return []; }
}

export async function GET() {
  try {
    const user = await requireUser();
    const games = await query<{
      id: string; title: string; slug: string; description: string; genre: string; tags_json: string; status: string;
      controls: string; instructions: string; remix_enabled: number; license: string; entry_point: string;
      updated_at: string; published_at: string | null; version: string; has_build: number;
    }>(
      `SELECT g.id, g.title, g.slug, g.description, g.genre, g.tags_json, g.status, g.controls, g.instructions, g.remix_enabled, g.license, g.entry_point, g.updated_at, g.published_at, g.version,
              CASE WHEN EXISTS (SELECT 1 FROM game_versions v WHERE v.game_id = g.id AND v.validation_status = 'validated') THEN 1 ELSE 0 END AS has_build
       FROM games g WHERE g.developer_id = ? ORDER BY g.updated_at DESC LIMIT 100`,
      [user.id],
    );
    return Response.json({ games: games.map((game) => ({
      id: game.id, title: game.title, slug: game.slug, description: game.description, genre: game.genre, tags: parseTags(game.tags_json),
      status: game.status, controls: game.controls, instructions: game.instructions, remixEnabled: game.remix_enabled === 1,
      license: game.license, entryPoint: game.entry_point, updatedAt: game.updated_at, publishedAt: game.published_at,
      version: game.version, hasBuild: game.has_build === 1,
    })) }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return errorResponse(error);
  }
}
