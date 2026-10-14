import { requireUser } from "@/lib/auth";
import { query } from "@/lib/db";
import { errorResponse } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const user = await requireUser();
    const favorites = await query<{ id: string; slug: string; title: string; genre: string; description: string; cover_image: string | null; developer_name: string; developer_username: string; is_demo: number; average_rating: number | null; rating_count: number; created_at: string }>(
      `SELECT g.id, g.slug, g.title, g.genre, g.description, g.cover_image, g.is_demo,
              u.display_name AS developer_name, u.username AS developer_username, f.created_at,
              (SELECT AVG(r.rating) FROM ratings r WHERE r.game_id = g.id) AS average_rating,
              (SELECT COUNT(*) FROM ratings r WHERE r.game_id = g.id) AS rating_count
       FROM favorites f JOIN games g ON g.id = f.game_id JOIN users u ON u.id = g.developer_id
       WHERE f.user_id = ? AND g.status = 'published' AND g.visibility = 'public' ORDER BY f.created_at DESC LIMIT 100`, [user.id]);
    const projects = await query<{ id: string; title: string; description: string; status: string; visibility: string; updated_at: string; version_number: number | null }>(
      `SELECT p.id, p.title, p.description, p.status, p.visibility, p.updated_at,
              (SELECT MAX(v.version_number) FROM ai_project_versions v WHERE v.project_id = p.id) AS version_number
       FROM ai_projects p WHERE p.owner_id = ? ORDER BY p.updated_at DESC LIMIT 100`, [user.id]);
    const games = await query<{ id: string; title: string; slug: string; genre: string; status: string; updated_at: string }>(
      `SELECT id, title, slug, genre, status, updated_at FROM games WHERE developer_id = ? ORDER BY updated_at DESC LIMIT 100`, [user.id]);
    return Response.json({
      favorites: favorites.map((game) => ({
        id: game.id, slug: game.slug, title: game.title, genre: game.genre, description: game.description,
        cover: game.cover_image || "/art/neon-drift.svg", developer: game.developer_name, developerUsername: game.developer_username,
        accent: "#8b7cff", status: "published", isDemo: game.is_demo === 1,
        averageRating: game.average_rating === null ? null : Number(game.average_rating), ratingCount: Number(game.rating_count), savedAt: game.created_at,
      })),
      projects: projects.map((project) => ({ id: project.id, title: project.title, description: project.description, status: project.status, visibility: project.visibility, updatedAt: project.updated_at, version: project.version_number })),
      games: games.map((game) => ({ ...game, updatedAt: game.updated_at })),
    }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return errorResponse(error);
  }
}
