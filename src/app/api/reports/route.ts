import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { execute, query, newId, nowIso } from "@/lib/db";
import { ApiError, assertSameOrigin, enforceRateLimit, errorResponse, readJson, requireUuid } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const schema = z.object({ targetType: z.enum(["game", "ai_project", "user"]), targetId: z.string().uuid(), reason: z.enum(["copyright", "unsafe", "spam", "harassment", "other"]), details: z.string().trim().max(1000).default("") });

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const user = await requireUser();
    await enforceRateLimit(request, `report:${user.id}`, 6, 60 * 60 * 1000);
    const input = await readJson(request, schema);
    requireUuid(input.targetId, "report target");
    const targetTable = input.targetType === "game" ? "games" : input.targetType === "ai_project" ? "ai_projects" : "users";
    const rows = await query<{ id: string }>(`SELECT id FROM ${targetTable} WHERE id = ? LIMIT 1`, [input.targetId]);
    if (!rows.length) throw new ApiError(404, "REPORT_TARGET_NOT_FOUND", "That content is no longer available.");
    const duplicate = await query<{ id: string }>(`SELECT id FROM reports WHERE reporter_id = ? AND target_type = ? AND target_id = ? AND status = 'open' LIMIT 1`, [user.id, input.targetType, input.targetId]);
    if (duplicate.length) throw new ApiError(409, "REPORT_ALREADY_OPEN", "You already have an open report for this item.");
    await execute(
      `INSERT INTO reports(id, reporter_id, target_type, target_id, reason, details, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, 'open', ?)`,
      [newId(), user.id, input.targetType, input.targetId, input.reason, input.details ?? "", nowIso()],
    );
    return Response.json({ ok: true, message: "Thank you. The moderation team has received your report." }, { status: 201, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return errorResponse(error);
  }
}
