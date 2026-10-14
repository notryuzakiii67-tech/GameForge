import { requireUser } from "@/lib/auth";
import { execute, query, nowIso } from "@/lib/db";
import { ApiError, assertSameOrigin, errorResponse } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request, context: { params: Promise<{ username: string }> }) {
  try {
    assertSameOrigin(request);
    const user = await requireUser();
    const { username } = await context.params;
    const developers = await query<{ id: string }>(`SELECT id FROM users WHERE username = ? AND account_status = 'active' LIMIT 1`, [username.toLowerCase()]);
    const developer = developers[0];
    if (!developer) throw new ApiError(404, "DEVELOPER_NOT_FOUND", "That developer does not exist.");
    if (developer.id === user.id) throw new ApiError(400, "CANNOT_FOLLOW_SELF", "You can’t follow your own profile.");
    await execute(`INSERT INTO follows(follower_id, followed_id, created_at) VALUES (?, ?, ?) ON CONFLICT(follower_id, followed_id) DO NOTHING`, [user.id, developer.id, nowIso()]);
    return Response.json({ following: true }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function DELETE(request: Request, context: { params: Promise<{ username: string }> }) {
  try {
    assertSameOrigin(request);
    const user = await requireUser();
    const { username } = await context.params;
    const developers = await query<{ id: string }>(`SELECT id FROM users WHERE username = ? LIMIT 1`, [username.toLowerCase()]);
    if (!developers[0]) throw new ApiError(404, "DEVELOPER_NOT_FOUND", "That developer does not exist.");
    await execute(`DELETE FROM follows WHERE follower_id = ? AND followed_id = ?`, [user.id, developers[0].id]);
    return Response.json({ following: false }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return errorResponse(error);
  }
}
