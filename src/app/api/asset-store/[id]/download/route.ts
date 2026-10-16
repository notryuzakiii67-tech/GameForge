import { createHash } from "node:crypto";
import { getPublicStoreAsset } from "@/lib/asset-store";
import { getObject } from "@/lib/storage";
import { ApiError, errorResponse, requireUuid } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    requireUuid(id, "asset id");
    const asset = await getPublicStoreAsset(id);
    let stored: Awaited<ReturnType<typeof getObject>>;
    try { stored = await getObject(asset.storage_key); }
    catch { throw new ApiError(404, "ASSET_FILE_UNAVAILABLE", "That public asset file is temporarily unavailable."); }
    if (stored.body.byteLength !== Number(asset.size_bytes)) throw new ApiError(409, "ASSET_INTEGRITY_MISMATCH", "The public asset failed its stored-size check.");
    const actualHash = createHash("sha256").update(stored.body).digest("hex");
    if (actualHash !== asset.content_hash) throw new ApiError(409, "ASSET_INTEGRITY_MISMATCH", "The public asset failed its stored-content integrity check.");
    const headers = new Headers({
      "Content-Type": "application/octet-stream",
      "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(asset.original_name)}`,
      "Content-Length": String(asset.size_bytes),
      "Cache-Control": "private, no-store, max-age=0",
      "X-Content-Type-Options": "nosniff",
      "Cross-Origin-Resource-Policy": "same-origin",
      "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'; sandbox",
      "Referrer-Policy": "no-referrer",
    });
    return new Response(stored.body as BodyInit, { headers });
  } catch (error) {
    return errorResponse(error);
  }
}
