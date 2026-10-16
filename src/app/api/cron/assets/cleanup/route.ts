import { timingSafeEqual } from "node:crypto";
import { cleanupExpiredAssetUploads } from "@/lib/asset-service";
import { ApiError, errorResponse } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function runCleanup(request: Request) {
  try {
    const secret = process.env.CRON_SECRET;
    if (!secret || secret.length < 32) throw new ApiError(503, "ASSET_CLEANUP_NOT_CONFIGURED", "Set a strong CRON_SECRET before scheduling asset cleanup.");
    const supplied = request.headers.get("authorization") ?? "";
    const expected = `Bearer ${secret}`;
    const suppliedBytes = Buffer.from(supplied);
    const expectedBytes = Buffer.from(expected);
    if (suppliedBytes.length !== expectedBytes.length || !timingSafeEqual(suppliedBytes, expectedBytes)) {
      throw new ApiError(401, "UNAUTHORIZED", "A valid cleanup authorization header is required.");
    }
    const rawLimit = Number(new URL(request.url).searchParams.get("limit") ?? 100);
    const limit = Number.isFinite(rawLimit) ? Math.max(1, Math.min(100, Math.floor(rawLimit))) : 100;
    const result = await cleanupExpiredAssetUploads(limit);
    return Response.json({ ok: true, ...result }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function GET(request: Request) { return runCleanup(request); }
export async function POST(request: Request) { return runCleanup(request); }
