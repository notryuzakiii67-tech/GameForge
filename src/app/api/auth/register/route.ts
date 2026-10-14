import bcrypt from "bcryptjs";
import { z } from "zod";
import { createSession, type PublicUser } from "@/lib/auth";
import { execute, query, newId, nowIso } from "@/lib/db";
import { ApiError, assertSameOrigin, enforceRateLimit, errorResponse, readJson } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = z.object({
  username: z.string().trim().min(3).max(24).regex(/^[a-zA-Z0-9_]+$/, "Use letters, numbers, and underscores only."),
  displayName: z.string().trim().min(1).max(48),
  email: z.string().trim().email().max(254),
  password: z.string().min(12).max(128),
});

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    await enforceRateLimit(request, "auth-register", 4, 60 * 60 * 1000);
    const input = await readJson(request, schema);
    const username = input.username.toLowerCase();
    const email = input.email.toLowerCase();
    const existing = await query<{ id: string }>(`SELECT id FROM users WHERE email = ? OR username = ? LIMIT 1`, [email, username]);
    if (existing.length) throw new ApiError(409, "ACCOUNT_EXISTS", "That email or username is already in use.");
    const id = newId();
    const timestamp = nowIso();
    const passwordHash = await bcrypt.hash(input.password, 12);
    await execute(
      `INSERT INTO users(id, username, display_name, email, password_hash, role, account_status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 'user', 'active', ?, ?)`,
      [id, username, input.displayName, email, passwordHash, timestamp, timestamp],
    );
    await createSession(id);
    const user: PublicUser = { id, username, displayName: input.displayName, email, role: "user", avatar: null, bio: "" };
    return Response.json({ user }, { status: 201, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return errorResponse(error);
  }
}
