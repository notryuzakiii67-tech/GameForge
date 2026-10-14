import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { execute, query, newId, nowIso } from "@/lib/db";
import { ApiError } from "@/lib/http";

const SESSION_TTL_SECONDS = 60 * 60 * 24 * 14;
export const SESSION_COOKIE = process.env.NODE_ENV === "production" ? "__Host-gf_session" : "gf_session";

export type PublicUser = {
  id: string;
  username: string;
  displayName: string;
  email: string;
  role: "user" | "admin" | "moderator";
  avatar: string | null;
  bio: string;
};

type UserRow = PublicUser & { accountStatus: string };

function tokenHash(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export async function createSession(userId: string): Promise<void> {
  const token = randomBytes(32).toString("base64url");
  const timestamp = nowIso();
  const expiresAt = new Date(Date.now() + SESSION_TTL_SECONDS * 1000).toISOString();
  await execute(
    `INSERT INTO sessions(id, user_id, token_hash, expires_at, created_at) VALUES (?, ?, ?, ?, ?)`,
    [newId(), userId, tokenHash(token), expiresAt, timestamp],
  );
  const cookieStore = await cookies();
  cookieStore.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_TTL_SECONDS,
    priority: "high",
  });
}

export async function revokeCurrentSession(): Promise<void> {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;
  if (token) await execute(`DELETE FROM sessions WHERE token_hash = ?`, [tokenHash(token)]);
  cookieStore.set(SESSION_COOKIE, "", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  });
}

export async function getCurrentUser(): Promise<PublicUser | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;
  if (!token || token.length > 128) return null;
  const rows = await query<UserRow>(
    `SELECT u.id, u.username, u.display_name AS "displayName", u.email, u.role,
            u.avatar, u.bio, u.account_status AS "accountStatus"
     FROM sessions s JOIN users u ON u.id = s.user_id
     WHERE s.token_hash = ? AND s.expires_at > ?`,
    [tokenHash(token), nowIso()],
  );
  const user = rows[0];
  if (!user || user.accountStatus !== "active") return null;
  return {
    id: user.id,
    username: user.username,
    displayName: user.displayName,
    email: user.email,
    role: user.role,
    avatar: user.avatar,
    bio: user.bio,
  };
}

export async function requireUser(): Promise<PublicUser> {
  const user = await getCurrentUser();
  if (!user) throw new ApiError(401, "AUTH_REQUIRED", "Sign in to continue.");
  return user;
}

export async function requireAdmin(): Promise<PublicUser> {
  const user = await requireUser();
  if (user.role !== "admin" && user.role !== "moderator") {
    throw new ApiError(403, "ADMIN_REQUIRED", "You don’t have permission to do that.");
  }
  return user;
}

export async function requireSiteAdmin(): Promise<PublicUser> {
  const user = await requireUser();
  if (user.role !== "admin") throw new ApiError(403, "ADMIN_REQUIRED", "Administrator access is required.");
  return user;
}

export function sessionDurationSeconds(): number {
  return SESSION_TTL_SECONDS;
}
