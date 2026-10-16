import { z, ZodError } from "zod";
import { requireUser } from "@/lib/auth";
import { submitAssetToStore, withdrawAssetFromStore } from "@/lib/asset-store";
import { ApiError, assertSameOrigin, enforceRateLimit, errorResponse, readJson, requireUuid } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const submissionSchema = z.object({
  title: z.string().trim().min(2).max(100),
  description: z.string().trim().max(700).default(""),
  license: z.enum(["cc-by-4.0", "cc-by-sa-4.0", "cc0-1.0"]),
  attribution: z.string().trim().min(2).max(300),
  rightsBasis: z.enum(["created_by_me", "licensed_for_redistribution", "public_domain"]),
  rightsConfirmed: z.literal(true),
  downloadAuthorized: z.literal(true),
});

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    assertSameOrigin(request);
    const user = await requireUser();
    await enforceRateLimit(request, `asset-store-submit:${user.id}`, 10, 60 * 60 * 1000);
    const { id } = await context.params;
    requireUuid(id, "asset id");
    const declaration = await readJson(request, submissionSchema, 8_000);
    const result = await submitAssetToStore(user.id, id, { ...declaration, description: declaration.description ?? "" });
    return Response.json({ ok: true, ...result, message: "Your asset is private while it awaits moderator review. It will not be downloadable from the public store until approved." }, { status: 202, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof ZodError) return errorResponse(new ApiError(400, "INVALID_ASSET_SUBMISSION", "Provide a title, attribution, supported license, rights basis, and both required declarations."));
    return errorResponse(error);
  }
}

export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    assertSameOrigin(request);
    const user = await requireUser();
    await enforceRateLimit(request, `asset-store-withdraw:${user.id}`, 20, 60 * 60 * 1000);
    const { id } = await context.params;
    requireUuid(id, "asset id");
    const result = await withdrawAssetFromStore(user.id, id);
    return Response.json({ ok: true, ...result, message: "The asset was withdrawn from public access. Previously downloaded copies remain subject to their license." }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return errorResponse(error);
  }
}
