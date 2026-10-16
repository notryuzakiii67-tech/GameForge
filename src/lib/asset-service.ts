import "server-only";
import { ApiError } from "@/lib/http";
import { execute, newId, nowIso, query, transaction } from "@/lib/db";
import { assetCategoryForFilename, inspectAsset, maxAssetBytes, type AssetInspection } from "@/lib/asset-validation";
import { createPrivateAssetUploadUrl, deletePrivateAssetObject, getPrivateAssetObjectSize } from "@/lib/asset-storage";
import { getObject, isLocalStorage, putObject } from "@/lib/storage";

const UPLOAD_INTENT_TTL_MS = 10 * 60 * 1000;
const PRIVATE_CACHE = "private, no-store, max-age=0";

type AssetRow = {
  id: string;
  owner_id: string;
  project_id: string | null;
  original_name: string;
  extension: string;
  format: string;
  category: "image" | "model" | "audio";
  mime_type: string;
  size_bytes: number;
  content_hash: string;
  storage_key: string;
  upload_status: "pending_upload" | "ready" | "failed";
  publication_status: "private" | "pending_review" | "published" | "rejected" | "removed";
  validation_state: string;
  validation_json: string;
  store_title: string;
  public_description: string;
  license: string | null;
  rights_confirmed: number;
  rights_basis: string | null;
  download_authorized: number;
  attribution: string;
  moderation_note: string;
  published_at: string | null;
  upload_expires_at: string | null;
  deleted_at: string | null;
  created_at: string;
};

export type PrivateAssetSummary = {
  id: string;
  filename: string;
  extension: string;
  format: string;
  category: AssetRow["category"];
  mimeType: string;
  sizeBytes: number;
  contentHash: string;
  validationState: string;
  validation: Record<string, unknown>;
  createdAt: string;
  previewUrl: string;
  publicationStatus: AssetRow["publication_status"];
  storeTitle: string;
  publicDescription: string;
  license: string | null;
  rightsBasis: string | null;
  rightsConfirmed: boolean;
  downloadAuthorized: boolean;
  attribution: string;
  moderationNote: string;
  publishedAt: string | null;
};

function stagingStorageKey(ownerId: string, assetId: string): string {
  return `assets/pending/${ownerId}/${assetId}`;
}

async function deleteAssetObjects(asset: Pick<AssetRow, "owner_id" | "id" | "storage_key">): Promise<boolean> {
  const results = await Promise.all([asset.storage_key, stagingStorageKey(asset.owner_id, asset.id)].map(async (key) => {
    try { await deletePrivateAssetObject(key); return true; }
    catch { return false; /* Retain private rows for reconciliation; never expose a leftover object. */ }
  }));
  return results.every(Boolean);
}

function safeIntegerEnv(name: string, fallback: number, max: number): number {
  const value = Number(process.env[name]);
  return Number.isSafeInteger(value) && value > 0 ? Math.min(value, max) : fallback;
}

function userQuotaBytes(): number {
  return safeIntegerEnv("ASSET_USER_QUOTA_BYTES", 100 * 1024 * 1024, 2 * 1024 * 1024 * 1024);
}

function userAssetLimit(): number {
  return safeIntegerEnv("ASSET_MAX_PER_USER", 100, 500);
}

function parseValidationJson(raw: string): Record<string, unknown> {
  try {
    const value: unknown = JSON.parse(raw);
    return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
  } catch { return {}; }
}

function summarize(asset: AssetRow): PrivateAssetSummary {
  return {
    id: asset.id,
    filename: asset.original_name,
    extension: asset.extension,
    format: asset.format,
    category: asset.category,
    mimeType: asset.mime_type,
    sizeBytes: Number(asset.size_bytes),
    contentHash: asset.content_hash,
    validationState: asset.validation_state,
    validation: parseValidationJson(asset.validation_json),
    createdAt: asset.created_at,
    previewUrl: `/api/assets/${encodeURIComponent(asset.id)}/file`,
    publicationStatus: asset.publication_status,
    storeTitle: asset.store_title ?? "",
    publicDescription: asset.public_description ?? "",
    license: asset.license,
    rightsBasis: asset.rights_basis,
    rightsConfirmed: asset.rights_confirmed === 1,
    downloadAuthorized: asset.download_authorized === 1,
    attribution: asset.attribution ?? "",
    moderationNote: asset.moderation_note ?? "",
    publishedAt: asset.published_at,
  };
}

async function requireOwnedAsset(userId: string, assetId: string): Promise<AssetRow> {
  const rows = await query<AssetRow>(
    `SELECT id, owner_id, project_id, original_name, extension, format, category, mime_type, size_bytes,
            content_hash, storage_key, upload_status, publication_status, validation_state, validation_json,
            store_title, public_description, license, rights_confirmed, rights_basis, download_authorized, attribution, moderation_note, published_at,
            upload_expires_at, deleted_at, created_at
     FROM assets WHERE id = ? AND owner_id = ? AND deleted_at IS NULL LIMIT 1`, [assetId, userId]);
  if (!rows[0]) throw new ApiError(404, "ASSET_NOT_FOUND", "That private asset could not be found.");
  return rows[0];
}

async function expireOldUploads(userId: string): Promise<void> {
  const timestamp = nowIso();
  const expired = await query<{ id: string; storage_key: string }>(
    `SELECT id, storage_key FROM assets WHERE owner_id = ? AND upload_status = 'pending_upload' AND upload_expires_at <= ? AND deleted_at IS NULL`,
    [userId, timestamp],
  );
  for (const asset of expired) {
    await deleteAssetObjects({ ...asset, owner_id: userId });
    await execute(`UPDATE assets SET upload_status = 'failed', validation_state = 'expired', upload_expires_at = NULL, deleted_at = ?, updated_at = ? WHERE id = ? AND owner_id = ? AND upload_status = 'pending_upload'`, [timestamp, timestamp, asset.id, userId]);
  }
}

export async function createAssetUploadIntent(userId: string, rawFilename: string, rawSize: number) {
  const assetInfo = assetCategoryForFilename(rawFilename);
  if (!Number.isSafeInteger(rawSize) || rawSize <= 0) throw new ApiError(400, "INVALID_ASSET_SIZE", "Choose a non-empty asset file.");
  if (rawSize > maxAssetBytes()) throw new ApiError(413, "ASSET_TOO_LARGE", `Individual assets are limited to ${Math.floor(maxAssetBytes() / 1024 / 1024)} MiB.`);
  await expireOldUploads(userId);

  const id = newId();
  const timestamp = nowIso();
  const expiresAt = new Date(Date.now() + UPLOAD_INTENT_TTL_MS).toISOString();
  const storageKey = `assets/private/${userId}/${id}`;
  await transaction(async (tx) => {
    if (tx.dialect === "postgres") await tx.query(`SELECT id FROM users WHERE id = ? FOR UPDATE`, [userId]);
    const usage = await tx.query<{ asset_count: number; total_bytes: number }>(
      `SELECT COUNT(*) AS asset_count, COALESCE(SUM(size_bytes), 0) AS total_bytes
       FROM assets WHERE owner_id = ? AND deleted_at IS NULL AND upload_status IN ('pending_upload', 'ready')`, [userId]);
    if (Number(usage[0]?.asset_count ?? 0) >= userAssetLimit()) throw new ApiError(413, "ASSET_COUNT_QUOTA", `Your private library is limited to ${userAssetLimit()} assets.`);
    if (Number(usage[0]?.total_bytes ?? 0) + rawSize > userQuotaBytes()) throw new ApiError(413, "ASSET_STORAGE_QUOTA", `Your private asset library is limited to ${Math.floor(userQuotaBytes() / 1024 / 1024)} MiB.`);
    await tx.execute(
      `INSERT INTO assets(id, owner_id, original_name, extension, category, size_bytes, storage_key, upload_status, publication_status, validation_state, upload_expires_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'pending_upload', 'private', 'pending', ?, ?, ?)`,
      [id, userId, assetInfo.filename, assetInfo.extension, assetInfo.category, rawSize, storageKey, expiresAt, timestamp, timestamp],
    );
  });

  try {
    if (isLocalStorage()) {
      return {
        assetId: id,
        uploadUrl: `/api/assets/${encodeURIComponent(id)}/upload`,
        method: "PUT" as const,
        headers: { "Content-Type": "application/octet-stream" },
        expiresInSeconds: Math.floor(UPLOAD_INTENT_TTL_MS / 1000),
        storageMode: "local" as const,
      };
    }
    const signed = await createPrivateAssetUploadUrl(stagingStorageKey(userId, id), rawSize);
    return { assetId: id, uploadUrl: signed.url, method: "POST" as const, fields: signed.fields, expiresInSeconds: signed.expiresInSeconds, storageMode: "s3" as const };
  } catch (error) {
    await execute(`UPDATE assets SET upload_status = 'failed', validation_state = 'setup_error', upload_expires_at = NULL, deleted_at = ?, updated_at = ? WHERE id = ? AND owner_id = ?`, [nowIso(), nowIso(), id, userId]);
    throw error;
  }
}

function assertPending(asset: AssetRow, expectedOwner: string): void {
  if (asset.owner_id !== expectedOwner || asset.deleted_at) throw new ApiError(404, "ASSET_NOT_FOUND", "That private asset could not be found.");
  if (asset.upload_status === "ready") throw new ApiError(409, "ASSET_ALREADY_UPLOADED", "This asset upload has already been completed.");
  if (asset.upload_status !== "pending_upload") throw new ApiError(409, "ASSET_UPLOAD_CLOSED", "This asset upload is no longer active. Start a new upload.");
  if (!asset.upload_expires_at || asset.upload_expires_at <= nowIso()) throw new ApiError(410, "ASSET_UPLOAD_EXPIRED", "This asset upload has expired. Start a new upload.");
}

async function failAssetUpload(asset: AssetRow, userId: string, state: string): Promise<void> {
  await deleteAssetObjects(asset);
  const timestamp = nowIso();
  await execute(`UPDATE assets SET upload_status = 'failed', validation_state = ?, upload_expires_at = NULL, updated_at = ? WHERE id = ? AND owner_id = ? AND upload_status = 'pending_upload'`, [state, timestamp, asset.id, userId]);
}

async function markReady(asset: AssetRow, userId: string, inspection: AssetInspection, validatedBytes: Uint8Array): Promise<PrivateAssetSummary> {
  await putObject(asset.storage_key, validatedBytes, inspection.mimeType, PRIVATE_CACHE);
  try { await deletePrivateAssetObject(stagingStorageKey(asset.owner_id, asset.id)); } catch { /* The staging key is private and never served; a replay cannot replace the promoted object. */ }
  const timestamp = nowIso();
  await execute(
    `UPDATE assets SET original_name = ?, extension = ?, format = ?, category = ?, mime_type = ?, size_bytes = ?, content_hash = ?,
       upload_status = 'ready', publication_status = 'private', validation_state = ?, validation_json = ?, upload_expires_at = NULL, updated_at = ?
     WHERE id = ? AND owner_id = ? AND upload_status = 'pending_upload' AND deleted_at IS NULL`,
    [inspection.filename, inspection.extension, inspection.format, inspection.category, inspection.mimeType, inspection.sizeBytes,
      inspection.contentHash, inspection.validationState, JSON.stringify(inspection.details), timestamp, asset.id, userId],
  );
  const saved = await requireOwnedAsset(userId, asset.id);
  if (saved.upload_status !== "ready") throw new ApiError(409, "ASSET_UPLOAD_CLOSED", "This asset upload is no longer active.");
  return summarize(saved);
}

export async function uploadLocalAssetBytes(userId: string, assetId: string, bytes: Uint8Array): Promise<PrivateAssetSummary> {
  if (!isLocalStorage()) throw new ApiError(409, "DIRECT_UPLOAD_REQUIRED", "Production assets must be uploaded through the short-lived private storage URL.");
  const asset = await requireOwnedAsset(userId, assetId);
  assertPending(asset, userId);
  if (bytes.byteLength !== Number(asset.size_bytes)) {
    await failAssetUpload(asset, userId, "size_mismatch");
    throw new ApiError(400, "ASSET_SIZE_MISMATCH", "The uploaded byte count does not match the requested file size.");
  }
  let inspection: AssetInspection;
  try { inspection = inspectAsset(asset.original_name, bytes); }
  catch (error) { await failAssetUpload(asset, userId, error instanceof ApiError ? error.code.toLowerCase() : "validation_failed"); throw error; }
  await putObject(stagingStorageKey(asset.owner_id, asset.id), bytes, "application/octet-stream", PRIVATE_CACHE);
  try { return await markReady(asset, userId, inspection, bytes); }
  catch (error) { await deleteAssetObjects(asset); throw error; }
}

export async function completePrivateAssetUpload(userId: string, assetId: string): Promise<PrivateAssetSummary> {
  const asset = await requireOwnedAsset(userId, assetId);
  if (asset.upload_status === "ready") return summarize(asset);
  assertPending(asset, userId);
  let uploadedSize: number;
  const stagingKey = stagingStorageKey(asset.owner_id, asset.id);
  try { uploadedSize = await getPrivateAssetObjectSize(stagingKey); }
  catch (error) {
    if (error instanceof ApiError && error.code === "ASSET_UPLOAD_MISSING") throw error;
    throw error;
  }
  if (uploadedSize !== Number(asset.size_bytes) || uploadedSize > maxAssetBytes()) {
    await failAssetUpload(asset, userId, "size_mismatch");
    throw new ApiError(400, "ASSET_SIZE_MISMATCH", "The uploaded object size does not match the requested file.");
  }
  const stored = await getObject(stagingKey);
  if (stored.body.byteLength !== uploadedSize) {
    await failAssetUpload(asset, userId, "size_mismatch");
    throw new ApiError(400, "ASSET_SIZE_MISMATCH", "The stored object size changed during validation.");
  }
  let inspection: AssetInspection;
  try { inspection = inspectAsset(asset.original_name, stored.body); }
  catch (error) { await failAssetUpload(asset, userId, error instanceof ApiError ? error.code.toLowerCase() : "validation_failed"); throw error; }
  try { return await markReady(asset, userId, inspection, stored.body); }
  catch (error) { await deleteAssetObjects(asset); throw error; }
}

export async function listPrivateAssets(userId: string): Promise<PrivateAssetSummary[]> {
  const assets = await query<AssetRow>(
    `SELECT id, owner_id, project_id, original_name, extension, format, category, mime_type, size_bytes,
            content_hash, storage_key, upload_status, publication_status, validation_state, validation_json,
            store_title, public_description, license, rights_confirmed, rights_basis, download_authorized, attribution, moderation_note, published_at,
            upload_expires_at, deleted_at, created_at
     FROM assets WHERE owner_id = ? AND upload_status = 'ready' AND deleted_at IS NULL
     ORDER BY created_at DESC LIMIT 500`, [userId]);
  return assets.map(summarize);
}

export async function getPrivateAsset(userId: string, assetId: string): Promise<PrivateAssetSummary & { storageKey: string }> {
  const asset = await requireOwnedAsset(userId, assetId);
  if (asset.upload_status !== "ready") throw new ApiError(404, "ASSET_NOT_FOUND", "That owned asset is not available.");
  return { ...summarize(asset), storageKey: asset.storage_key };
}

export async function deletePrivateAsset(userId: string, assetId: string): Promise<{ storageCleanupPending: boolean }> {
  const asset = await requireOwnedAsset(userId, assetId);
  if (!["private", "rejected", "removed"].includes(asset.publication_status)) throw new ApiError(409, "ASSET_NOT_PRIVATE", "Withdraw an asset awaiting review or currently published before deleting it.");
  const timestamp = nowIso();
  const changed = await transaction(async (tx) => {
    const updated = await tx.execute(`UPDATE assets SET deleted_at = ?, upload_status = 'failed', updated_at = ? WHERE id = ? AND owner_id = ? AND deleted_at IS NULL AND publication_status IN ('private', 'rejected', 'removed')`, [timestamp, timestamp, assetId, userId]);
    if (updated) await tx.execute(`DELETE FROM project_asset_bindings WHERE asset_id = ? AND owner_id = ?`, [assetId, userId]);
    return updated;
  });
  if (!changed) throw new ApiError(404, "ASSET_NOT_FOUND", "That private asset could not be found.");
  const deleted = await deleteAssetObjects(asset);
  return { storageCleanupPending: !deleted };
}
