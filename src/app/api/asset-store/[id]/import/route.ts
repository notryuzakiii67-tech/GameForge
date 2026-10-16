import { requireUser } from "@/lib/auth";
import { importPublicStoreAsset } from "@/lib/asset-service";
import { assertSameOrigin, enforceRateLimit, errorResponse, requireUuid } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    assertSameOrigin(request);
    const user = await requireUser();
    await enforceRateLimit(request, `asset-store-import:${user.id}`, 20, 60 * 60 * 1000);
    const { id } = await context.params;
    requireUuid(id, "asset id");
    const asset = await importPublicStoreAsset(user.id, id);
    return Response.json({ ok: true, asset, notice: "A private copy was added to your library. Follow the source license and attribution when using or sharing it." }, {
      status: 201,
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    return errorResponse(error);
  }
}
