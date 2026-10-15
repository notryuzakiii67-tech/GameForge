import { execute, newId, query, transaction } from "@/lib/db";
import { ApiError } from "@/lib/http";

export async function setAccountStatus(actorId: string, targetId: string, status: "active" | "suspended", timestamp: string, note: string): Promise<void> {
  if (actorId === targetId) throw new ApiError(409, "SELF_MODERATION_BLOCKED", "You cannot change your own account status.");
  const normalizedNote = note.trim();
  if (normalizedNote.length < 3 || normalizedNote.length > 500) {
    throw new ApiError(400, "MODERATION_NOTE_REQUIRED", "Provide a moderation note between 3 and 500 characters.");
  }

  await transaction(async (tx) => {
    // Serialize administrator account decisions so concurrent requests cannot suspend every active admin.
    // BEGIN IMMEDIATE provides the corresponding writer lock for SQLite.
    if (tx.dialect === "postgres") {
      await tx.query(`SELECT id FROM users WHERE role = 'admin' AND account_status = 'active' ORDER BY id FOR UPDATE`);
    }
    const actors = await tx.query<{ role: string; account_status: string }>(
      `SELECT role, account_status FROM users WHERE id = ? LIMIT 1`, [actorId]);
    if (!actors[0] || actors[0].role !== "admin" || actors[0].account_status !== "active") {
      throw new ApiError(403, "ADMIN_REQUIRED", "Active site administrator access is required.");
    }

    const users = await tx.query<{ id: string; role: string; account_status: string }>(
      `SELECT id, role, account_status FROM users WHERE id = ? LIMIT 1`, [targetId]);
    const target = users[0];
    if (!target) throw new ApiError(404, "USER_NOT_FOUND", "That account could not be found.");
    if (target.account_status === status) throw new ApiError(409, "ACCOUNT_STATUS_UNCHANGED", `That account is already ${status}.`);
    if (target.account_status !== "active" && target.account_status !== "suspended") {
      throw new ApiError(409, "ACCOUNT_STATUS_UNSUPPORTED", "That account has a status this console cannot change.");
    }
    if (status === "suspended" && target.role === "admin") {
      const activeAdmins = await tx.query<{ count: number }>(`SELECT COUNT(*) AS count FROM users WHERE role = 'admin' AND account_status = 'active'`);
      if (Number(activeAdmins[0]?.count ?? 0) <= 1) throw new ApiError(409, "LAST_ADMIN_REQUIRED", "The last active administrator cannot be suspended.");
    }

    const changed = await tx.execute(`UPDATE users SET account_status = ?, updated_at = ? WHERE id = ? AND account_status = ?`,
      [status, timestamp, targetId, target.account_status]);
    if (!changed) throw new ApiError(409, "ACCOUNT_STATUS_CHANGED", "The account changed while moderation was being processed. Refresh and try again.");
    if (status === "suspended") await tx.execute(`DELETE FROM sessions WHERE user_id = ?`, [targetId]);
    await tx.execute(
      `INSERT INTO audit_events(id, actor_id, event_type, target_type, target_id, details_json, created_at)
       VALUES (?, ?, ?, 'user', ?, ?, ?)`,
      [newId(), actorId, `user.${status === "suspended" ? "suspend" : "restore"}`, targetId, JSON.stringify({ note: normalizedNote }), timestamp],
    );
  });
}

export async function takeDownReportedContent(targetType: string, targetId: string, timestamp: string): Promise<string[]> {
  if (targetType === "game") {
    const games = await query<{ id: string; source_project_id: string | null; status: string; is_demo: number }>(
      `SELECT id, source_project_id, status, is_demo FROM games WHERE id = ? LIMIT 1`, [targetId]);
    const game = games[0];
    if (!game) throw new ApiError(404, "REPORT_TARGET_NOT_FOUND", "The reported game is no longer available.");
    if (game.is_demo === 1) throw new ApiError(409, "BUNDLED_DEMO_CONTENT", "Starter demo files are served as deployment assets and must be removed in a deployment update.");
    if (game.status !== "published" && game.status !== "pending") {
      throw new ApiError(409, "CONTENT_NOT_LISTED", "That game is not currently public or awaiting review, so it was not changed.");
    }
    const changed = await execute(
      `UPDATE games SET status = 'removed', visibility = 'private', updated_at = ? WHERE id = ? AND status IN ('published', 'pending')`,
      [timestamp, targetId],
    );
    if (!changed) throw new ApiError(409, "CONTENT_CHANGED", "The game changed while the report was being reviewed. Refresh the queue and try again.");
    const removed = [`game:${targetId}`];
    if (game.source_project_id) {
      await execute(`UPDATE ai_projects SET status = 'removed', visibility = 'private', updated_at = ? WHERE id = ?`, [timestamp, game.source_project_id]);
      removed.push(`ai_project:${game.source_project_id}`);
    }
    return removed;
  }

  if (targetType === "ai_project") {
    const projects = await query<{ id: string; status: string }>(`SELECT id, status FROM ai_projects WHERE id = ? LIMIT 1`, [targetId]);
    const project = projects[0];
    if (!project) throw new ApiError(404, "REPORT_TARGET_NOT_FOUND", "The reported AI project is no longer available.");
    if (!["published", "pending", "submitted"].includes(project.status)) {
      throw new ApiError(409, "CONTENT_NOT_LISTED", "That AI project is not public or awaiting review, so it was not changed.");
    }
    const changed = await execute(
      `UPDATE ai_projects SET status = 'removed', visibility = 'private', updated_at = ? WHERE id = ? AND status IN ('published', 'pending', 'submitted')`,
      [timestamp, targetId],
    );
    if (!changed) throw new ApiError(409, "CONTENT_CHANGED", "The AI project changed while the report was being reviewed. Refresh the queue and try again.");
    const removed = [`ai_project:${targetId}`];
    const removedGames = await execute(
      `UPDATE games SET status = 'removed', visibility = 'private', updated_at = ? WHERE source_project_id = ? AND status IN ('published', 'pending')`,
      [timestamp, targetId],
    );
    if (removedGames > 0) removed.push(`games:${removedGames}`);
    return removed;
  }

  throw new ApiError(400, "TAKEDOWN_NOT_SUPPORTED", "Content takedowns apply only to games and AI projects. Use site-admin account controls to act on a user report.");
}
