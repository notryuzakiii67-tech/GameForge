import { requireUser } from "@/lib/auth";
import { uploadLocalAssetBytes } from "@/lib/asset-service";
import { maxAssetBytes } from "@/lib/asset-validation";
import { ApiError, assertSameOrigin, enforceRateLimit, errorResponse, requireUuid } from "@/lib/http";
import { isLocalStorage } from "@/lib/storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

async function readBytes(request: Request): Promise<Uint8Array> {
  const declaredLength = Number(request.headers.get("content-length") ?? 0);
  if (declaredLength > maxAssetBytes()) throw new ApiError(413, "ASSET_TOO_LARGE", `Individual assets are limited to ${Math.floor(maxAssetBytes() / 1024 / 1024)} MiB.`);
  if (!request.body) throw new ApiError(400, "EMPTY_UPLOAD", "The asset upload body is empty.");
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxAssetBytes()) {
        await reader.cancel();
        throw new ApiError(413, "ASSET_TOO_LARGE", `Individual assets are limited to ${Math.floor(maxAssetBytes() / 1024 / 1024)} MiB.`);
      }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return bytes;
}

export async function PUT(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    assertSameOrigin(request);
    const user = await requireUser();
    if (!isLocalStorage()) throw new ApiError(409, "DIRECT_UPLOAD_REQUIRED", "Production assets must be uploaded through the short-lived private storage URL.");
    await enforceRateLimit(request, `asset-upload:${user.id}`, 20, 60 * 60 * 1000);
    const { id } = await context.params;
    requireUuid(id, "asset upload id");
    const bytes = await readBytes(request);
    const asset = await uploadLocalAssetBytes(user.id, id, bytes);
    return Response.json({ asset }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return errorResponse(error);
  }
}
