import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { closeDatabase, query } from "@/lib/db";
import { loginSchema, noContactEmail, normalizeUsername, registrationSchema } from "@/lib/auth-validation";

vi.mock("@/lib/auth", () => ({ createSession: vi.fn(async () => undefined) }));

import { createSession } from "@/lib/auth";
import { POST as register } from "@/app/api/auth/register/route";
import { POST as login } from "@/app/api/auth/login/route";

const mutableEnv = process.env as unknown as Record<string, string | undefined>;
const previousDatabaseUrl = mutableEnv.DATABASE_URL;
const previousSiteUrl = mutableEnv.NEXT_PUBLIC_SITE_URL;
const testDatabaseUrl = `file:.gameforge-local/auth-${process.pid}.sqlite`;

beforeAll(() => {
  mutableEnv.DATABASE_URL = testDatabaseUrl;
  mutableEnv.NEXT_PUBLIC_SITE_URL = "http://localhost:3000";
});
afterAll(async () => {
  await closeDatabase();
  if (previousDatabaseUrl === undefined) delete mutableEnv.DATABASE_URL;
  else mutableEnv.DATABASE_URL = previousDatabaseUrl;
  if (previousSiteUrl === undefined) delete mutableEnv.NEXT_PUBLIC_SITE_URL;
  else mutableEnv.NEXT_PUBLIC_SITE_URL = previousSiteUrl;
});
beforeEach(() => vi.mocked(createSession).mockClear());

function request(body: unknown, path: "register" | "login" = "register") {
  return new Request(`http://localhost:3000/api/auth/${path}`, {
    method: "POST",
    headers: {
      origin: "http://localhost:3000",
      "content-type": "application/json",
      "x-forwarded-for": `198.51.100.${Math.floor(Math.random() * 200) + 1}`,
    },
    body: JSON.stringify(body),
  });
}

const validRegistration = (overrides: Record<string, unknown> = {}) => ({
  username: "Player_One",
  displayName: "Player One",
  password: "a secure password 123",
  confirmPassword: "a secure password 123",
  ...overrides,
});

describe("username-first account validation", () => {
  it("allows signup without email and requires a matching confirmed password", () => {
    expect(registrationSchema.safeParse(validRegistration()).success).toBe(true);
    expect(registrationSchema.safeParse(validRegistration({ password: "a secure password 123", confirmPassword: "different password 456" })).success).toBe(false);
    expect(registrationSchema.safeParse(validRegistration({ username: "bad-name" })).success).toBe(false);
    expect(registrationSchema.safeParse(validRegistration({ email: "not-an-email" })).success).toBe(false);
    expect(registrationSchema.safeParse(validRegistration({ password: "é".repeat(36), confirmPassword: "é".repeat(36) })).success).toBe(true);
    expect(registrationSchema.safeParse(validRegistration({ password: "é".repeat(37), confirmPassword: "é".repeat(37) })).success).toBe(false);
    expect(loginSchema.safeParse({ username: "Player_One", password: "x" }).success).toBe(true);
    expect(normalizeUsername("  Player_One  ")).toBe("player_one");
    expect(noContactEmail("user-id")).toBe("no-contact+user-id@users.gameforge.invalid");
  });

  it("creates a username-only account without exposing a placeholder email or auto-logging in", async () => {
    const response = await register(request(validRegistration()));
    expect(response.status).toBe(201);
    expect(response.headers.get("set-cookie")).toBeNull();
    const result = await response.json();
    expect(result.user).toMatchObject({ username: "player_one", displayName: "Player One", role: "user" });
    expect(result.user).not.toHaveProperty("email");
    const rows = await query<{ username: string; email: string; email_verified_at: string | null }>(
      `SELECT username, email, email_verified_at FROM users WHERE id = ?`, [result.user.id]);
    expect(rows).toHaveLength(1);
    expect(rows[0].username).toBe("player_one");
    expect(rows[0].email).toMatch(/@users\.gameforge\.invalid$/);
    expect(rows[0].email_verified_at).toBeNull();
    expect(await query(`SELECT id FROM sessions WHERE user_id = ?`, [result.user.id])).toHaveLength(0);
  });

  it("rejects password mismatch and case-insensitive username duplicates", async () => {
    const mismatch = await register(request(validRegistration({ username: "mismatch_user", password: "correct horse battery", confirmPassword: "wrong horse battery" })));
    expect(mismatch.status).toBe(400);
    expect(await query(`SELECT id FROM users WHERE LOWER(username) = 'mismatch_user'`)).toHaveLength(0);

    const first = await register(request(validRegistration({ username: "Unique_Maker" })));
    expect(first.status).toBe(201);
    const second = await register(request(validRegistration({ username: "UNIQUE_MAKER" })));
    expect(second.status).toBe(409);
    const payload = await second.json();
    expect(payload.error.message).toMatch(/username is unavailable/i);
  });

  it("logs in by case-insensitive username and uses a generic failure message", async () => {
    const created = await register(request(validRegistration({ username: "Login_Maker" })));
    expect(created.status).toBe(201);
    const account = await created.json();

    const successful = await login(request({ username: "LOGIN_MAKER", password: "a secure password 123" }, "login"));
    expect(successful.status).toBe(200);
    expect((await successful.json()).user).toMatchObject({ id: account.user.id, username: "login_maker" });
    expect(createSession).toHaveBeenCalledWith(account.user.id);

    const wrongPassword = await login(request({ username: "login_maker", password: "incorrect" }, "login"));
    const unknownUser = await login(request({ username: "not_a_user", password: "incorrect" }, "login"));
    expect(wrongPassword.status).toBe(401);
    expect(unknownUser.status).toBe(401);
    expect((await wrongPassword.json()).error.message).toBe((await unknownUser.json()).error.message);
  });
});
