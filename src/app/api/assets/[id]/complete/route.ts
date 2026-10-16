import { requireUser } from "@/lib/auth";
import { completePrivateAssetUpload } from "@/lib/asset-service";
import { ApiError, assertSameOrigin, enforceRateLimit, errorResponse, requireUuid } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    assertSameOrigin(request);
    const user = await requireUser();
    await enforceRateLimit(request, `asset-upload-complete:${user.id}`, 40, 60 * 60 * 1000);
    const { id } = await context.params;
    requireUuid(id, "asset upload id");
    const asset = await completePrivateAssetUpload(user.id, id);
    return Response.json({ asset }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return errorResponse(error);
  }
}
