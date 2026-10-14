import { execute, query } from "@/lib/db";
import { ApiError } from "@/lib/http";

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

  throw new ApiError(400, "TAKEDOWN_NOT_SUPPORTED", "Reports about accounts can be actioned or dismissed, but account suspension is not available in this console.");
}
