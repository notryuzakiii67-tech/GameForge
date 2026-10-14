import { requireUser } from "@/lib/auth";
import { query } from "@/lib/db";
import { ApiError, errorResponse, requireUuid } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser();
    const { id } = await context.params;
    requireUuid(id, "project id");
    const owned = await query<{ id: string }>(`SELECT id FROM ai_projects WHERE id = ? AND owner_id = ?`, [id, user.id]);
    if (!owned.length) throw new ApiError(404, "PROJECT_NOT_FOUND", "That project is not in your account.");
    const versions = await query<{ version_number: number; prompt_summary: string; provider: string; model: string; validation_status: string; change_summary: string; created_at: string }>(
      `SELECT version_number, prompt_summary, provider, model, validation_status, change_summary, created_at
       FROM ai_project_versions WHERE project_id = ? ORDER BY version_number DESC LIMIT 100`, [id]);
    return Response.json({ versions: versions.map((version) => ({
      version: version.version_number,
      prompt: version.prompt_summary,
      provider: version.provider,
      model: version.model,
      validationStatus: version.validation_status,
      summary: version.change_summary,
      createdAt: version.created_at,
    })) }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return errorResponse(error);
  }
}
