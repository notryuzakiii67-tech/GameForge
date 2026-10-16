import { z, ZodError } from "zod";
import { requireUser } from "@/lib/auth";
import { createAssetUploadIntent, listPrivateAssets } from "@/lib/asset-service";
import { ApiError, assertSameOrigin, enforceRateLimit, errorResponse, readJson } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const intentSchema = z.object({ filename: z.string().trim().min(1).max(255), size: z.number().int().positive() });

export async function GET() {
  try {
    const user = await requireUser();
    const assets = await listPrivateAssets(user.id);
    return Response.json({ assets }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const user = await requireUser();
    await enforceRateLimit(request, `asset-upload-intent:${user.id}`, 20, 60 * 60 * 1000);
    const input = await readJson(request, intentSchema, 8_000);
    const upload = await createAssetUploadIntent(user.id, input.filename, input.size);
    return Response.json(upload, { status: 201, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof ZodError) return errorResponse(new ApiError(400, "INVALID_ASSET", "Choose a supported file and provide its exact size."));
    return errorResponse(error);
  }
}
