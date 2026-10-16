import "server-only";
import { createHash } from "node:crypto";
import { ApiError } from "@/lib/http";
import { execute, newId, nowIso, query, transaction } from "@/lib/db";
import { assetCategoryForFilename, inspectAsset, maxAssetBytes, type AssetInspection } from "@/lib/asset-validation";
import { createPrivateAssetUploadUrl, deletePrivateAssetObject, getPrivateAssetObjectSize } from "@/lib/asset-storage";
import { getObject, isLocalStorage, putObject } from "@/lib/storage";
import { ASSET_STORE_LICENSES, getPublicStoreAsset } from "@/lib/asset-store";

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
  source_asset_id: string | null;
  source_license: string | null;
  source_license_url: string | null;
  source_attribution: string;
  source_creator_username: string | null;
  source_creator_display_name: string | null;
  appeal_status: string | null;
  appeal_explanation: string | null;
  appeal_reviewer_note: string | null;
  appeal_created_at: string | null;
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
  importSource: { assetId: string | null; license: string; licenseUrl: string; attribution: string; creatorUsername: string; creatorDisplayName: string } | null;
  appeal: { status: string; explanation: string; reviewerNote: string; createdAt: string } | null;
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

type CleanupKind = "asset" | "staging";
type CleanupCandidate = { id: string; owner_id: string; storage_key: string };
type CleanupResult = "completed" | "pending" | "skipped";
const CLEANUP_LEASE_MS = 5 * 60 * 1000;
const CLEANUP_BACKOFF_BASE_MS = 60 * 1000;
const CLEANUP_BACKOFF_MAX_MS = 24 * 60 * 60 * 1000;
const cleanupColumns = {
  asset: { status: "asset_storage_cleanup_status", attempts: "asset_storage_cleanup_attempts", last: "asset_storage_cleanup_last_attempt_at", next: "asset_storage_cleanup_next_attempt_at", lease: "asset_storage_cleanup_lease_until", error: "asset_storage_cleanup_error" },
  staging: { status: "asset_staging_cleanup_status", attempts: "asset_staging_cleanup_attempts", last: "asset_staging_cleanup_last_attempt_at", next: "asset_staging_cleanup_next_attempt_at", lease: "asset_staging_cleanup_lease_until", error: "asset_staging_cleanup_error" },
} as const;

function cleanupErrorLabel(error: unknown): string {
  if (error instanceof ApiError) return error.code.slice(0, 80);
  return (error instanceof Error ? error.name : "UnknownError").slice(0, 80);
}

async function attemptAssetObjectCleanup(asset: CleanupCandidate, kind: CleanupKind): Promise<CleanupResult> {
  const columns = cleanupColumns[kind];
  const timestamp = nowIso();
  const leaseUntil = new Date(Date.now() + CLEANUP_LEASE_MS).toISOString();
  const scope = kind === "asset" ? "(deleted_at IS NOT NULL OR upload_status = 'failed')" : "(upload_status = 'ready' AND deleted_at IS NULL)";
  const claim = await transaction(async (tx) => {
    if (tx.dialect === "postgres") await tx.query(`SELECT id FROM assets WHERE id = ? FOR UPDATE`, [asset.id]);
    const rows = await tx.query<{ id: string; owner_id: string; storage_key: string; attempts: number }>(
      `SELECT id, owner_id, storage_key, ${columns.attempts} AS attempts FROM assets WHERE id = ? AND ${scope} LIMIT 1`, [asset.id]);
    if (!rows[0]) return null;
    const updated = await tx.execute(
      `UPDATE assets SET ${columns.status} = 'running', ${columns.attempts} = ${columns.attempts} + 1,
         ${columns.last} = ?, ${columns.next} = NULL, ${columns.lease} = ?, ${columns.error} = '', updated_at = ?
       WHERE id = ? AND ${scope} AND (
         (${columns.status} = 'pending' AND (${columns.next} IS NULL OR ${columns.next} <= ?)) OR
         (${columns.status} = 'running' AND (${columns.lease} IS NULL OR ${columns.lease} <= ?))
       )`,
      [timestamp, leaseUntil, timestamp, asset.id, timestamp, timestamp],
    );
    return updated ? { ...rows[0], attempts: Number(rows[0].attempts) + 1 } : null;
  });
  if (!claim) return "skipped";

  let success = false;
  let errorLabel = "OBJECT_DELETE_FAILED";
  try {
    if (kind === "asset") success = await deleteAssetObjects(claim);
    else {
      await deletePrivateAssetObject(stagingStorageKey(claim.owner_id, claim.id));
      success = true;
    }
  } catch (error) { errorLabel = cleanupErrorLabel(error); }

  const finishedAt = nowIso();
  if (success) {
    const finishStagingToo = kind === "asset" ? `,
       asset_staging_cleanup_status = CASE WHEN asset_staging_cleanup_status IN ('idle', 'pending') THEN 'complete' ELSE asset_staging_cleanup_status END,
       asset_staging_cleanup_next_attempt_at = CASE WHEN asset_staging_cleanup_status IN ('idle', 'pending') THEN NULL ELSE asset_staging_cleanup_next_attempt_at END,
       asset_staging_cleanup_lease_until = CASE WHEN asset_staging_cleanup_status IN ('idle', 'pending') THEN NULL ELSE asset_staging_cleanup_lease_until END,
       asset_staging_cleanup_error = CASE WHEN asset_staging_cleanup_status IN ('idle', 'pending') THEN '' ELSE asset_staging_cleanup_error END` : "";
    await execute(
      `UPDATE assets SET ${columns.status} = 'complete', ${columns.lease} = NULL, ${columns.next} = NULL,
         ${columns.error} = ''${finishStagingToo}, updated_at = ?
       WHERE id = ? AND ${columns.status} = 'running' AND ${columns.lease} = ?`,
      [finishedAt, claim.id, leaseUntil],
    );
    return "completed";
  }
  const backoff = Math.min(CLEANUP_BACKOFF_MAX_MS, CLEANUP_BACKOFF_BASE_MS * (2 ** Math.min(claim.attempts - 1, 10)));
  const nextAttempt = new Date(Date.now() + backoff).toISOString();
  await execute(
    `UPDATE assets SET ${columns.status} = 'pending', ${columns.lease} = NULL, ${columns.next} = ?,
       ${columns.error} = ?, updated_at = ? WHERE id = ? AND ${columns.status} = 'running' AND ${columns.lease} = ?`,
    [nextAttempt, errorLabel, finishedAt, claim.id, leaseUntil],
  );
  return "pending";
}

async function runCleanupBatch(candidates: CleanupCandidate[], kind: CleanupKind): Promise<{ attempted: number; completed: number }> {
  let attempted = 0;
  let completed = 0;
  for (let offset = 0; offset < candidates.length; offset += 8) {
    const results = await Promise.all(candidates.slice(offset, offset + 8).map((asset) => attemptAssetObjectCleanup(asset, kind)));
    attempted += results.filter((result) => result !== "skipped").length;
    completed += results.filter((result) => result === "completed").length;
  }
  return { attempted, completed };
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
    importSource: asset.source_license && asset.source_license_url ? {
      assetId: asset.source_asset_id,
      license: asset.source_license,
      licenseUrl: asset.source_license_url,
      attribution: asset.source_attribution,
      creatorUsername: asset.source_creator_username ?? "creator",
      creatorDisplayName: asset.source_creator_display_name ?? "Original creator",
    } : null,
    appeal: asset.appeal_status ? {
      status: asset.appeal_status,
      explanation: asset.appeal_explanation ?? "",
      reviewerNote: asset.appeal_reviewer_note ?? "",
      createdAt: asset.appeal_created_at ?? asset.created_at,
    } : null,
  };
}

async function requireOwnedAsset(userId: string, assetId: string): Promise<AssetRow> {
  const rows = await query<AssetRow>(
    `SELECT id, owner_id, project_id, original_name, extension, format, category, mime_type, size_bytes,
            content_hash, storage_key, upload_status, publication_status, validation_state, validation_json,
            store_title, public_description, license, rights_confirmed, rights_basis, download_authorized, attribution, moderation_note, published_at,
            source_asset_id, source_license, source_license_url, source_attribution, source_creator_username, source_creator_display_name,
            (SELECT status FROM asset_store_appeals ap WHERE ap.asset_id = assets.id ORDER BY ap.created_at DESC LIMIT 1) AS appeal_status,
            (SELECT explanation FROM asset_store_appeals ap WHERE ap.asset_id = assets.id ORDER BY ap.created_at DESC LIMIT 1) AS appeal_explanation,
            (SELECT reviewer_note FROM asset_store_appeals ap WHERE ap.asset_id = assets.id ORDER BY ap.created_at DESC LIMIT 1) AS appeal_reviewer_note,
            (SELECT created_at FROM asset_store_appeals ap WHERE ap.asset_id = assets.id ORDER BY ap.created_at DESC LIMIT 1) AS appeal_created_at,
            upload_expires_at, deleted_at, created_at
     FROM assets WHERE id = ? AND owner_id = ? AND deleted_at IS NULL LIMIT 1`, [assetId, userId]);
  if (!rows[0]) throw new ApiError(404, "ASSET_NOT_FOUND", "That private asset could not be found.");
  return rows[0];
}

async function expireOldUploads(userId: string): Promise<void> {
  const timestamp = nowIso();
  const expired = await query<CleanupCandidate>(
    `SELECT id, owner_id, storage_key FROM assets WHERE owner_id = ? AND upload_status = 'pending_upload' AND upload_expires_at <= ? AND deleted_at IS NULL`,
    [userId, timestamp],
  );
  for (const asset of expired) {
    await transaction(async (tx) => {
      if (tx.dialect === "postgres") await tx.query(`SELECT id FROM assets WHERE id = ? FOR UPDATE`, [asset.id]);
      const expiredAt = nowIso();
      await tx.execute(
        `UPDATE assets SET upload_status = 'failed', validation_state = 'expired', upload_expires_at = NULL,
           deleted_at = ?, asset_storage_cleanup_status = 'pending', asset_storage_cleanup_next_attempt_at = NULL,
           asset_storage_cleanup_lease_until = NULL, asset_storage_cleanup_error = '', updated_at = ?
         WHERE id = ? AND owner_id = ? AND upload_status = 'pending_upload' AND upload_expires_at <= ? AND deleted_at IS NULL`,
        [expiredAt, expiredAt, asset.id, userId, expiredAt],
      );
    });
    await attemptAssetObjectCleanup(asset, "asset");
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
    const failedAt = nowIso();
    const failed = await query<CleanupCandidate>(`UPDATE assets SET upload_status = 'failed', validation_state = 'setup_error', upload_expires_at = NULL,
      deleted_at = ?, asset_storage_cleanup_status = 'pending', asset_storage_cleanup_next_attempt_at = NULL,
      asset_storage_cleanup_lease_until = NULL, asset_storage_cleanup_error = '', updated_at = ?
      WHERE id = ? AND owner_id = ? RETURNING id, owner_id, storage_key`, [failedAt, failedAt, id, userId]);
    if (failed[0]) await attemptAssetObjectCleanup(failed[0], "asset");
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
  const timestamp = nowIso();
  await execute(
    `UPDATE assets SET upload_status = 'failed', validation_state = ?, upload_expires_at = NULL, deleted_at = COALESCE(deleted_at, ?),
       asset_storage_cleanup_status = 'pending', asset_storage_cleanup_next_attempt_at = NULL,
       asset_storage_cleanup_lease_until = NULL, asset_storage_cleanup_error = '', updated_at = ?
     WHERE id = ? AND owner_id = ? AND upload_status = 'pending_upload'`,
    [state, timestamp, timestamp, asset.id, userId],
  );
  await attemptAssetObjectCleanup(asset, "asset");
}

async function markReady(asset: AssetRow, userId: string, inspection: AssetInspection, validatedBytes: Uint8Array): Promise<PrivateAssetSummary> {
  await putObject(asset.storage_key, validatedBytes, inspection.mimeType, PRIVATE_CACHE);
  let stagingDeleted = true;
  try { await deletePrivateAssetObject(stagingStorageKey(asset.owner_id, asset.id)); }
  catch { stagingDeleted = false; /* Retained as a staging-only cleanup task; never served to users. */ }
  const timestamp = nowIso();
  await execute(
    `UPDATE assets SET original_name = ?, extension = ?, format = ?, category = ?, mime_type = ?, size_bytes = ?, content_hash = ?,
       upload_status = 'ready', publication_status = 'private', validation_state = ?, validation_json = ?, upload_expires_at = NULL,
       asset_staging_cleanup_status = ?, asset_staging_cleanup_next_attempt_at = NULL, asset_staging_cleanup_lease_until = NULL,
       asset_staging_cleanup_error = '', updated_at = ?
     WHERE id = ? AND owner_id = ? AND upload_status = 'pending_upload' AND deleted_at IS NULL`,
    [inspection.filename, inspection.extension, inspection.format, inspection.category, inspection.mimeType, inspection.sizeBytes,
      inspection.contentHash, inspection.validationState, JSON.stringify(inspection.details), stagingDeleted ? "complete" : "pending", timestamp, asset.id, userId],
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

export async function importPublicStoreAsset(userId: string, sourceAssetId: string): Promise<PrivateAssetSummary> {
  const source = await getPublicStoreAsset(sourceAssetId);
  let stored: Awaited<ReturnType<typeof getObject>>;
  try { stored = await getObject(source.storage_key); }
  catch { throw new ApiError(409, "ASSET_STORAGE_UNAVAILABLE", "The public asset bytes could not be imported right now."); }
  const bytes = stored.body;
  if (bytes.byteLength !== Number(source.size_bytes) || bytes.byteLength > maxAssetBytes()
    || createHash("sha256").update(bytes).digest("hex") !== source.content_hash) {
    throw new ApiError(409, "ASSET_INTEGRITY_MISMATCH", "The public asset no longer matches its verified metadata and cannot be imported.");
  }
  let inspection: AssetInspection;
  try { inspection = inspectAsset(source.original_name, bytes); }
  catch { throw new ApiError(409, "ASSET_REVALIDATION_FAILED", "The public asset failed validation and cannot be imported."); }
  if (inspection.contentHash !== source.content_hash || inspection.sizeBytes !== Number(source.size_bytes)
    || inspection.category !== source.category || inspection.validationState !== "valid_compatible") {
    throw new ApiError(409, "ASSET_REVALIDATION_FAILED", "The public asset is not compatible with the current private library rules.");
  }
  if (!source.license || !Object.hasOwn(ASSET_STORE_LICENSES, source.license)) throw new ApiError(409, "ASSET_LICENSE_UNAVAILABLE", "The asset does not have a supported store license.");
  const license = source.license as keyof typeof ASSET_STORE_LICENSES;
  const licenseInfo = ASSET_STORE_LICENSES[license];
  const id = newId();
  const timestamp = nowIso();
  const expiresAt = new Date(Date.now() + UPLOAD_INTENT_TTL_MS).toISOString();
  const storageKey = `assets/private/${userId}/${id}`;

  await transaction(async (tx) => {
    if (tx.dialect === "postgres") await tx.query(`SELECT id FROM users WHERE id = ? FOR UPDATE`, [userId]);
    const owners = await tx.query<{ account_status: string }>(`SELECT account_status FROM users WHERE id = ? LIMIT 1`, [userId]);
    if (!owners[0] || owners[0].account_status !== "active") throw new ApiError(403, "ACCOUNT_INACTIVE", "An active account is required to import Asset Store files.");
    const available = await tx.query<{ id: string }>(
      `SELECT a.id FROM assets a JOIN users u ON u.id = a.owner_id
       WHERE a.id = ? AND a.publication_status = 'published' AND a.upload_status = 'ready'
         AND a.validation_state = 'valid_compatible' AND a.rights_confirmed = 1 AND a.download_authorized = 1
         AND a.rights_declaration_at IS NOT NULL AND TRIM(a.attribution) <> ''
         AND a.rights_basis IN ('created_by_me', 'licensed_for_redistribution', 'public_domain')
         AND a.license = ? AND a.deleted_at IS NULL AND u.account_status = 'active' LIMIT 1`,
      [sourceAssetId, license],
    );
    if (!available[0]) throw new ApiError(409, "ASSET_NO_LONGER_PUBLIC", "The asset was withdrawn or is no longer authorized for public download.");
    const usage = await tx.query<{ asset_count: number; total_bytes: number }>(
      `SELECT COUNT(*) AS asset_count, COALESCE(SUM(size_bytes), 0) AS total_bytes
       FROM assets WHERE owner_id = ? AND deleted_at IS NULL AND upload_status IN ('pending_upload', 'ready')`, [userId]);
    if (Number(usage[0]?.asset_count ?? 0) >= userAssetLimit()) throw new ApiError(413, "ASSET_COUNT_QUOTA", `Your private library is limited to ${userAssetLimit()} assets.`);
    if (Number(usage[0]?.total_bytes ?? 0) + bytes.byteLength > userQuotaBytes()) throw new ApiError(413, "ASSET_STORAGE_QUOTA", `Your private asset library is limited to ${Math.floor(userQuotaBytes() / 1024 / 1024)} MiB.`);
    await tx.execute(
      `INSERT INTO assets(id, owner_id, original_name, extension, format, category, mime_type, size_bytes, content_hash, storage_key,
         upload_status, publication_status, validation_state, validation_json, upload_expires_at,
         source_asset_id, source_license, source_license_url, source_attribution, source_creator_username, source_creator_display_name, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending_upload', 'private', 'store_importing', '{}', ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, userId, inspection.filename, inspection.extension, inspection.format, inspection.category, inspection.mimeType, inspection.sizeBytes,
        inspection.contentHash, storageKey, expiresAt, source.id, license, licenseInfo.url, source.attribution,
        source.username ?? "creator", source.display_name ?? "GameForge creator", timestamp, timestamp],
    );
  });

  try {
    await putObject(storageKey, bytes, inspection.mimeType, PRIVATE_CACHE);
    const changed = await execute(
      `UPDATE assets SET upload_status = 'ready', validation_state = ?, validation_json = ?, upload_expires_at = NULL, updated_at = ?
       WHERE id = ? AND owner_id = ? AND upload_status = 'pending_upload' AND validation_state = 'store_importing' AND deleted_at IS NULL`,
      [inspection.validationState, JSON.stringify(inspection.details), nowIso(), id, userId],
    );
    if (!changed) throw new ApiError(409, "ASSET_IMPORT_EXPIRED", "The private import could not be completed. Try importing it again.");
  } catch (error) {
    try {
      const failedAt = nowIso();
      const changed = await execute(
        `UPDATE assets SET upload_status = 'failed', validation_state = 'import_failed', upload_expires_at = NULL, deleted_at = ?,
           asset_storage_cleanup_status = 'pending', asset_storage_cleanup_next_attempt_at = NULL,
           asset_storage_cleanup_lease_until = NULL, asset_storage_cleanup_error = '', updated_at = ?
         WHERE id = ? AND owner_id = ? AND upload_status = 'pending_upload' AND validation_state = 'store_importing'`,
        [failedAt, failedAt, id, userId],
      );
      if (changed) await attemptAssetObjectCleanup({ owner_id: userId, id, storage_key: storageKey }, "asset");
    } catch { /* The scheduled retry will reconcile a tombstone if immediate cleanup cannot reach storage. */ }
    throw error;
  }
  const imported = await requireOwnedAsset(userId, id);
  return summarize(imported);
}

export async function cleanupExpiredAssetUploads(batchSize = 100): Promise<{
  scanned: number;
  expired: number;
  cleanupAttempted: number;
  cleanupCompleted: number;
  stagingCleanupAttempted: number;
  stagingCleanupCompleted: number;
  cleanupPending: number;
}> {
  const limit = Math.min(100, Math.max(1, Math.floor(batchSize)));
  const timestamp = nowIso();
  const expired = await query<CleanupCandidate>(
    `SELECT id, owner_id, storage_key FROM assets
     WHERE upload_status = 'pending_upload' AND upload_expires_at <= ? AND deleted_at IS NULL
     ORDER BY upload_expires_at ASC LIMIT ?`, [timestamp, limit]);
  let expiredCount = 0;
  for (const candidate of expired) {
    const marked = await transaction(async (tx) => {
      if (tx.dialect === "postgres") await tx.query(`SELECT id FROM assets WHERE id = ? FOR UPDATE`, [candidate.id]);
      const changedAt = nowIso();
      return tx.execute(
        `UPDATE assets SET upload_status = 'failed', validation_state = 'expired', upload_expires_at = NULL, deleted_at = ?,
           asset_storage_cleanup_status = 'pending', asset_storage_cleanup_next_attempt_at = NULL,
           asset_storage_cleanup_lease_until = NULL, asset_storage_cleanup_error = '', updated_at = ?
         WHERE id = ? AND upload_status = 'pending_upload' AND upload_expires_at <= ? AND deleted_at IS NULL`,
        [changedAt, changedAt, candidate.id, changedAt],
      );
    });
    if (marked) expiredCount += 1;
  }

  const candidates = await query<CleanupCandidate>(
    `SELECT id, owner_id, storage_key FROM assets
     WHERE ((asset_storage_cleanup_status = 'pending' AND (asset_storage_cleanup_next_attempt_at IS NULL OR asset_storage_cleanup_next_attempt_at <= ?))
       OR (asset_storage_cleanup_status = 'running' AND (asset_storage_cleanup_lease_until IS NULL OR asset_storage_cleanup_lease_until <= ?)))
       AND (deleted_at IS NOT NULL OR upload_status = 'failed')
     ORDER BY COALESCE(asset_storage_cleanup_next_attempt_at, asset_storage_cleanup_last_attempt_at, created_at), id LIMIT ?`,
    [timestamp, timestamp, limit]);
  const assetCleanup = await runCleanupBatch(candidates, "asset");

  const stagingCandidates = await query<CleanupCandidate>(
    `SELECT id, owner_id, storage_key FROM assets
     WHERE ((asset_staging_cleanup_status = 'pending' AND (asset_staging_cleanup_next_attempt_at IS NULL OR asset_staging_cleanup_next_attempt_at <= ?))
       OR (asset_staging_cleanup_status = 'running' AND (asset_staging_cleanup_lease_until IS NULL OR asset_staging_cleanup_lease_until <= ?)))
       AND upload_status = 'ready' AND deleted_at IS NULL
     ORDER BY COALESCE(asset_staging_cleanup_next_attempt_at, asset_staging_cleanup_last_attempt_at, created_at), id LIMIT ?`,
    [timestamp, timestamp, limit]);
  const stagingCleanup = await runCleanupBatch(stagingCandidates, "staging");
  const pendingRows = await query<{ count: number }>(
    `SELECT COUNT(*) AS count FROM assets WHERE asset_storage_cleanup_status IN ('pending', 'running') OR asset_staging_cleanup_status IN ('pending', 'running')`);
  return {
    scanned: expired.length,
    expired: expiredCount,
    cleanupAttempted: assetCleanup.attempted,
    cleanupCompleted: assetCleanup.completed,
    stagingCleanupAttempted: stagingCleanup.attempted,
    stagingCleanupCompleted: stagingCleanup.completed,
    cleanupPending: Number(pendingRows[0]?.count ?? 0),
  };
}

export async function listPrivateAssets(userId: string): Promise<PrivateAssetSummary[]> {
  const assets = await query<AssetRow>(
    `SELECT id, owner_id, project_id, original_name, extension, format, category, mime_type, size_bytes,
            content_hash, storage_key, upload_status, publication_status, validation_state, validation_json,
            store_title, public_description, license, rights_confirmed, rights_basis, download_authorized, attribution, moderation_note, published_at,
            source_asset_id, source_license, source_license_url, source_attribution, source_creator_username, source_creator_display_name,
            (SELECT status FROM asset_store_appeals ap WHERE ap.asset_id = assets.id ORDER BY ap.created_at DESC LIMIT 1) AS appeal_status,
            (SELECT explanation FROM asset_store_appeals ap WHERE ap.asset_id = assets.id ORDER BY ap.created_at DESC LIMIT 1) AS appeal_explanation,
            (SELECT reviewer_note FROM asset_store_appeals ap WHERE ap.asset_id = assets.id ORDER BY ap.created_at DESC LIMIT 1) AS appeal_reviewer_note,
            (SELECT created_at FROM asset_store_appeals ap WHERE ap.asset_id = assets.id ORDER BY ap.created_at DESC LIMIT 1) AS appeal_created_at,
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
  if (asset.appeal_status === "open") throw new ApiError(409, "ASSET_APPEAL_OPEN", "Wait for a moderator to resolve the open appeal before deleting this asset.");
  if (!["private", "rejected", "removed"].includes(asset.publication_status)) throw new ApiError(409, "ASSET_NOT_PRIVATE", "Withdraw an asset awaiting review or currently published before deleting it.");
  const timestamp = nowIso();
  const changed = await transaction(async (tx) => {
    const updated = await tx.execute(
      `UPDATE assets SET deleted_at = ?, upload_status = 'failed', asset_storage_cleanup_status = 'pending',
         asset_storage_cleanup_next_attempt_at = NULL, asset_storage_cleanup_lease_until = NULL,
         asset_storage_cleanup_error = '', updated_at = ?
       WHERE id = ? AND owner_id = ? AND deleted_at IS NULL AND publication_status IN ('private', 'rejected', 'removed')`,
      [timestamp, timestamp, assetId, userId],
    );
    if (updated) await tx.execute(`DELETE FROM project_asset_bindings WHERE asset_id = ? AND owner_id = ?`, [assetId, userId]);
    return updated;
  });
  if (!changed) throw new ApiError(404, "ASSET_NOT_FOUND", "That private asset could not be found.");
  const cleanup = await attemptAssetObjectCleanup({ id: asset.id, owner_id: asset.owner_id, storage_key: asset.storage_key }, "asset");
  return { storageCleanupPending: cleanup !== "completed" };
}
