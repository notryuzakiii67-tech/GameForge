import { z } from "zod";
import { getCurrentUser, requireUser } from "@/lib/auth";
import { execute, query, nowIso } from "@/lib/db";
import { ApiError, assertSameOrigin, errorResponse, readJson, requireUuid } from "@/lib/http";
import { genres } from "@/lib/demo-games";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const updateSchema = z.object({ visibility: z.enum(["private", "public"]).optional(), allowRemix: z.boolean().optional(), genre: z.string().trim().min(1).max(64).optional() }).refine((value) => value.visibility !== undefined || value.allowRemix !== undefined || value.genre !== undefined);

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    requireUuid(id, "project id");
    const projectRows = await query<{
      id: string; owner_id: string; title: string; description: string; genre: string; visibility: string; status: string;
      source_project_id: string | null; allow_remix: number; updated_at: string; username: string; display_name: string;
    }>(
      `SELECT p.id, p.owner_id, p.title, p.description, p.genre, p.visibility, p.status, p.source_project_id, p.allow_remix, p.updated_at,
              u.username, u.display_name
       FROM ai_projects p JOIN users u ON u.id = p.owner_id WHERE p.id = ? LIMIT 1`,
      [id],
    );
    const project = projectRows[0];
    if (!project) throw new ApiError(404, "PROJECT_NOT_FOUND", "That project is not available.");
    const user = await getCurrentUser();
    const isPublic = project.visibility === "public" && project.status === "published";
    const isModerator = user?.role === "admin" || user?.role === "moderator";
    if (!isPublic && user?.id !== project.owner_id && !isModerator) throw new ApiError(404, "PROJECT_NOT_FOUND", "That project is not available.");
    const versions = await query<{
      id: string; version_number: number; prompt_summary: string; provider: string; model: string;
      manifest_json: string; validation_status: string; change_summary: string; created_at: string;
    }>(`SELECT id, version_number, prompt_summary, provider, model, manifest_json, validation_status, change_summary, created_at
       FROM ai_project_versions WHERE project_id = ? ORDER BY version_number DESC LIMIT 1`, [id]);
    let latest = null;
    if (versions[0]) {
      try {
        latest = {
          version: versions[0].version_number,
          promptSummary: project.owner_id === user?.id ? versions[0].prompt_summary : undefined,
          provider: versions[0].provider,
          model: versions[0].model,
          files: JSON.parse(versions[0].manifest_json),
          validationStatus: versions[0].validation_status,
          summary: versions[0].change_summary,
          createdAt: versions[0].created_at,
        };
      } catch {
        throw new ApiError(409, "PROJECT_VERSION_INVALID", "This project version could not be loaded.");
      }
    }
    return Response.json({
      project: {
        id: project.id,
        ownerId: project.owner_id,
        title: project.title,
        description: project.description,
        genre: project.genre,
        visibility: project.visibility,
        status: project.status,
        allowRemix: project.allow_remix === 1,
        sourceProjectId: project.source_project_id,
        creator: { username: project.username, displayName: project.display_name },
        updatedAt: project.updated_at,
        canRemix: isPublic && project.allow_remix === 1 && project.owner_id !== user?.id,
      },
      latest,
    }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    assertSameOrigin(request);
    const user = await requireUser();
    const { id } = await context.params;
    requireUuid(id, "project id");
    const input = await readJson(request, updateSchema);
    const projects = await query<{ visibility: string; status: string }>(`SELECT visibility, status FROM ai_projects WHERE id = ? AND owner_id = ? LIMIT 1`, [id, user.id]);
    if (!projects[0]) throw new ApiError(404, "PROJECT_NOT_FOUND", "That project is not in your account.");
    const project = projects[0];
    if (project.status === "removed") throw new ApiError(409, "CONTENT_REMOVED", "This project was removed by moderation and cannot be relisted.");
    let visibility = project.visibility;
    let status = project.status;
    if (input.visibility === "public" && project.visibility !== "public") {
      visibility = "private";
      status = "pending";
    } else if (input.visibility === "private") {
      visibility = "private";
      status = "draft";
    }
    const allowRemix = input.allowRemix === undefined ? undefined : (input.allowRemix ? 1 : 0);
    const genre = input.genre === undefined ? null : (genres.find((item) => item.toLowerCase() === input.genre!.toLowerCase()) ?? "Experimental");
    await execute(
      `UPDATE ai_projects SET visibility = ?, status = ?, genre = COALESCE(?, genre), allow_remix = COALESCE(?, allow_remix), updated_at = ? WHERE id = ? AND owner_id = ?`,
      [visibility, status, genre, allowRemix ?? null, nowIso(), id, user.id],
    );
    return Response.json({ ok: true, visibility, status, message: input.visibility === "public" ? "Public sharing has been sent to moderation." : undefined }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return errorResponse(error);
  }
}
