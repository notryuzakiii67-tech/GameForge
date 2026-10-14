import { query } from "@/lib/db";
import { errorResponse } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const developers = await query<{
      id: string; username: string; display_name: string; bio: string; studio_name: string | null; studio_description: string | null;
      game_count: number; follower_count: number;
    }>(
      `SELECT u.id, u.username, u.display_name, u.bio, p.studio_name, p.description AS studio_description,
              (SELECT COUNT(*) FROM games g WHERE g.developer_id = u.id AND g.status = 'published' AND g.visibility = 'public') AS game_count,
              (SELECT COUNT(*) FROM follows f WHERE f.followed_id = u.id) AS follower_count
       FROM users u LEFT JOIN developer_profiles p ON p.user_id = u.id
       WHERE u.account_status = 'active'
         AND (p.user_id IS NOT NULL OR EXISTS (SELECT 1 FROM games g WHERE g.developer_id = u.id AND g.status = 'published' AND g.visibility = 'public'))
       ORDER BY game_count DESC, u.created_at DESC LIMIT 48`);
    return Response.json({ developers: developers.map((developer) => ({
      id: developer.id,
      username: developer.username,
      displayName: developer.display_name,
      bio: developer.bio,
      studio: developer.studio_name ? { name: developer.studio_name, description: developer.studio_description } : null,
      publishedGames: Number(developer.game_count),
      followers: Number(developer.follower_count),
    })) }, { headers: { "Cache-Control": "public, s-maxage=60, stale-while-revalidate=300" } });
  } catch (error) {
    return errorResponse(error);
  }
}
