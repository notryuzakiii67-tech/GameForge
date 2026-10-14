import { getCurrentUser } from "@/lib/auth";
import { query } from "@/lib/db";
import { ApiError, errorResponse, requireUuid } from "@/lib/http";
import { gameResponseHeaders, getObject } from "@/lib/storage";
import { safeProjectPath } from "@/lib/zip";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request, context: { params: Promise<{ gameId: string; version: string; filePath: string[] }> }) {
  try {
    const { gameId, version: rawVersion, filePath: parts } = await context.params;
    requireUuid(gameId, "game id");
    const version = Number(rawVersion);
    if (!Number.isInteger(version) || version < 1 || version > 10_000) throw new ApiError(404, "BUILD_NOT_FOUND", "This game build could not be found.");
    const filePath = safeProjectPath(parts.join("/"));
    const rows = await query<{
      developer_id: string; status: string; visibility: string; storage_key: string; validation_status: string;
    }>(
      `SELECT g.developer_id, g.status, g.visibility, v.storage_key, v.validation_status
       FROM games g JOIN game_versions v ON v.game_id = g.id
       WHERE g.id = ? AND v.version_number = ? LIMIT 1`,
      [gameId, version],
    );
    const record = rows[0];
    if (!record || record.validation_status !== "validated" || record.status === "removed") {
      throw new ApiError(404, "BUILD_NOT_FOUND", "This game build could not be found.");
    }
    const publicBuild = record.status === "published" && record.visibility === "public";
    if (!publicBuild) {
      const configuredOrigin = process.env.GAME_CONTENT_ORIGIN;
      const requestHost = new URL(request.url).host;
      if (configuredOrigin && new URL(configuredOrigin).host === requestHost) throw new ApiError(404, "BUILD_NOT_FOUND", "This game build could not be found.");
      const user = await getCurrentUser();
      if (!user || (user.id !== record.developer_id && user.role !== "admin" && user.role !== "moderator")) {
        throw new ApiError(404, "BUILD_NOT_FOUND", "This game build could not be found.");
      }
    }
    const stored = await getObject(`${record.storage_key}/${filePath}`);
    const headers = gameResponseHeaders(filePath, stored.contentType);
    if (!publicBuild) headers.set("Cache-Control", "private, no-store");
    return new Response(stored.body as BodyInit, { headers });
  } catch (error) {
    return errorResponse(error);
  }
}
