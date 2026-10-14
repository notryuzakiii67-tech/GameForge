import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDatabase, execute, newId, nowIso, query } from "@/lib/db";
import { takeDownReportedContent } from "@/lib/moderation";

const mutableEnv = process.env as unknown as Record<string, string | undefined>;
const previousDatabaseUrl = mutableEnv.DATABASE_URL;
const testDatabaseUrl = `file:.gameforge-local/moderation-${process.pid}.sqlite`;

beforeAll(() => { mutableEnv.DATABASE_URL = testDatabaseUrl; });
afterAll(async () => {
  await closeDatabase();
  if (previousDatabaseUrl === undefined) delete mutableEnv.DATABASE_URL;
  else mutableEnv.DATABASE_URL = previousDatabaseUrl;
});

async function createOwner() {
  const id = newId();
  const timestamp = nowIso();
  await execute(
    `INSERT INTO users(id, username, display_name, email, password_hash, role, account_status, created_at, updated_at)
     VALUES (?, ?, 'Moderation Test', ?, 'test-hash', 'user', 'active', ?, ?)`,
    [id, `mod_${id.slice(0, 8)}`, `${id}@moderation.invalid`, timestamp, timestamp],
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
