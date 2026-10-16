import "server-only";
import { DeleteObjectCommand, GetObjectCommand, HeadObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { mkdir, readFile, stat, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { ApiError } from "@/lib/http";
import { safeProjectPath } from "@/lib/zip";

export type StoredObject = { body: Uint8Array; contentType: string | undefined };

let s3Client: S3Client | undefined;

function s3Configuration() {
  const bucket = process.env.S3_BUCKET;
  const region = process.env.S3_REGION;
  const accessKeyId = process.env.S3_ACCESS_KEY_ID;
  const secretAccessKey = process.env.S3_SECRET_ACCESS_KEY;
  return bucket && region && accessKeyId && secretAccessKey
    ? { bucket, region, accessKeyId, secretAccessKey, endpoint: process.env.S3_ENDPOINT }
    : null;
}

function client(): S3Client {
  const config = s3Configuration();
  if (!config) throw new ApiError(503, "STORAGE_NOT_CONFIGURED", "Publishing needs S3-compatible object storage. Configure the storage variables in deployment settings.");
  s3Client ??= new S3Client({
    region: config.region,
    endpoint: config.endpoint || undefined,
    forcePathStyle: Boolean(config.endpoint),
    credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey },
    maxAttempts: 2,
  });
  return s3Client;
}

export function isLocalStorage(): boolean {
  return process.env.NODE_ENV !== "production" && !s3Configuration();
}

export function assertStorageReadyForPublishing(): void {
  if (isLocalStorage()) return;
  client();
  const contentOrigin = process.env.GAME_CONTENT_ORIGIN;
  if (!contentOrigin) {
    throw new ApiError(503, "GAME_ORIGIN_NOT_CONFIGURED", "Publishing needs a dedicated GAME_CONTENT_ORIGIN so user-uploaded code is isolated from the GameForge app.");
  }
  let parsed: URL;
  try {
    parsed = new URL(contentOrigin);
  } catch {
    throw new ApiError(503, "GAME_ORIGIN_NOT_CONFIGURED", "GAME_CONTENT_ORIGIN must be an HTTPS origin dedicated to game content.");
  }
  let appOrigin: string | null = null;
  try { appOrigin = process.env.NEXT_PUBLIC_SITE_URL ? new URL(process.env.NEXT_PUBLIC_SITE_URL).origin : null; } catch { /* The app URL is reported as unconfigured below. */ }
  if (parsed.protocol !== "https:" || parsed.pathname !== "/" || parsed.search || parsed.hash || !appOrigin || parsed.origin === appOrigin) {
    throw new ApiError(503, "GAME_ORIGIN_NOT_CONFIGURED", "Set NEXT_PUBLIC_SITE_URL and configure GAME_CONTENT_ORIGIN as a separate HTTPS origin from the GameForge app.");
  }
}

function localFilePath(key: string): string {
  const safeKey = safeProjectPath(key);
  const root = path.resolve(/*turbopackIgnore: true*/ process.cwd(), process.env.LOCAL_STORAGE_DIR || ".gameforge-local/storage");
  const resolved = path.resolve(/*turbopackIgnore: true*/ root, safeKey);
  if (!resolved.startsWith(`${root}${path.sep}`)) throw new ApiError(400, "UNSAFE_PATH", "The storage path is invalid.");
  return resolved;
}

export function localStoragePathForKey(key: string): string {
  return localFilePath(key);
}

export function s3ClientForAssetStorage(): S3Client {
  return client();
}

export function s3BucketForAssetStorage(): string {
  const config = s3Configuration();
  if (!config) throw new ApiError(503, "STORAGE_NOT_CONFIGURED", "Private asset storage is not configured.");
  return config.bucket;
}

export async function putObject(key: string, body: Uint8Array, contentType: string, cacheControl = "public, max-age=31536000, immutable"): Promise<void> {
  const safeKey = safeProjectPath(key);
  if (isLocalStorage()) {
    const filePath = localFilePath(safeKey);
    await mkdir(path.dirname(filePath), { recursive: true });
    await writeFile(filePath, body);
    return;
  }
  const config = s3Configuration();
  if (!config) throw new ApiError(503, "STORAGE_NOT_CONFIGURED", "S3-compatible storage is not configured.");
  await client().send(new PutObjectCommand({
    Bucket: config.bucket,
    Key: safeKey,
    Body: body,
    ContentType: contentType,
    CacheControl: cacheControl,
  }));
}

export async function getObject(key: string): Promise<StoredObject> {
  const safeKey = safeProjectPath(key);
  if (isLocalStorage()) {
    try {
      const body = await readFile(localFilePath(safeKey));
      return { body: new Uint8Array(body), contentType: undefined };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") throw new ApiError(404, "BUILD_FILE_NOT_FOUND", "This game file could not be found.");
      throw error;
    }
  }
  const config = s3Configuration();
  if (!config) throw new ApiError(503, "STORAGE_NOT_CONFIGURED", "S3-compatible storage is not configured.");
  try {
    const result = await client().send(new GetObjectCommand({ Bucket: config.bucket, Key: safeKey }));
    if (!result.Body) throw new ApiError(404, "BUILD_FILE_NOT_FOUND", "This game file could not be found.");
    const body = await result.Body.transformToByteArray();
    return { body, contentType: result.ContentType };
  } catch (error) {
    if (error instanceof ApiError) throw error;
    if (error && typeof error === "object" && "name" in error && error.name === "NoSuchKey") {
      throw new ApiError(404, "BUILD_FILE_NOT_FOUND", "This game file could not be found.");
    }
    throw error;
  }
}

const MIME_TYPES: Record<string, string> = {
  html: "text/html; charset=utf-8", htm: "text/html; charset=utf-8", css: "text/css; charset=utf-8",
  js: "text/javascript; charset=utf-8", mjs: "text/javascript; charset=utf-8", cjs: "text/javascript; charset=utf-8",
  json: "application/json; charset=utf-8", map: "application/json; charset=utf-8", txt: "text/plain; charset=utf-8",
  xml: "application/xml; charset=utf-8", webmanifest: "application/manifest+json; charset=utf-8",
  png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp", avif: "image/avif", bmp: "image/bmp", ico: "image/x-icon", svg: "image/svg+xml",
  mp3: "audio/mpeg", wav: "audio/wav", ogg: "audio/ogg", oga: "audio/ogg", m4a: "audio/mp4", aac: "audio/aac", mp4: "video/mp4", webm: "video/webm", ogv: "video/ogg",
  woff: "font/woff", woff2: "font/woff2", ttf: "font/ttf", otf: "font/otf", eot: "application/vnd.ms-fontobject",
  wasm: "application/wasm", data: "application/octet-stream", pck: "application/octet-stream", unityweb: "application/octet-stream", bin: "application/octet-stream", dat: "application/octet-stream", asset: "application/octet-stream", gz: "application/gzip", br: "application/octet-stream",
};

export function contentTypeForPath(filePath: string, storedContentType?: string): string {
  if (storedContentType && /^[a-z0-9.+-]+\/[a-z0-9.+-]+(?:;\s*charset=utf-8)?$/i.test(storedContentType)) return storedContentType;
  const extension = filePath.split(".").at(-1)?.toLowerCase() ?? "";
  return MIME_TYPES[extension] ?? "application/octet-stream";
}

export function gameContentOrigin(requestUrl?: string): string {
  if (process.env.GAME_CONTENT_ORIGIN) return process.env.GAME_CONTENT_ORIGIN.replace(/\/$/, "");
  return requestUrl ? new URL(requestUrl).origin : "";
}

export function gameFileUrl(gameId: string, version: number, entryPoint: string, requestUrl?: string): string {
  const origin = gameContentOrigin(requestUrl);
  const encodedPath = entryPoint.split("/").map(encodeURIComponent).join("/");
  return `${origin}/api/builds/${encodeURIComponent(gameId)}/${version}/${encodedPath}`;
}

export function gameResponseHeaders(filePath: string, storedContentType?: string): Headers {
  const headers = new Headers({
    "Content-Type": contentTypeForPath(filePath, storedContentType),
    "X-Content-Type-Options": "nosniff",
    "Cross-Origin-Resource-Policy": "cross-origin",
    "Cache-Control": "public, max-age=31536000, immutable",
  });
  if (/\.html?$/i.test(filePath)) {
    headers.set("Content-Security-Policy", [
      "default-src 'self' data: blob:",
      "script-src 'self' 'unsafe-inline' 'unsafe-eval' 'wasm-unsafe-eval' blob:",
      "style-src 'self' 'unsafe-inline' data:",
      "img-src 'self' data: blob:",
      "media-src 'self' data: blob:",
      "font-src 'self' data: blob:",
      "connect-src 'self' data: blob:",
      "worker-src 'self' blob:",
      "frame-src 'none'",
      "object-src 'none'",
      "base-uri 'none'",
      "form-action 'none'",
      "frame-ancestors *",
      "sandbox allow-scripts allow-forms allow-pointer-lock allow-downloads",
    ].join("; "));
  }
  return headers;
}
