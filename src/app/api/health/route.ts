import { ensureDatabase, query } from "@/lib/db";
import { isLocalStorage } from "@/lib/storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await ensureDatabase();
    await query(`SELECT 1 AS healthy`);
    const configuredStorage = isLocalStorage() || Boolean(process.env.S3_BUCKET && process.env.S3_REGION && process.env.S3_ACCESS_KEY_ID && process.env.S3_SECRET_ACCESS_KEY);
    const configuredGameOrigin = process.env.NODE_ENV !== "production" || Boolean(process.env.GAME_CONTENT_ORIGIN);
    const ready = process.env.NODE_ENV !== "production" || (Boolean(process.env.DATABASE_URL?.startsWith("postgres://") || process.env.DATABASE_URL?.startsWith("postgresql://")) && configuredStorage && configuredGameOrigin);
    return Response.json({
      status: ready ? "ok" : "degraded",
      service: "gameforge-web",
      checks: { database: "ok", objectStorage: configuredStorage ? "configured" : "not-configured", gameContentOrigin: configuredGameOrigin ? "configured" : "not-configured" },
      timestamp: new Date().toISOString(),
    }, { status: ready ? 200 : 503, headers: { "Cache-Control": "no-store" } });
  } catch {
    return Response.json({
      status: "unavailable",
      service: "gameforge-web",
      checks: { database: "unavailable" },
      timestamp: new Date().toISOString(),
    }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
