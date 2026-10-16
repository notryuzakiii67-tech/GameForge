import { z } from "zod";
import { requireAdmin } from "@/lib/auth";
import { execute, query, nowIso } from "@/lib/db";
import { takeDownReportedContent } from "@/lib/moderation";
import { ApiError, assertSameOrigin, errorResponse, logAudit, readJson, requireUuid } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const schema = z.object({
  decision: z.enum(["actioned", "dismissed"]),
  note: z.string().trim().max(500).default(""),
  takeDown: z.boolean().default(false),
});

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    assertSameOrigin(request);
    const actor = await requireAdmin();
    const { id } = await context.params;
    requireUuid(id, "report id");
    const input = await readJson(request, schema);
    if (input.takeDown && input.decision !== "actioned") {
      throw new ApiError(400, "INVALID_MODERATION_ACTION", "Content can only be taken down as part of an actioned report.");
    }
    if (input.takeDown && !(input.note ?? "").trim()) {
      throw new ApiError(400, "MODERATION_NOTE_REQUIRED", "Add a moderation note before taking content down.");
    }
    const reports = await query<{ id: string; target_type: string; target_id: string }>(
      `SELECT id, target_type, target_id FROM reports WHERE id = ? AND status = 'open' LIMIT 1`, [id]);
    const report = reports[0];
    if (!report) throw new ApiError(404, "REPORT_NOT_FOUND", "That report is already closed or unavailable.");

    const timestamp = nowIso();
    const removedTargets = input.takeDown
      ? await takeDownReportedContent(report.target_type, report.target_id, timestamp, actor.id, input.note ?? "")
      : [];
    const updated = await execute(
      `UPDATE reports SET status = ?, reviewed_at = ?, reviewer_id = ? WHERE id = ? AND status = 'open'`,
      [input.decision, timestamp, actor.id, id],
    );
    if (!updated) throw new ApiError(409, "REPORT_ALREADY_REVIEWED", "Another moderator closed this report first.");
    await logAudit(actor.id, `report.${input.decision}`, "report", id, {
      note: (input.note ?? "").slice(0, 300),
      takeDown: input.takeDown,
      removedTargets,
    });
    return Response.json({ ok: true, status: input.decision, removedTargets }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return errorResponse(error);
  }
}
