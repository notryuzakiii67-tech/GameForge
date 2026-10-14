import { requireUser } from "@/lib/auth";
import { validateAiProject } from "@/lib/ai/validate";
import { execute, query, newId, nowIso } from "@/lib/db";
import { ApiError, assertSameOrigin, errorResponse, requireUuid } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    assertSameOrigin(request);
    const user = await requireUser();
    const { id: sourceId } = await context.params;
    requireUuid(sourceId, "source project id");
    const sourceRows = await query<{ id: string; title: string; description: string; genre: string; allow_remix: number }>(
      `SELECT id, title, description, genre, allow_remix FROM ai_projects WHERE id = ? AND visibility = 'public' AND status = 'published' LIMIT 1`, [sourceId]);
    const source = sourceRows[0];
    if (!source || source.allow_remix !== 1) throw new ApiError(404, "REMIX_NOT_ALLOWED", "This project is private or the creator has not enabled remixing.");
    const versions = await query<{ version_number: number; manifest_json: string; provider: string; model: string }>(
      `SELECT version_number, manifest_json, provider, model FROM ai_project_versions WHERE project_id = ? ORDER BY version_number DESC LIMIT 1`, [sourceId]);
    if (!versions[0]) throw new ApiError(404, "VERSION_NOT_FOUND", "The source project has no published version.");
    let files;
    try {
      files = validateAiProject(JSON.parse(versions[0].manifest_json));
    } catch {
      throw new ApiError(409, "SOURCE_INVALID", "This source version did not pass project validation.");
    }
    const id = newId();
    const versionId = newId();
    const timestamp = nowIso();
    const title = `Remix of ${source.title}`.slice(0, 90);
    await execute(
      `INSERT INTO ai_projects(id, owner_id, title, description, genre, visibility, status, source_project_id, allow_remix, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 'private', 'draft', ?, 0, ?, ?)`,
      [id, user.id, title, source.description, source.genre, sourceId, timestamp, timestamp],
    );
    await execute(
      `INSERT INTO ai_project_versions(id, project_id, version_number, prompt_summary, provider, model, manifest_json, validation_status, change_summary, created_at)
       VALUES (?, ?, 1, ?, ?, ?, ?, 'validated', ?, ?)`,
      [versionId, id, `Remix from project ${sourceId}, version ${versions[0].version_number}`, versions[0].provider, versions[0].model, JSON.stringify(files), `Remixed from “${source.title}”. The source project remains unchanged.`, timestamp],
    );
    return Response.json({ project: { id, title, version: 1, sourceProjectId: sourceId, sourceTitle: source.title }, files }, { status: 201, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return errorResponse(error);
  }
}
