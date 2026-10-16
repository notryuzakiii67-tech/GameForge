import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));

import { closeDatabase, execute, newId, nowIso, query } from "@/lib/db";
import { setAccountStatus, takeDownReportedContent } from "@/lib/moderation";

const mutableEnv = process.env as unknown as Record<string, string | undefined>;
const previousDatabaseUrl = mutableEnv.DATABASE_URL;
const testDatabaseUrl = `file:.gameforge-local/moderation-${process.pid}.sqlite`;

beforeAll(() => { mutableEnv.DATABASE_URL = testDatabaseUrl; });
afterAll(async () => {
  await closeDatabase();
  if (previousDatabaseUrl === undefined) delete mutableEnv.DATABASE_URL;
  else mutableEnv.DATABASE_URL = previousDatabaseUrl;
});

async function createOwner(role = "user") {
  const id = newId();
  const timestamp = nowIso();
  await execute(
    `INSERT INTO users(id, username, display_name, email, password_hash, role, account_status, created_at, updated_at)
     VALUES (?, ?, ?, ?, 'test-hash', ?, 'active', ?, ?)`,
    [id, `mod_${id.slice(0, 8)}`, "Moderation Test", `${id}@moderation.invalid`, role, timestamp, timestamp],
  );
  return id;
}

async function createProject(ownerId: string, status: string) {
  const id = newId();
  const timestamp = nowIso();
  await execute(
    `INSERT INTO ai_projects(id, owner_id, title, visibility, status, created_at, updated_at)
     VALUES (?, ?, 'Moderation test project', ?, ?, ?, ?)`,
    [id, ownerId, status === "published" ? "public" : "private", status, timestamp, timestamp],
  );
  return id;
}

async function createGame(ownerId: string, status: string, projectId: string | null = null) {
  const id = newId();
  const timestamp = nowIso();
  await execute(
    `INSERT INTO games(id, developer_id, title, slug, status, visibility, source_project_id, created_at, updated_at)
     VALUES (?, ?, 'Moderation test game', ?, ?, ?, ?, ?, ?)`,
    [id, ownerId, `moderation-${id.slice(0, 8)}`, status, status === "published" ? "public" : "private", projectId, timestamp, timestamp],
  );
  return id;
}

describe("reported account moderation", () => {
  it("suspends accounts, revokes sessions, and allows an active admin to restore access", async () => {
    const actor = await createOwner("admin");
    const target = await createOwner();
    const timestamp = nowIso();
    await execute(`INSERT INTO sessions(id, user_id, token_hash, expires_at, created_at) VALUES (?, ?, ?, ?, ?)`,
      [newId(), target, `hash-${target}`, new Date(Date.now() + 60_000).toISOString(), timestamp]);
    await setAccountStatus(actor, target, "suspended", timestamp, "Confirmed abuse report");
    expect(await query<{ account_status: string }>(`SELECT account_status FROM users WHERE id=?`, [target])).toEqual([{ account_status: "suspended" }]);
    expect(await query<{ count: number }>(`SELECT COUNT(*) AS count FROM sessions WHERE user_id=?`, [target])).toEqual([{ count: 0 }]);
    expect(await query<{ event_type: string; details_json: string }>(
      `SELECT event_type, details_json FROM audit_events WHERE actor_id = ? AND target_id = ? AND event_type = 'user.suspend'`, [actor, target],
    )).toEqual([{ event_type: "user.suspend", details_json: JSON.stringify({ note: "Confirmed abuse report" }) }]);
    await setAccountStatus(actor, target, "active", nowIso(), "Verified account appeal");
    expect(await query<{ account_status: string }>(`SELECT account_status FROM users WHERE id=?`, [target])).toEqual([{ account_status: "active" }]);
    expect(await query<{ event_type: string; details_json: string }>(`SELECT event_type, details_json FROM audit_events WHERE actor_id = ? AND target_id = ? AND event_type = 'user.restore'`, [actor, target])).toEqual([
      { event_type: "user.restore", details_json: JSON.stringify({ note: "Verified account appeal" }) },
    ]);
  });

  it("requires a site admin, blocks self-suspension, and preserves an active administrator", async () => {
    const admin = await createOwner("admin");
    await expect(setAccountStatus(admin, admin, "suspended", nowIso(), "Self test")).rejects.toMatchObject({ code: "SELF_MODERATION_BLOCKED" });
    const nonAdmin = await createOwner();
    const ordinaryTarget = await createOwner();
    await expect(setAccountStatus(nonAdmin, ordinaryTarget, "suspended", nowIso(), "Unauthorized test")).rejects.toMatchObject({ code: "ADMIN_REQUIRED" });
    expect(await query<{ account_status: string }>(`SELECT account_status FROM users WHERE id = ?`, [ordinaryTarget])).toEqual([{ account_status: "active" }]);
    const otherAdmin = await createOwner("admin");
    await setAccountStatus(admin, otherAdmin, "suspended", nowIso(), "Other admin remains active");
    expect(await query<{ id: string }>(`SELECT id FROM users WHERE id = ? AND role='admin' AND account_status='active'`, [admin])).toEqual([{ id: admin }]);
  });
});

describe("report-driven content takedown", () => {
  it("removes a pending game and locks its linked AI project", async () => {
    const owner = await createOwner();
    const projectId = await createProject(owner, "submitted");
    const gameId = await createGame(owner, "pending", projectId);
    const removed = await takeDownReportedContent("game", gameId, nowIso());
    expect(removed).toContain(`game:${gameId}`);
    expect(removed).toContain(`ai_project:${projectId}`);
    expect(await query<{ status: string; visibility: string }>(`SELECT status, visibility FROM games WHERE id = ?`, [gameId])).toEqual([
      { status: "removed", visibility: "private" },
    ]);
    expect(await query<{ status: string; visibility: string }>(`SELECT status, visibility FROM ai_projects WHERE id = ?`, [projectId])).toEqual([
      { status: "removed", visibility: "private" },
    ]);
  });

  it("removes a listed AI project and any public or pending generated games", async () => {
    const owner = await createOwner();
    const projectId = await createProject(owner, "published");
    const gameId = await createGame(owner, "published", projectId);
    const removed = await takeDownReportedContent("ai_project", projectId, nowIso());
    expect(removed).toContain(`ai_project:${projectId}`);
    expect(removed).toContain("games:1");
    expect(await query<{ status: string; visibility: string }>(`SELECT status, visibility FROM games WHERE id = ?`, [gameId])).toEqual([
      { status: "removed", visibility: "private" },
    ]);
  });

  it("does not take down private drafts or suspend accounts through a content report", async () => {
    const owner = await createOwner();
    const draftId = await createProject(owner, "draft");
    await expect(takeDownReportedContent("ai_project", draftId, nowIso())).rejects.toMatchObject({ code: "CONTENT_NOT_LISTED" });
    await expect(takeDownReportedContent("user", owner, nowIso())).rejects.toMatchObject({ code: "TAKEDOWN_NOT_SUPPORTED" });
  });

  it("keeps bundled demo assets out of the report-driven takedown path", async () => {
    const owner = await createOwner();
    const gameId = await createGame(owner, "published");
    await execute(`UPDATE games SET is_demo = 1 WHERE id = ?`, [gameId]);
    await expect(takeDownReportedContent("game", gameId, nowIso())).rejects.toMatchObject({ code: "BUNDLED_DEMO_CONTENT" });
    expect(await query<{ status: string }>(`SELECT status FROM games WHERE id = ?`, [gameId])).toEqual([{ status: "published" }]);
  });
});
