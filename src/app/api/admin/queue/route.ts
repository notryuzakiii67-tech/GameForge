import { requireAdmin } from "@/lib/auth";
import { query } from "@/lib/db";
import { errorResponse } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const actor = await requireAdmin();
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
    const assets = await query<{
      id: string; title: string; description: string; filename: string; format: string; category: string; size_bytes: number;
      license: string | null; rights_basis: string | null; rights_confirmed: number; download_authorized: number; attribution: string;
      submitted_at: string | null; display_name: string; username: string; validation_state: string; content_hash: string;
    }>(
      `SELECT a.id, COALESCE(NULLIF(a.store_title, ''), a.original_name) AS title, a.public_description AS description,
              a.original_name AS filename, a.format, a.category, a.size_bytes, a.license, a.rights_basis,
              a.rights_confirmed, a.download_authorized, a.attribution, a.rights_declaration_at AS submitted_at, a.validation_state, a.content_hash,
              u.display_name, u.username
       FROM assets a JOIN users u ON u.id = a.owner_id
       WHERE a.publication_status = 'pending_review' AND a.upload_status = 'ready' AND a.deleted_at IS NULL
       ORDER BY COALESCE(a.rights_declaration_at, a.updated_at) ASC LIMIT 100`);
    const suspendedUsers = actor.role === "admin"
      ? await query<{ id: string; username: string; display_name: string; role: string; updated_at: string }>(
        `SELECT id, username, display_name, role, updated_at FROM users WHERE account_status = 'suspended' ORDER BY updated_at DESC LIMIT 100`)
      : [];
    const reports = await query<{
      id: string; target_type: string; target_id: string; reason: string; details: string; created_at: string; username: string;
      target_slug: string | null; target_title: string | null; target_is_demo: number | null;
      target_game_version: number | null; target_game_entry: string | null;
      target_user_role: string | null; target_user_status: string | null;
    }>(
      `SELECT r.id, r.target_type, r.target_id, r.reason, r.details, r.created_at, u.username,
              CASE r.target_type
                WHEN 'game' THEN (SELECT g.slug FROM games g WHERE g.id = r.target_id)
                WHEN 'ai_project' THEN r.target_id
                WHEN 'user' THEN (SELECT target.username FROM users target WHERE target.id = r.target_id)
                WHEN 'asset' THEN r.target_id
              END AS target_slug,
              CASE r.target_type
                WHEN 'game' THEN (SELECT g.title FROM games g WHERE g.id = r.target_id)
                WHEN 'ai_project' THEN (SELECT p.title FROM ai_projects p WHERE p.id = r.target_id)
                WHEN 'user' THEN (SELECT target.display_name FROM users target WHERE target.id = r.target_id)
                WHEN 'asset' THEN (SELECT COALESCE(NULLIF(a.store_title, ''), a.original_name) FROM assets a WHERE a.id = r.target_id)
              END AS target_title,
              CASE r.target_type WHEN 'game' THEN (SELECT g.is_demo FROM games g WHERE g.id = r.target_id) ELSE 0 END AS target_is_demo,
              CASE r.target_type WHEN 'game' THEN (SELECT v.version_number FROM game_versions v WHERE v.game_id = r.target_id AND v.validation_status = 'validated' ORDER BY v.version_number DESC LIMIT 1) END AS target_game_version,
              CASE r.target_type WHEN 'game' THEN (SELECT v.entry_point FROM game_versions v WHERE v.game_id = r.target_id AND v.validation_status = 'validated' ORDER BY v.version_number DESC LIMIT 1) END AS target_game_entry,
              CASE r.target_type WHEN 'user' THEN (SELECT target.role FROM users target WHERE target.id = r.target_id) END AS target_user_role,
              CASE r.target_type WHEN 'user' THEN (SELECT target.account_status FROM users target WHERE target.id = r.target_id) END AS target_user_status
       FROM reports r JOIN users u ON u.id = r.reporter_id
       WHERE r.status = 'open' ORDER BY r.created_at ASC LIMIT 100`);
    return Response.json({
      games: games.map((game) => ({ id: game.id, title: game.title, slug: game.slug, description: game.description, genre: game.genre, submittedAt: game.created_at, developer: { displayName: game.developer, username: game.username }, buildVersion: game.version_number, entryPoint: game.entry_point || "index.html", validationStatus: game.validation_status })),
      projects: projects.map((project) => ({ id: project.id, title: project.title, description: project.description, genre: project.genre, submittedAt: project.updated_at, version: project.version_number ?? 1, creator: { displayName: project.display_name, username: project.username } })),
      assets: assets.map((asset) => ({
        id: asset.id, title: asset.title, description: asset.description, filename: asset.filename, format: asset.format,
        category: asset.category, sizeBytes: Number(asset.size_bytes), license: asset.license, rightsBasis: asset.rights_basis,
        rightsConfirmed: asset.rights_confirmed === 1, downloadAuthorized: asset.download_authorized === 1,
        attribution: asset.attribution, submittedAt: asset.submitted_at ?? "", validationState: asset.validation_state,
        contentHash: asset.content_hash, creator: { displayName: asset.display_name, username: asset.username },
      })),
      suspendedUsers: suspendedUsers.map((account) => ({ id: account.id, username: account.username, displayName: account.display_name, role: account.role, suspendedAt: account.updated_at })),
      reports: reports.map((report) => ({
        ...report,
        createdAt: report.created_at,
        reporterUsername: report.username,
        targetTitle: report.target_title,
        targetIsDemo: report.target_is_demo === 1,
        targetUserId: report.target_type === "user" ? report.target_id : null,
        targetUserRole: report.target_user_role,
        targetUserStatus: report.target_user_status,
        targetHref: report.target_type === "game"
          ? report.target_slug && report.target_is_demo === 1
            ? `/games/${encodeURIComponent(report.target_slug)}`
            : report.target_game_version && report.target_game_entry
              ? `/api/builds/${encodeURIComponent(report.target_id)}/${report.target_game_version}/${report.target_game_entry.split("/").map(encodeURIComponent).join("/")}`
              : null
          : report.target_slug
            ? report.target_type === "ai_project" ? `/ai-gallery/${encodeURIComponent(report.target_slug)}`
              : report.target_type === "user" ? `/developers/${encodeURIComponent(report.target_slug)}`
                : report.target_type === "asset" ? `/asset-store#asset-${encodeURIComponent(report.target_slug)}` : null
            : null,
      })),
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return errorResponse(error);
  }
}
