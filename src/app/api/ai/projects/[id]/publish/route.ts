import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { validateAiProject } from "@/lib/ai/validate";
import { hasPrivateAssetReferences } from "@/lib/asset-references";
import { getProjectVersionAssetIds } from "@/lib/project-assets";
import { execute, query, newId, nowIso } from "@/lib/db";
import { ApiError, assertSameOrigin, errorResponse, readJson, requireUuid } from "@/lib/http";
import { assertStorageReadyForPublishing, contentTypeForPath, putObject } from "@/lib/storage";
import { textFilesToBuild } from "@/lib/zip";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;
const schema = z.object({ license: z.enum(["all-rights-reserved", "cc-by-4.0", "cc-by-sa-4.0", "cc0-1.0"]).default("all-rights-reserved") });

function slugify(value: string): string {
  return value.toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 64) || "game";
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    assertSameOrigin(request);
    const user = await requireUser();
    const { id: projectId } = await context.params;
    requireUuid(projectId, "project id");
    const input = await readJson(request, schema);
    const projectRows = await query<{ id: string; title: string; description: string; genre: string; status: string }>(
      `SELECT id, title, description, genre, status FROM ai_projects WHERE id = ? AND owner_id = ? LIMIT 1`, [projectId, user.id]);
    const project = projectRows[0];
    if (!project) throw new ApiError(404, "PROJECT_NOT_FOUND", "That project is not in your account.");
    if (project.status === "removed") throw new ApiError(409, "CONTENT_REMOVED", "This project was removed by moderation and cannot be republished.");
    if (project.status === "submitted") throw new ApiError(409, "ALREADY_SUBMITTED", "This project already has a submission under review.");
    const existingGame = await query<{ id: string; slug: string; status: string }>(`SELECT id, slug, status FROM games WHERE source_project_id = ? AND developer_id = ? LIMIT 1`, [projectId, user.id]);
    if (existingGame[0]) return Response.json({ game: existingGame[0], message: `This project already has a ${existingGame[0].status} game submission.` }, { status: 200, headers: { "Cache-Control": "no-store" } });

    const latest = await query<{ manifest_json: string; version_number: number }>(`SELECT manifest_json, version_number FROM ai_project_versions WHERE project_id = ? ORDER BY version_number DESC LIMIT 1`, [projectId]);
    if (!latest[0]) throw new ApiError(400, "PROJECT_VERSION_REQUIRED", "Create a playable version before publishing.");
    let files;
    try {
      files = validateAiProject(JSON.parse(latest[0].manifest_json));
    } catch {
      throw new ApiError(409, "PROJECT_INVALID", "This version did not pass final project validation.");
    }
    const privateAssetIds = await getProjectVersionAssetIds(user.id, projectId, Number(latest[0].version_number));
    if (privateAssetIds.length || hasPrivateAssetReferences(files)) {
      throw new ApiError(409, "PRIVATE_ASSET_PUBLICATION_BLOCKED", "This version uses private asset bindings or unresolved asset placeholders. Remove them before submitting; public asset rights and consent are not implemented yet.");
    }
    assertStorageReadyForPublishing();
    const build = textFilesToBuild(files);
    const gameId = newId();
    const baseSlug = slugify(project.title);
    let slug = baseSlug;
    if ((await query<{ id: string }>(`SELECT id FROM games WHERE slug = ? LIMIT 1`, [slug])).length) slug = `${baseSlug}-${gameId.slice(0, 6)}`;
    const storageKey = `games/${gameId}/v1`;
    for (const [filePath, bytes] of Object.entries(build.files)) await putObject(`${storageKey}/${filePath}`, bytes, contentTypeForPath(filePath));
    const timestamp = nowIso();
    await execute(
      `INSERT INTO games(id, developer_id, title, slug, description, genre, tags_json, status, visibility, version,
                         entry_point, controls, instructions, license, remix_enabled, source_project_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', 'private', '1.0.0', ?, ?, ?, ?, 0, ?, ?, ?)`,
      [gameId, user.id, project.title, slug, project.description, project.genre, JSON.stringify(["ai-generated"]), build.entryPoint, "Keyboard, pointer, and touch controls as implemented by this game.", "The game includes its own start and instruction screen.", input.license ?? "all-rights-reserved", projectId, timestamp, timestamp],
    );
    await execute(
      `INSERT INTO game_versions(id, game_id, version_number, storage_key, entry_point, file_size, content_hash, validation_status, changelog, created_at)
       VALUES (?, ?, 1, ?, ?, ?, ?, 'validated', ?, ?)`,
      [newId(), gameId, storageKey, build.entryPoint, build.fileSize, build.contentHash, "AI-generated build passed path, size, entry-point, and syntax checks.", timestamp],
    );
    await execute(`UPDATE ai_projects SET status = 'submitted', updated_at = ? WHERE id = ? AND owner_id = ?`, [timestamp, projectId, user.id]);
    return Response.json({
      game: { id: gameId, slug, title: project.title, status: "pending" },
      message: "Your game is in the moderation queue. It will become public after approval.",
    }, { status: 201, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return errorResponse(error);
  }
}
