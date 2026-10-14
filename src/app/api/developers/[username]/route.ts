import { getCurrentUser } from "@/lib/auth";
import { query } from "@/lib/db";
import { ApiError, errorResponse } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_request: Request, context: { params: Promise<{ username: string }> }) {
  try {
    const { username } = await context.params;
    const users = await query<{
      id: string; username: string; display_name: string; bio: string; avatar: string | null;
      studio_name: string | null; studio_description: string | null; website: string | null;
    }>(
      `SELECT u.id, u.username, u.display_name, u.bio, u.avatar,
              p.studio_name, p.description AS studio_description, p.website
       FROM users u LEFT JOIN developer_profiles p ON p.user_id = u.id
       WHERE u.username = ? AND u.account_status = 'active' LIMIT 1`, [username.toLowerCase()]);
    const profile = users[0];
    if (!profile) throw new ApiError(404, "DEVELOPER_NOT_FOUND", "That creator profile could not be found.");
    const counts = await query<{ followers: number; following: number; games: number }>(
      `SELECT (SELECT COUNT(*) FROM follows WHERE followed_id = ?) AS followers,
              (SELECT COUNT(*) FROM follows WHERE follower_id = ?) AS following,
              (SELECT COUNT(*) FROM games WHERE developer_id = ? AND status = 'published' AND visibility = 'public') AS games`, [profile.id, profile.id, profile.id]);
    const user = await getCurrentUser();
    const following = user ? (await query<{ follower_id: string }>(`SELECT follower_id FROM follows WHERE follower_id = ? AND followed_id = ?`, [user.id, profile.id])).length > 0 : false;
    const games = await query<{ id: string; slug: string; title: string; genre: string; description: string; cover_image: string | null; is_demo: number; average_rating: number | null; rating_count: number }>(
      `SELECT g.id, g.slug, g.title, g.genre, g.description, g.cover_image, g.is_demo,
              (SELECT AVG(r.rating) FROM ratings r WHERE r.game_id = g.id) AS average_rating,
              (SELECT COUNT(*) FROM ratings r WHERE r.game_id = g.id) AS rating_count
       FROM games g WHERE g.developer_id = ? AND g.status = 'published' AND g.visibility = 'public' ORDER BY g.published_at DESC LIMIT 30`, [profile.id]);
    return Response.json({
      profile: {
        id: profile.id,
        username: profile.username,
        displayName: profile.display_name,
        bio: profile.bio,
        avatar: profile.avatar,
        studio: profile.studio_name ? { name: profile.studio_name, description: profile.studio_description, website: profile.website } : null,
        followers: Number(counts[0]?.followers ?? 0),
        following: Number(counts[0]?.following ?? 0),
        publishedGames: Number(counts[0]?.games ?? 0),
        isFollowing: following,
      },
      games: games.map((game) => ({ id: game.id, slug: game.slug, title: game.title, genre: game.genre, description: game.description, cover: game.cover_image || "/art/neon-drift.svg", developer: profile.studio_name || profile.display_name, developerUsername: profile.username, accent: "#8b7cff", status: "published", isDemo: game.is_demo === 1, averageRating: game.average_rating === null ? null : Number(game.average_rating), ratingCount: Number(game.rating_count) })),
    }, { headers: { "Cache-Control": user ? "private, no-store" : "public, s-maxage=60, stale-while-revalidate=300" } });
  } catch (error) {
    return errorResponse(error);
  }
}
