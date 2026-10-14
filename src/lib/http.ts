import { NextResponse } from "next/server";
import { z } from "zod";
import { DatabaseConfigurationError, execute, query, type DbValue, newId, nowIso } from "@/lib/db";

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly extra?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export function errorResponse(error: unknown): NextResponse {
  if (error instanceof DatabaseConfigurationError) {
    return NextResponse.json(
      { error: { code: "DATABASE_NOT_CONFIGURED", message: "GameForge’s production database is not configured. Please contact the site operator." } },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
  if (error instanceof ApiError) {
    return NextResponse.json(
      { error: { code: error.code, message: error.message, ...(error.extra ?? {}) } },
      { status: error.status },
    );
  }
  const requestId = crypto.randomUUID();
  console.error(JSON.stringify({ level: "error", scope: "api", requestId, errorType: error instanceof Error ? error.name : "UnknownError" }));
  return NextResponse.json(
    { error: { code: "INTERNAL_ERROR", message: "Something went wrong. Please try again." }, requestId },
    { status: 500 },
  );
}

export function zodError(error: z.ZodError): ApiError {
  return new ApiError(400, "INVALID_INPUT", "Please check the highlighted fields.", {
    fields: error.issues.map((issue) => ({ path: issue.path.join("."), message: issue.message })),
  });
}

export async function readJson<T>(request: Request, schema: z.ZodType<T>, maxBytes = 96_000): Promise<T> {
  const length = Number(request.headers.get("content-length") ?? 0);
  if (length > maxBytes) throw new ApiError(413, "REQUEST_TOO_LARGE", "This request is larger than the allowed limit.");
  if (!request.body) throw new ApiError(400, "INVALID_JSON", "The request body must be valid JSON.");
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        throw new ApiError(413, "REQUEST_TOO_LARGE", "This request is larger than the allowed limit.");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  let body: unknown;
  try {
    body = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw new ApiError(400, "INVALID_JSON", "The request body must be valid JSON.");
  }
  const result = schema.safeParse(body);
  if (!result.success) throw zodError(result.error);
  return result.data;
}

function forwardedRequestOrigin(request: Request): string | null {
  const host = (request.headers.get("x-forwarded-host") ?? request.headers.get("host"))?.split(",")[0]?.trim();
  if (!host || /[\s/@]/.test(host)) return null;
  const forwardedProto = request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim();
  const fallbackProto = new URL(request.url).protocol.slice(0, -1);
  const protocol = forwardedProto || fallbackProto;
  if (protocol !== "http" && protocol !== "https") return null;
  try { return new URL(`${protocol}://${host}`).origin; } catch { return null; }
}

export function assertSameOrigin(request: Request): void {
  const origin = request.headers.get("origin") ?? request.headers.get("referer");
  if (!origin) throw new ApiError(403, "ORIGIN_REQUIRED", "This request must include a same-origin browser source.");
  let expected: string;
  try {
    expected = process.env.NEXT_PUBLIC_SITE_URL ? new URL(process.env.NEXT_PUBLIC_SITE_URL).origin : new URL(request.url).origin;
  } catch {
    throw new ApiError(503, "SITE_ORIGIN_NOT_CONFIGURED", "The GameForge site URL is not configured correctly.");
  }
  let suppliedOrigin: string;
  try { suppliedOrigin = new URL(origin).origin; } catch {
    throw new ApiError(403, "ORIGIN_NOT_ALLOWED", "This request did not come from the GameForge site.");
  }
  if (suppliedOrigin !== expected) {
    // Local and Arena preview requests arrive through a reverse proxy whose public host
    // differs from the dev server's bind address. Production uses its explicit canonical URL.
    if (process.env.NODE_ENV !== "production" && suppliedOrigin === forwardedRequestOrigin(request)) return;
    throw new ApiError(403, "ORIGIN_NOT_ALLOWED", "This request did not come from the GameForge site.");
  }
}

export function clientAddress(request: Request): string {
  const forwarded = request.headers.get("x-vercel-forwarded-for") ?? request.headers.get("x-forwarded-for");
  const address = forwarded?.split(",")[0]?.trim();
  return address?.slice(0, 72) || "unknown";
}

export async function enforceRateLimit(
  request: Request,
  bucket: string,
  limit: number,
  windowMs: number,
): Promise<void> {
  const key = `${bucket}:${clientAddress(request)}`.slice(0, 180);
  const now = Date.now();
  const nowIsoValue = new Date(now).toISOString();
  const resetIso = new Date(now + windowMs).toISOString();
  const rows = await query<{ count: number; reset_at: string }>(
    `INSERT INTO rate_limits(bucket_key, count, reset_at) VALUES (?, 1, ?)
     ON CONFLICT(bucket_key) DO UPDATE SET
       count = CASE WHEN rate_limits.reset_at <= ? THEN 1 ELSE rate_limits.count + 1 END,
       reset_at = CASE WHEN rate_limits.reset_at <= ? THEN excluded.reset_at ELSE rate_limits.reset_at END
     RETURNING count, reset_at`,
    [key, resetIso, nowIsoValue, nowIsoValue],
  );
  if (Number(rows[0]?.count ?? 0) > limit) {
    const retryAfter = Math.max(1, Math.ceil((Date.parse(rows[0].reset_at) - now) / 1000));
    throw new ApiError(429, "RATE_LIMITED", "You’re doing that a little too quickly. Try again shortly.", { retryAfter });
  }
}

export async function logAudit(
  actorId: string | null,
  eventType: string,
  targetType?: string,
  targetId?: string,
  details: Record<string, unknown> = {},
): Promise<void> {
  await execute(
    `INSERT INTO audit_events(id, actor_id, event_type, target_type, target_id, details_json, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [newId(), actorId, eventType, targetType ?? null, targetId ?? null, JSON.stringify(details), nowIso()],
  );
}

export function requireUuid(value: string, label = "id"): string {
  if (!/^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(value)) throw new ApiError(400, "INVALID_ID", `The ${label} is not valid.`);
  return value;
}

export function asDbValues(values: unknown[]): DbValue[] {
  return values.map((value) => (value === undefined ? null : (value as DbValue)));
}
