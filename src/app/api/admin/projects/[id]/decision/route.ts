import { z } from "zod";
import { requireAdmin } from "@/lib/auth";
import { validateAiProject } from "@/lib/ai/validate";
import { execute, query, nowIso } from "@/lib/db";
import { ApiError, assertSameOrigin, errorResponse, logAudit, readJson, requireUuid } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const schema = z.object({ decision: z.enum(["approve", "reject"]), reason: z.string().trim().max(500).default("") });

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    assertSameOrigin(request);
    const actor = await requireAdmin();
    const { id } = await context.params;
    requireUuid(id, "project id");
    const input = await readJson(request, schema);
    const rows = await query<{ id: string }>(`SELECT id FROM ai_projects WHERE id = ? AND status = 'pending' AND visibility = 'private' LIMIT 1`, [id]);
    if (!rows.length) throw new ApiError(404, "SUBMISSION_NOT_FOUND", "This project is no longer awaiting review.");
    const versions = await query<{ manifest_json: string }>(`SELECT manifest_json FROM ai_project_versions WHERE project_id = ? ORDER BY version_number DESC LIMIT 1`, [id]);
    if (!versions[0]) throw new ApiError(409, "PROJECT_VERSION_REQUIRED", "This project has no version to review.");
    try {
      validateAiProject(JSON.parse(versions[0].manifest_json));
    } catch {
      throw new ApiError(409, "PROJECT_INVALID", "This project version no longer passes validation.");
    }
    const status = input.decision === "approve" ? "published" : "draft";
    const visibility = input.decision === "approve" ? "public" : "private";
    await execute(`UPDATE ai_projects SET status = ?, visibility = ?, updated_at = ? WHERE id = ?`, [status, visibility, nowIso(), id]);
    await logAudit(actor.id, `ai-project.${input.decision}`, "ai_project", id, { reason: (input.reason ?? "").slice(0, 300) });
    return Response.json({ ok: true, status, visibility }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return errorResponse(error);
  }
}
