import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { changeProjectAssetBindings } from "@/lib/project-assets";
import { ApiError, assertSameOrigin, enforceRateLimit, errorResponse, readJson, requireUuid } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const unbindSchema = z.object({ version: z.number().int().positive() });

export async function DELETE(request: Request, context: { params: Promise<{ id: string; assetId: string }> }) {
  try {
    assertSameOrigin(request);
    const user = await requireUser();
    await enforceRateLimit(request, `project-asset-unbind:${user.id}`, 40, 60 * 60 * 1000);
    const { id, assetId } = await context.params;
    requireUuid(id, "project id");
    requireUuid(assetId, "asset id");
    const input = await readJson(request, unbindSchema, 4_000);
    const result = await changeProjectAssetBindings(user.id, id, input.version, [assetId], "unbind");
    return Response.json({ ...result, message: result.changed ? `Asset unbound in new version ${result.version}.` : "That asset was not bound to the current version." }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return errorResponse(error);
  }
}
