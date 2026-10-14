import { requireUser } from "@/lib/auth";
import { execute, query, newId, nowIso } from "@/lib/db";
import { ApiError, assertSameOrigin, enforceRateLimit, errorResponse, requireUuid } from "@/lib/http";
import { assertStorageReadyForPublishing, contentTypeForPath, putObject } from "@/lib/storage";
import { gameUploadLimit, validateGameZip } from "@/lib/zip";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

function safeVersionLimit(): number {
  const value = Number(process.env.MAX_GAME_VERSIONS);
  return Number.isInteger(value) && value > 0 ? Math.min(value, 100) : 8;
}

export async function POST(request: Request, context: { params: Promise<{ slug: string }> }) {
  try {
    assertSameOrigin(request);
    const user = await requireUser();
    const { slug: gameId } = await context.params;
    requireUuid(gameId, "game id");
    await enforceRateLimit(request, `game-upload:${user.id}`, 8, 60 * 60 * 1000);
    const owner = await query<{ status: string }>(`SELECT status FROM games WHERE id = ? AND developer_id = ? LIMIT 1`, [gameId, user.id]);
    if (!owner[0]) throw new ApiError(404, "GAME_NOT_FOUND", "That project is not in your account.");
    if (owner[0].status === "removed") throw new ApiError(409, "CONTENT_REMOVED", "This project was removed by moderation and cannot be changed or resubmitted.");
    if (owner[0].status === "published" || owner[0].status === "pending") throw new ApiError(409, "GAME_NOT_EDITABLE", "Create a new draft or wait for the current review before uploading a new build.");

    assertStorageReadyForPublishing();
    const contentLength = Number(request.headers.get("content-length") || 0);
    const uploadLimit = gameUploadLimit();
    if (contentLength > uploadLimit + 96_000) throw new ApiError(413, "UPLOAD_TOO_LARGE", "The ZIP exceeds the upload limit.");
    let form: FormData;
    try {
      form = await request.formData();
    } catch {
      throw new ApiError(400, "INVALID_UPLOAD", "Choose a valid ZIP file to upload.");
    }
    const uploaded = form.get("file");
    if (!(uploaded instanceof File)) throw new ApiError(400, "FILE_REQUIRED", "Choose a ZIP file to upload.");
    if (!uploaded.name.toLowerCase().endsWith(".zip")) throw new ApiError(400, "ZIP_REQUIRED", "Upload a ZIP archive containing your browser game.");
    if (uploaded.size > uploadLimit) throw new ApiError(413, "UPLOAD_TOO_LARGE", `ZIP uploads are limited to ${Math.floor(uploadLimit / 1024 / 1024)} MB.`);
    const build = validateGameZip(new Uint8Array(await uploaded.arrayBuffer()));

    const versions = await query<{ next_version: number }>(
      `SELECT COALESCE(MAX(version_number), 0) + 1 AS next_version FROM game_versions WHERE game_id = ?`,
      [gameId],
    );
    const versionNumber = Number(versions[0]?.next_version ?? 1);
    const maxVersions = safeVersionLimit();
    if (versionNumber > maxVersions) throw new ApiError(409, "VERSION_LIMIT_REACHED", `This project has reached its ${maxVersions}-version limit.`);
    const storageKey = `games/${gameId}/v${versionNumber}`;
    for (const [filePath, bytes] of Object.entries(build.files)) {
      await putObject(`${storageKey}/${filePath}`, bytes, contentTypeForPath(filePath));
    }
    const timestamp = nowIso();
    await execute(
      `INSERT INTO game_versions(id, game_id, version_number, storage_key, entry_point, file_size, content_hash, validation_status, changelog, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'validated', ?, ?)`,
      [newId(), gameId, versionNumber, storageKey, build.entryPoint, build.fileSize, build.contentHash, "Uploaded ZIP passed structural validation.", timestamp],
    );
    await execute(`UPDATE games SET version = ?, entry_point = ?, updated_at = ? WHERE id = ?`, [`${versionNumber}.0.0`, build.entryPoint, timestamp, gameId]);
    return Response.json({
      ok: true,
      version: versionNumber,
      entryPoint: build.entryPoint,
      fileSize: build.fileSize,
      contentHash: build.contentHash,
      validationStatus: "validated",
      note: "Archive structure and entry point validated. Uploaded code has not been executed or malware-scanned.",
    }, { status: 201, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return errorResponse(error);
  }
}
