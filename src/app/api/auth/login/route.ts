import bcrypt from "bcryptjs";
import { ZodError } from "zod";
import { loginSchema, normalizeUsername } from "@/lib/auth-validation";
import { createSession } from "@/lib/auth";
import { query } from "@/lib/db";
import { ApiError, assertSameOrigin, enforceRateLimit, errorResponse, readJson } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DUMMY_HASH = "$2b$12$Wj7FfV9N4bYxPJwAr9z6Zu6VQY0kA1DLuPs2f6xQwUeQw0jv5Za3K";

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    await enforceRateLimit(request, "auth-login", 12, 15 * 60 * 1000);
    const input = await readJson(request, loginSchema);
    const username = normalizeUsername(input.username);
    const rows = await query<{
      id: string; username: string; display_name: string; password_hash: string;
      role: "user" | "admin" | "moderator"; account_status: string; avatar: string | null; bio: string;
    }>(
      `SELECT id, username, display_name, password_hash, role, account_status, avatar, bio
       FROM users WHERE LOWER(username) = ? LIMIT 1`,
      [username],
    );
    const account = rows[0];
    const passwordMatches = await bcrypt.compare(input.password, account?.password_hash ?? DUMMY_HASH);
    if (!account || !passwordMatches || account.account_status !== "active") {
      throw new ApiError(401, "INVALID_CREDENTIALS", "Invalid username or password.");
    }
    await createSession(account.id);
    return Response.json({
      user: {
        id: account.id,
        username: account.username,
        displayName: account.display_name,
        role: account.role,
        avatar: account.avatar,
        bio: account.bio,
      },
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof ZodError) return errorResponse(new ApiError(400, "INVALID_INPUT", "Enter a valid username and password."));
    return errorResponse(error);
  }
}
