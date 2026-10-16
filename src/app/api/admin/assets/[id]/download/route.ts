import { createHash } from "node:crypto";
import { requireAdmin } from "@/lib/auth";
import { query } from "@/lib/db";
import { getObject } from "@/lib/storage";
import { ApiError, errorResponse, requireUuid } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    await requireAdmin();
    const { id } = await context.params;
    requireUuid(id, "asset id");
    const rows = await query<{ filename: string; storage_key: string; size_bytes: number; content_hash: string }>(
      `SELECT original_name AS filename, storage_key, size_bytes, content_hash FROM assets
       WHERE id = ? AND upload_status = 'ready' AND publication_status IN ('pending_review', 'published', 'rejected', 'removed') AND deleted_at IS NULL LIMIT 1`, [id]);
    const asset = rows[0];
    if (!asset) throw new ApiError(404, "ASSET_NOT_AVAILABLE_FOR_REVIEW", "This asset is not available to moderators for review.");
    let stored: Awaited<ReturnType<typeof getObject>>;
    try { stored = await getObject(asset.storage_key); }
    catch { throw new ApiError(404, "ASSET_FILE_UNAVAILABLE", "The submitted asset file is temporarily unavailable."); }
    if (stored.body.byteLength !== Number(asset.size_bytes) || createHash("sha256").update(stored.body).digest("hex") !== asset.content_hash) {
      throw new ApiError(409, "ASSET_INTEGRITY_MISMATCH", "The submitted asset failed its stored-content integrity check.");
    }
    return new Response(stored.body as BodyInit, { headers: {
      "Content-Type": "application/octet-stream",
      "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(asset.filename)}`,
      "Content-Length": String(asset.size_bytes),
      "Cache-Control": "private, no-store, max-age=0",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'; sandbox",
      "Referrer-Policy": "no-referrer",
    } });
  } catch (error) {
    return errorResponse(error);
  }
}
