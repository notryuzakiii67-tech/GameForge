import bcrypt from "bcryptjs";
import { z } from "zod";
import { createSession } from "@/lib/auth";
import { query } from "@/lib/db";
import { ApiError, assertSameOrigin, enforceRateLimit, errorResponse, readJson } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = z.object({ email: z.string().trim().email().max(254), password: z.string().min(1).max(128) });
const DUMMY_HASH = "$2b$12$Wj7FfV9N4bYxPJwAr9z6Zu6VQY0kA1DLuPs2f6xQwUeQw0jv5Za3K";

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    await enforceRateLimit(request, "auth-login", 12, 15 * 60 * 1000);
    const input = await readJson(request, schema);
    const rows = await query<{ id: string; username: string; display_name: string; email: string; password_hash: string; role: "user" | "admin" | "moderator"; account_status: string; avatar: string | null; bio: string }>(
      `SELECT id, username, display_name, email, password_hash, role, account_status, avatar, bio FROM users WHERE email = ? LIMIT 1`,
      [input.email.toLowerCase()],
    );
    const account = rows[0];
    const passwordMatches = await bcrypt.compare(input.password, account?.password_hash ?? DUMMY_HASH);
    if (!account || !passwordMatches || account.account_status !== "active") {
      throw new ApiError(401, "INVALID_CREDENTIALS", "Email or password is incorrect.");
    }
    await createSession(account.id);
    return Response.json({
      user: {
        id: account.id,
        username: account.username,
        displayName: account.display_name,
        email: account.email,
        role: account.role,
        avatar: account.avatar,
        bio: account.bio,
      },
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return errorResponse(error);
  }
}
