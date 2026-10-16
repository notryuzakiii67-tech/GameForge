import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { validateAiProject } from "@/lib/ai/validate";
import { query, newId, nowIso, transaction } from "@/lib/db";
import { copyProjectVersionAssetBindingsInTransaction, getProjectAssetBindings } from "@/lib/project-assets";
import { ApiError, assertSameOrigin, errorResponse, readJson, requireUuid } from "@/lib/http";
import type { ProjectFile } from "@/lib/zip";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const schema = z.object({ files: z.array(z.object({ path: z.string(), content: z.string() })).min(1).max(80), summary: z.string().trim().max(240).default("Saved direct code edits.") });

export async function PUT(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    assertSameOrigin(request);
    const user = await requireUser();
    const { id } = await context.params;
    requireUuid(id, "project id");
    const input = await readJson(request, schema, 1_200_000);
    const owned = await query<{ id: string; status: string }>(`SELECT id, status FROM ai_projects WHERE id = ? AND owner_id = ? LIMIT 1`, [id, user.id]);
    if (!owned.length) throw new ApiError(404, "PROJECT_NOT_FOUND", "That project is not in your account.");
    if (owned[0].status === "removed") throw new ApiError(409, "CONTENT_REMOVED", "This project was removed by moderation and cannot be edited or republished.");
    let files: ProjectFile[];
    try {
      files = validateAiProject(input.files);
    } catch (error) {
      throw error;
    }
    const previous = await query<{ provider: string; model: string; version_number: number }>(
      `SELECT provider, model, version_number FROM ai_project_versions WHERE project_id = ? ORDER BY version_number DESC LIMIT 1`, [id]);
    if (!previous[0]) throw new ApiError(409, "VERSION_NOT_FOUND", "This project has no version to update.");
    const version = previous[0].version_number + 1;
    const maxVersions = Math.min(100, Math.max(1, Number(process.env.MAX_AI_VERSIONS || 20)));
    if (version > maxVersions) throw new ApiError(409, "VERSION_LIMIT_REACHED", `This project has reached its ${maxVersions}-version history limit.`);
    const timestamp = nowIso();
    await transaction(async (tx) => {
      await tx.execute(
        `INSERT INTO ai_project_versions(id, project_id, version_number, prompt_summary, provider, model, manifest_json, validation_status, change_summary, created_at)
         VALUES (?, ?, ?, 'Direct code edit', ?, ?, ?, 'validated', ?, ?)`,
        [newId(), id, version, previous[0].provider, previous[0].model, JSON.stringify(files), input.summary ?? "Saved direct code edits.", timestamp],
      );
      await copyProjectVersionAssetBindingsInTransaction(tx, user.id, id, Number(previous[0].version_number), version);
      await tx.execute(`UPDATE ai_projects SET visibility = 'private', status = 'draft', updated_at = ? WHERE id = ? AND owner_id = ?`, [timestamp, id, user.id]);
    });
    const assetBindings = await getProjectAssetBindings(user.id, id, version);
    return Response.json({ ok: true, version, files, assetBindings: assetBindings.bindings, validationStatus: "validated", note: "Paths, project size, entry point, and JavaScript syntax were checked; the game was not executed." }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return errorResponse(error);
  }
}
