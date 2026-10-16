import { z } from "zod";
import { errorResponse } from "@/lib/http";
import { listPublicStoreAssets } from "@/lib/asset-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const filterSchema = z.object({
  category: z.enum(["image", "model", "audio"]).optional(),
  q: z.string().trim().max(80).optional(),
});

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const parsed = filterSchema.safeParse({ category: url.searchParams.get("category") || undefined, q: url.searchParams.get("q") || undefined });
    if (!parsed.success) return Response.json({ error: { code: "INVALID_FILTER", message: "Choose a supported category and a search term under 80 characters." } }, { status: 400, headers: { "Cache-Control": "no-store" } });
    const assets = await listPublicStoreAssets(parsed.data);
    return Response.json({ assets, count: assets.length }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return errorResponse(error);
  }
}
