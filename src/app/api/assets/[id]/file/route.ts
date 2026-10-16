import { createHash } from "node:crypto";
import { requireUser } from "@/lib/auth";
import { getPrivateAsset } from "@/lib/asset-service";
import { getObject } from "@/lib/storage";
import { ApiError, errorResponse, requireUuid } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser();
    const { id } = await context.params;
    requireUuid(id, "asset id");
    const asset = await getPrivateAsset(user.id, id);
    if (asset.sizeBytes <= 0) throw new ApiError(404, "ASSET_NOT_FOUND", "That private asset could not be found.");
    const stored = await getObject(asset.storageKey);
    if (stored.body.byteLength !== asset.sizeBytes) throw new ApiError(409, "ASSET_STORAGE_MISMATCH", "The private asset failed its stored-size check.");
    const actualHash = createHash("sha256").update(stored.body).digest("hex");
    if (actualHash !== asset.contentHash) throw new ApiError(409, "ASSET_INTEGRITY_MISMATCH", "The private asset failed its stored-content integrity check.");
    const headers = new Headers({
      "Content-Type": asset.mimeType,
      "Content-Disposition": `inline; filename*=UTF-8''${encodeURIComponent(asset.filename)}`,
      "Content-Length": String(asset.sizeBytes),
      "Cache-Control": "private, no-store, max-age=0",
      "X-Content-Type-Options": "nosniff",
      "Cross-Origin-Resource-Policy": "same-origin",
      "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'; sandbox",
    });
    return new Response(stored.body as BodyInit, { headers });
  } catch (error) {
    return errorResponse(error);
  }
}
