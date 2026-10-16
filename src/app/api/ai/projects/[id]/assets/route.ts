import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { changeProjectAssetBindings, getProjectAssetBindings } from "@/lib/project-assets";
import { ApiError, assertSameOrigin, enforceRateLimit, errorResponse, readJson, requireUuid } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bindSchema = z.object({
  version: z.number().int().positive(),
  assetIds: z.array(z.string().uuid()).min(1).max(6).refine((ids) => new Set(ids).size === ids.length, "Asset selections must be unique."),
});

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser();
    const { id } = await context.params;
    requireUuid(id, "project id");
    const rawVersion = new URL(request.url).searchParams.get("version");
    const version = rawVersion === null ? undefined : Number(rawVersion);
    if (rawVersion !== null && (!Number.isInteger(version) || (version ?? 0) < 1)) {
      throw new ApiError(400, "INVALID_VERSION", "The project version is not valid.");
    }
    const result = await getProjectAssetBindings(user.id, id, version);
    return Response.json(result, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    assertSameOrigin(request);
    const user = await requireUser();
    await enforceRateLimit(request, `project-asset-bind:${user.id}`, 40, 60 * 60 * 1000);
    const { id } = await context.params;
    requireUuid(id, "project id");
    const input = await readJson(request, bindSchema, 8_000);
    const result = await changeProjectAssetBindings(user.id, id, input.version, input.assetIds, "bind");
    return Response.json({ ...result, message: result.changed ? `Assets bound in new version ${result.version}.` : "Those assets are already bound to this version." }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return errorResponse(error);
  }
}
