import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { validateAiProject } from "@/lib/ai/validate";
import { execute, query, newId, nowIso } from "@/lib/db";
import { ApiError, assertSameOrigin, errorResponse, readJson, requireUuid } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const schema = z.object({ version: z.number().int().positive() });

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    assertSameOrigin(request);
    const user = await requireUser();
    const { id } = await context.params;
    requireUuid(id, "project id");
    const input = await readJson(request, schema);
    const owned = await query<{ id: string; status: string }>(`SELECT id, status FROM ai_projects WHERE id = ? AND owner_id = ?`, [id, user.id]);
    if (!owned.length) throw new ApiError(404, "PROJECT_NOT_FOUND", "That project is not in your account.");
    if (owned[0].status === "removed") throw new ApiError(409, "CONTENT_REMOVED", "This project was removed by moderation and cannot be restored or republished.");
    const sources = await query<{ manifest_json: string; provider: string; model: string }>(
      `SELECT manifest_json, provider, model FROM ai_project_versions WHERE project_id = ? AND version_number = ? LIMIT 1`, [id, input.version]);
    if (!sources[0]) throw new ApiError(404, "VERSION_NOT_FOUND", "That saved version could not be found.");
    let files;
    try {
      files = validateAiProject(JSON.parse(sources[0].manifest_json));
    } catch {
      throw new ApiError(409, "VERSION_INVALID", "This saved version failed validation and was not restored.");
    }
    const next = await query<{ next_version: number }>(`SELECT COALESCE(MAX(version_number), 0) + 1 AS next_version FROM ai_project_versions WHERE project_id = ?`, [id]);
    const version = Number(next[0]?.next_version ?? 1);
    const maxVersions = Math.min(100, Math.max(1, Number(process.env.MAX_AI_VERSIONS || 20)));
    if (version > maxVersions) throw new ApiError(409, "VERSION_LIMIT_REACHED", `This project has reached its ${maxVersions}-version limit.`);
    const timestamp = nowIso();
    await execute(
      `INSERT INTO ai_project_versions(id, project_id, version_number, prompt_summary, provider, model, manifest_json, validation_status, change_summary, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'validated', ?, ?)`,
      [newId(), id, version, `Restore version ${input.version}`, sources[0].provider, sources[0].model, JSON.stringify(files), "Restored a previous version; earlier history was preserved.", timestamp],
    );
    await execute(`UPDATE ai_projects SET visibility = 'private', status = 'draft', updated_at = ? WHERE id = ?`, [timestamp, id]);
    return Response.json({ ok: true, version, files, summary: "Previous version restored as a new version." }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return errorResponse(error);
  }
}
