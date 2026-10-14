import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDatabase, ensureDatabase, execute, query, newId, nowIso } from "@/lib/db";
import { enforceRateLimit } from "@/lib/http";

const oldDatabaseUrl = process.env.DATABASE_URL;
const testUrl = `file:.gameforge-local/tests-${process.pid}.sqlite`;

beforeAll(() => { process.env.DATABASE_URL = testUrl; });
afterAll(async () => {
  await closeDatabase();
  if (oldDatabaseUrl === undefined) delete process.env.DATABASE_URL; else process.env.DATABASE_URL = oldDatabaseUrl;
});

describe("database migrations and health", () => {
  it("applies portable local migrations and can safely re-run them", async () => {
    const first = await query<{ name: string }>(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'users'`);
    expect(first).toHaveLength(1);
    const applied = await query<{ version: string }>(`SELECT version FROM schema_migrations`);
    expect(applied.map((item) => item.version)).toContain("0001_core");
    expect(applied.map((item) => item.version)).toContain("0002_one_running_ai_generation_per_user");
    await ensureDatabase();
    expect(await query<{ version: string }>(`SELECT version FROM schema_migrations WHERE version = ?`, ["0001_core"])).toHaveLength(1);
  });

  it("persists rows across separate queries and enforces foreign keys", async () => {
    const id = newId();
    const timestamp = nowIso();
    await execute(
      `INSERT INTO users(id, username, display_name, email, password_hash, role, account_status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 'user', 'active', ?, ?)`,
      [id, `test_${id.slice(0, 8)}`, "Test Maker", `${id}@local.invalid`, "bcrypt-hash-test-value", timestamp, timestamp],
    );
    const found = await query<{ id: string; display_name: string }>(`SELECT id, display_name FROM users WHERE id = ?`, [id]);
    expect(found[0]).toMatchObject({ id, display_name: "Test Maker" });
    await execute(
      `INSERT INTO ai_generations(id, user_id, provider, model, status, started_at) VALUES (?, ?, 'gemini', 'test-model', 'running', ?)`,
      [newId(), id, timestamp],
    );
    await expect(execute(
      `INSERT INTO ai_generations(id, user_id, provider, model, status, started_at) VALUES (?, ?, 'gemini', 'test-model', 'running', ?)`,
      [newId(), id, timestamp],
    )).rejects.toThrow();
    await expect(execute(
      `INSERT INTO games(id, developer_id, title, slug, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)`,
      [newId(), newId(), "No owner", `no-owner-${id.slice(0, 6)}`, timestamp, timestamp],
    )).rejects.toThrow();
  });

  it("enforces the shared database-backed request limit", async () => {
    const request = new Request("http://localhost/api/test", { headers: { "x-forwarded-for": "203.0.113.40" } });
    await enforceRateLimit(request, "test-bucket", 2, 60_000);
    await enforceRateLimit(request, "test-bucket", 2, 60_000);
    await expect(enforceRateLimit(request, "test-bucket", 2, 60_000)).rejects.toMatchObject({ code: "RATE_LIMITED" });
  });
});
