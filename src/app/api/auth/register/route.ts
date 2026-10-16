import bcrypt from "bcryptjs";
import { ZodError } from "zod";
import { registrationSchema, normalizeUsername, noContactEmail, isUniqueConstraintError } from "@/lib/auth-validation";
import { execute, query, newId, nowIso } from "@/lib/db";
import { ApiError, assertSameOrigin, enforceRateLimit, errorResponse, readJson } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    await enforceRateLimit(request, "auth-register", 4, 60 * 60 * 1000);
    const input = await readJson(request, registrationSchema);
    const username = normalizeUsername(input.username);
    const email = input.email?.trim().toLowerCase() || null;

    const existingUsername = await query<{ id: string }>(`SELECT id FROM users WHERE LOWER(username) = ? LIMIT 1`, [username]);
    if (existingUsername.length) throw new ApiError(409, "USERNAME_TAKEN", "That username is unavailable. Try another.");
    if (email) {
      const existingEmail = await query<{ id: string }>(`SELECT id FROM users WHERE LOWER(email) = ? LIMIT 1`, [email]);
      if (existingEmail.length) throw new ApiError(409, "ACCOUNT_EXISTS", "An account already uses that email address.");
    }

    const id = newId();
    const timestamp = nowIso();
    const passwordHash = await bcrypt.hash(input.password, 12);
    try {
      await execute(
        `INSERT INTO users(id, username, display_name, email, password_hash, role, account_status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, 'user', 'active', ?, ?)`,
        [id, username, input.displayName, email ?? noContactEmail(id), passwordHash, timestamp, timestamp],
      );
    } catch (error) {
      if (isUniqueConstraintError(error)) throw new ApiError(409, "ACCOUNT_EXISTS", "That username or email is already in use.");
      throw error;
    }

    return Response.json({
      user: { id, username, displayName: input.displayName, role: "user" },
      message: "Account created. Sign in with your username and password.",
    }, { status: 201, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof ZodError) {
      return errorResponse(new ApiError(400, "INVALID_INPUT", "Check your username, password, and optional email. Confirm your password matches."));
    }
    return errorResponse(error);
  }
}
