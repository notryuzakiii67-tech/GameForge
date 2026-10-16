import { requireUser } from "@/lib/auth";
import { deletePrivateAsset } from "@/lib/asset-service";
import { ApiError, assertSameOrigin, enforceRateLimit, errorResponse, requireUuid } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    assertSameOrigin(request);
    const user = await requireUser();
    await enforceRateLimit(request, `asset-delete:${user.id}`, 30, 60 * 60 * 1000);
    const { id } = await context.params;
    requireUuid(id, "asset id");
    const deletion = await deletePrivateAsset(user.id, id);
    return Response.json({ ok: true, storageCleanupPending: deletion.storageCleanupPending }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return errorResponse(error);
  }
}
