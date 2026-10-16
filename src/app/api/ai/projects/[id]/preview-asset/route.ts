import { createHash } from "node:crypto";
import { ApiError, errorResponse, requireUuid } from "@/lib/http";
import { getBoundProjectAssetForPreview, resolveProjectPreviewGrant } from "@/lib/project-assets";
import { getObject } from "@/lib/storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    requireUuid(id, "project id");
    const url = new URL(request.url);
    const version = Number(url.searchParams.get("version"));
    const token = url.searchParams.get("token") ?? "";
    const assetId = requireUuid(url.searchParams.get("asset") ?? "", "asset id").toLowerCase();
    if (!Number.isInteger(version) || version < 1) throw new ApiError(404, "VERSION_NOT_FOUND", "That project version could not be found.");
    const grant = await resolveProjectPreviewGrant(id, version, token);
    const asset = await getBoundProjectAssetForPreview(grant.ownerId, id, version, assetId);
    const stored = await getObject(asset.storageKey);
    if (stored.body.byteLength !== asset.sizeBytes) throw new ApiError(409, "ASSET_STORAGE_MISMATCH", "The private project asset failed its stored-size check.");
    const actualHash = createHash("sha256").update(stored.body).digest("hex");
    if (actualHash !== asset.contentHash) throw new ApiError(409, "ASSET_INTEGRITY_MISMATCH", "The private project asset failed its stored-content integrity check.");
    const headers = new Headers({
      "Content-Type": asset.mimeType,
      "Content-Disposition": `inline; filename*=UTF-8''${encodeURIComponent(asset.filename)}`,
      "Content-Length": String(asset.sizeBytes),
      "Cache-Control": "private, no-store, max-age=0",
      "X-Content-Type-Options": "nosniff",
      "Cross-Origin-Resource-Policy": "cross-origin",
      "Access-Control-Allow-Origin": "*",
      "Referrer-Policy": "no-referrer",
      "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'; sandbox",
    });
    return new Response(stored.body as BodyInit, { headers });
  } catch (error) {
    return errorResponse(error);
  }
}
