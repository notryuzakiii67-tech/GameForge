import { requireAdmin } from "@/lib/auth";
import { query } from "@/lib/db";
import { errorResponse } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await requireAdmin();
    const games = await query<{
      id: string; title: string; slug: string; description: string; genre: string; created_at: string; developer: string; username: string;
      version_number: number | null; validation_status: string | null; entry_point: string | null;
    }>(
      `SELECT g.id, g.title, g.slug, g.description, g.genre, g.created_at,
              u.display_name AS developer, u.username,
              v.version_number, v.validation_status, v.entry_point
       FROM games g JOIN users u ON u.id = g.developer_id
       LEFT JOIN game_versions v ON v.id = (SELECT v2.id FROM game_versions v2 WHERE v2.game_id = g.id ORDER BY v2.version_number DESC LIMIT 1)
       WHERE g.status = 'pending' ORDER BY g.created_at ASC LIMIT 100`);
    const projects = await query<{
      id: string; title: string; description: string; genre: string; updated_at: string; display_name: string; username: string; version_number: number | null;
    }>(
      `SELECT p.id, p.title, p.description, p.genre, p.updated_at, u.display_name, u.username,
              (SELECT MAX(v.version_number) FROM ai_project_versions v WHERE v.project_id = p.id) AS version_number
       FROM ai_projects p JOIN users u ON u.id = p.owner_id
       WHERE p.status = 'pending' AND p.visibility = 'private' ORDER BY p.updated_at ASC LIMIT 100`);
    const reports = await query<{
      id: string; target_type: string; target_id: string; reason: string; details: string; created_at: string; username: string;
      target_slug: string | null; target_title: string | null; target_is_demo: number | null;
      target_game_version: number | null; target_game_entry: string | null;
    }>(
      `SELECT r.id, r.target_type, r.target_id, r.reason, r.details, r.created_at, u.username,
              CASE r.target_type
                WHEN 'game' THEN (SELECT g.slug FROM games g WHERE g.id = r.target_id)
                WHEN 'ai_project' THEN r.target_id
                WHEN 'user' THEN (SELECT target.username FROM users target WHERE target.id = r.target_id)
              END AS target_slug,
              CASE r.target_type
                WHEN 'game' THEN (SELECT g.title FROM games g WHERE g.id = r.target_id)
                WHEN 'ai_project' THEN (SELECT p.title FROM ai_projects p WHERE p.id = r.target_id)
                WHEN 'user' THEN (SELECT target.display_name FROM users target WHERE target.id = r.target_id)
              END AS target_title,
              CASE r.target_type WHEN 'game' THEN (SELECT g.is_demo FROM games g WHERE g.id = r.target_id) ELSE 0 END AS target_is_demo,
              CASE r.target_type WHEN 'game' THEN (SELECT v.version_number FROM game_versions v WHERE v.game_id = r.target_id AND v.validation_status = 'validated' ORDER BY v.version_number DESC LIMIT 1) END AS target_game_version,
              CASE r.target_type WHEN 'game' THEN (SELECT v.entry_point FROM game_versions v WHERE v.game_id = r.target_id AND v.validation_status = 'validated' ORDER BY v.version_number DESC LIMIT 1) END AS target_game_entry
       FROM reports r JOIN users u ON u.id = r.reporter_id
       WHERE r.status = 'open' ORDER BY r.created_at ASC LIMIT 100`);
    return Response.json({
      games: games.map((game) => ({ id: game.id, title: game.title, slug: game.slug, description: game.description, genre: game.genre, submittedAt: game.created_at, developer: { displayName: game.developer, username: game.username }, buildVersion: game.version_number, entryPoint: game.entry_point || "index.html", validationStatus: game.validation_status })),
      projects: projects.map((project) => ({ id: project.id, title: project.title, description: project.description, genre: project.genre, submittedAt: project.updated_at, version: project.version_number ?? 1, creator: { displayName: project.display_name, username: project.username } })),
      reports: reports.map((report) => ({
        ...report,
        createdAt: report.created_at,
        reporterUsername: report.username,
        targetTitle: report.target_title,
        targetIsDemo: report.target_is_demo === 1,
        targetHref: report.target_type === "game"
          ? report.target_slug && report.target_is_demo === 1
            ? `/games/${encodeURIComponent(report.target_slug)}`
            : report.target_game_version && report.target_game_entry
              ? `/api/builds/${encodeURIComponent(report.target_id)}/${report.target_game_version}/${report.target_game_entry.split("/").map(encodeURIComponent).join("/")}`
              : null
          : report.target_slug
            ? report.target_type === "ai_project" ? `/ai-gallery/${encodeURIComponent(report.target_slug)}`
              : report.target_type === "user" ? `/developers/${encodeURIComponent(report.target_slug)}` : null
            : null,
      })),
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return errorResponse(error);
  }
}
