import "server-only";
import { createHash } from "node:crypto";
import { ApiError, logAudit } from "@/lib/http";
import { execute, newId, nowIso, query, transaction, type DatabaseTransaction } from "@/lib/db";
import { inspectAsset } from "@/lib/asset-validation";
import { getObject } from "@/lib/storage";

export const ASSET_STORE_LICENSES = {
  "cc-by-4.0": { name: "Creative Commons Attribution 4.0", url: "https://creativecommons.org/licenses/by/4.0/" },
  "cc-by-sa-4.0": { name: "Creative Commons Attribution-ShareAlike 4.0", url: "https://creativecommons.org/licenses/by-sa/4.0/" },
  "cc0-1.0": { name: "Creative Commons CC0 1.0 Universal", url: "https://creativecommons.org/publicdomain/zero/1.0/" },
} as const;
export type AssetStoreLicense = keyof typeof ASSET_STORE_LICENSES;
export const ASSET_RIGHTS_BASES = ["created_by_me", "licensed_for_redistribution", "public_domain"] as const;
export type AssetRightsBasis = typeof ASSET_RIGHTS_BASES[number];

export type AssetStoreDeclaration = {
  title: string;
  description: string;
  license: AssetStoreLicense;
  attribution: string;
  rightsBasis: AssetRightsBasis;
  rightsConfirmed: true;
  downloadAuthorized: true;
};

type AssetStoreRow = {
  id: string;
  owner_id: string;
  original_name: string;
  format: string;
  category: "image" | "model" | "audio";
  mime_type: string;
  size_bytes: number;
  content_hash: string;
  storage_key: string;
  upload_status: string;
  publication_status: string;
  validation_state: string;
  store_title: string;
  public_description: string;
  license: string | null;
  rights_confirmed: number;
  rights_basis: string | null;
  download_authorized: number;
  rights_declaration_at: string | null;
  attribution: string;
  created_at: string;
  published_at: string | null;
  username?: string;
  display_name?: string;
};

export type PublicAssetStoreItem = {
  id: string;
  title: string;
  description: string;
  filename: string;
  format: string;
  category: AssetStoreRow["category"];
  sizeBytes: number;
  license: { id: AssetStoreLicense; name: string; url: string };
  attribution: string;
  creator: { username: string; displayName: string };
  publishedAt: string;
  downloadUrl: string;
};

const selectStoreColumns = `id, owner_id, original_name, format, category, mime_type, size_bytes, content_hash, storage_key,
  upload_status, publication_status, validation_state, store_title, public_description, license, rights_confirmed,
  rights_basis, download_authorized, rights_declaration_at, attribution, created_at, published_at`;
const publicStoreSelectColumns = `a.id, a.owner_id, a.original_name, a.format, a.category, a.mime_type, a.size_bytes,
  a.content_hash, a.storage_key, a.upload_status, a.publication_status, a.validation_state, a.store_title,
  a.public_description, a.license, a.rights_confirmed, a.rights_basis, a.download_authorized, a.rights_declaration_at, a.attribution,
  a.created_at, a.published_at, u.username, u.display_name`;
const licenseIds = Object.keys(ASSET_STORE_LICENSES) as AssetStoreLicense[];

function isLicense(value: string | null): value is AssetStoreLicense {
  return value !== null && Object.hasOwn(ASSET_STORE_LICENSES, value);
}

function mapPublicAsset(row: AssetStoreRow): PublicAssetStoreItem {
  if (!isLicense(row.license)) throw new ApiError(404, "ASSET_NOT_FOUND", "That public asset is not available.");
  return {
    id: row.id,
    title: row.store_title || row.original_name,
    description: row.public_description,
    filename: row.original_name,
    format: row.format,
    category: row.category,
    sizeBytes: Number(row.size_bytes),
    license: { id: row.license, ...ASSET_STORE_LICENSES[row.license] },
    attribution: row.attribution,
    creator: { username: row.username ?? "creator", displayName: row.display_name ?? "GameForge creator" },
    publishedAt: row.published_at ?? row.created_at,
    downloadUrl: `/api/asset-store/${encodeURIComponent(row.id)}/download`,
  };
}

function isDeclarationValid(declaration: AssetStoreDeclaration): boolean {
  return isLicense(declaration.license)
    && ASSET_RIGHTS_BASES.includes(declaration.rightsBasis)
    && declaration.rightsConfirmed === true
    && declaration.downloadAuthorized === true
    && declaration.title.trim().length >= 2 && declaration.title.trim().length <= 100
    && declaration.description.trim().length <= 700
    && declaration.attribution.trim().length >= 2 && declaration.attribution.trim().length <= 300;
}

async function insertModerationEvent(
  tx: DatabaseTransaction,
  values: { assetId: string; actorId: string | null; action: string; fromStatus: string; toStatus: string; note: string; details?: Record<string, unknown>; createdAt: string },
): Promise<void> {
  await tx.execute(
    `INSERT INTO asset_moderation_events(id, asset_id, actor_id, action, from_status, to_status, note, details_json, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [newId(), values.assetId, values.actorId, values.action, values.fromStatus, values.toStatus, values.note, JSON.stringify(values.details ?? {}), values.createdAt],
  );
}

async function ownedAsset(tx: DatabaseTransaction, ownerId: string, assetId: string): Promise<AssetStoreRow> {
  const rows = await tx.query<AssetStoreRow>(
    `SELECT ${selectStoreColumns} FROM assets WHERE id = ? AND owner_id = ? AND deleted_at IS NULL LIMIT 1`, [assetId, ownerId]);
  if (!rows[0]) throw new ApiError(404, "ASSET_NOT_FOUND", "That asset is not in your account.");
  return rows[0];
}

export async function submitAssetToStore(ownerId: string, assetId: string, declaration: AssetStoreDeclaration): Promise<{ status: "pending_review" }> {
  if (!isDeclarationValid(declaration)) throw new ApiError(400, "INVALID_ASSET_RIGHTS_DECLARATION", "Complete the ownership/authorization, attribution, license, and public-download declarations before submission.");
  const timestamp = nowIso();
  await transaction(async (tx) => {
    if (tx.dialect === "postgres") await tx.query(`SELECT id FROM assets WHERE id = ? AND owner_id = ? FOR UPDATE`, [assetId, ownerId]);
    const asset = await ownedAsset(tx, ownerId, assetId);
    if (asset.upload_status !== "ready" || asset.validation_state !== "valid_compatible") {
      throw new ApiError(409, "ASSET_NOT_VALIDATED", "Only a fully validated asset can be submitted for public review.");
    }
    if (!(asset.publication_status === "private" || asset.publication_status === "rejected")) {
      throw new ApiError(409, "ASSET_SUBMISSION_STATE", "Only a private or previously rejected asset can be submitted for review.");
    }
    await tx.execute(
      `UPDATE assets SET store_title = ?, public_description = ?, license = ?, attribution = ?, rights_basis = ?,
         rights_confirmed = 1, download_authorized = 1, rights_declaration_at = ?, publication_status = 'pending_review',
         published_at = NULL, reviewed_at = NULL, reviewer_id = NULL, moderation_note = '', updated_at = ?
       WHERE id = ? AND owner_id = ? AND deleted_at IS NULL AND publication_status IN ('private', 'rejected')`,
      [declaration.title.trim(), declaration.description.trim(), declaration.license, declaration.attribution.trim(), declaration.rightsBasis,
        timestamp, timestamp, assetId, ownerId],
    );
    await insertModerationEvent(tx, {
      assetId, actorId: ownerId, action: "submitted", fromStatus: asset.publication_status, toStatus: "pending_review", note: "",
      details: { title: declaration.title.trim(), license: declaration.license, attribution: declaration.attribution.trim(), rightsBasis: declaration.rightsBasis,
        rightsConfirmed: true, downloadAuthorized: true, declarationVersion: "asset-store-rights-v1" }, createdAt: timestamp,
    });
  });
  await logAudit(ownerId, "asset.store.submit", "asset", assetId, { license: declaration.license, rightsBasis: declaration.rightsBasis });
  return { status: "pending_review" };
}

export async function withdrawAssetFromStore(ownerId: string, assetId: string): Promise<{ status: "private" }> {
  const timestamp = nowIso();
  await transaction(async (tx) => {
    if (tx.dialect === "postgres") await tx.query(`SELECT id FROM assets WHERE id = ? AND owner_id = ? FOR UPDATE`, [assetId, ownerId]);
    const asset = await ownedAsset(tx, ownerId, assetId);
    if (asset.publication_status !== "pending_review" && asset.publication_status !== "published") {
      throw new ApiError(409, "ASSET_NOT_WITHDRAWABLE", "Only an asset awaiting review or currently published can be withdrawn.");
    }
    const changed = await tx.execute(
      `UPDATE assets SET publication_status = 'private', published_at = NULL, updated_at = ?
       WHERE id = ? AND owner_id = ? AND publication_status IN ('pending_review', 'published') AND deleted_at IS NULL`,
      [timestamp, assetId, ownerId],
    );
    if (!changed) throw new ApiError(409, "ASSET_PUBLICATION_CHANGED", "The asset changed while withdrawal was being processed.");
    await insertModerationEvent(tx, { assetId, actorId: ownerId, action: "withdrawn", fromStatus: asset.publication_status, toStatus: "private", note: "", createdAt: timestamp });
  });
  await logAudit(ownerId, "asset.store.withdraw", "asset", assetId);
  return { status: "private" };
}

export async function removeAssetFromStore(assetId: string, actorId: string | null, note: string, allowPending = true): Promise<void> {
  const normalizedNote = note.trim();
  if (normalizedNote.length < 3 || normalizedNote.length > 500) throw new ApiError(400, "MODERATION_NOTE_REQUIRED", "Provide a moderation note between 3 and 500 characters.");
  const timestamp = nowIso();
  await transaction(async (tx) => {
    if (tx.dialect === "postgres") await tx.query(`SELECT id FROM assets WHERE id = ? FOR UPDATE`, [assetId]);
    const rows = await tx.query<AssetStoreRow>(`SELECT ${selectStoreColumns} FROM assets WHERE id = ? AND deleted_at IS NULL LIMIT 1`, [assetId]);
    const asset = rows[0];
    if (!asset) throw new ApiError(404, "ASSET_NOT_FOUND", "That asset is no longer available.");
    const allowed = allowPending ? ["published", "pending_review"] : ["published"];
    if (!allowed.includes(asset.publication_status)) throw new ApiError(409, "ASSET_NOT_LISTED", "That asset is not currently public or awaiting review.");
    const changed = await tx.execute(
      `UPDATE assets SET publication_status = 'removed', reviewed_at = ?, reviewer_id = ?, moderation_note = ?, updated_at = ?
       WHERE id = ? AND publication_status = ? AND deleted_at IS NULL`,
      [timestamp, actorId, normalizedNote, timestamp, assetId, asset.publication_status],
    );
    if (!changed) throw new ApiError(409, "ASSET_PUBLICATION_CHANGED", "The asset changed while moderation was being processed.");
    await insertModerationEvent(tx, { assetId, actorId, action: "removed", fromStatus: asset.publication_status, toStatus: "removed", note: normalizedNote, createdAt: timestamp });
  });
  if (actorId) await logAudit(actorId, "asset.store.remove", "asset", assetId, { note: normalizedNote });
}

export async function reviewAssetStoreSubmission(
  assetId: string,
  actorId: string,
  decision: "approve" | "reject",
  note = "",
): Promise<{ status: "published" | "rejected" }> {
  const normalizedNote = note.trim();
  if (decision === "reject" && (normalizedNote.length < 3 || normalizedNote.length > 500)) {
    throw new ApiError(400, "MODERATION_NOTE_REQUIRED", "Provide a moderation note of at least 3 characters when rejecting an asset.");
  }
  const rows = await query<AssetStoreRow>(`SELECT ${selectStoreColumns} FROM assets WHERE id = ? AND deleted_at IS NULL LIMIT 1`, [assetId]);
  const candidate = rows[0];
  if (!candidate || candidate.publication_status !== "pending_review") throw new ApiError(404, "ASSET_SUBMISSION_NOT_FOUND", "This asset is no longer awaiting review.");

  if (decision === "approve") {
    if (candidate.upload_status !== "ready" || candidate.validation_state !== "valid_compatible" || !isLicense(candidate.license)
      || candidate.rights_confirmed !== 1 || candidate.download_authorized !== 1 || !candidate.rights_declaration_at
      || !ASSET_RIGHTS_BASES.includes(candidate.rights_basis as AssetRightsBasis)
      || candidate.attribution.trim().length < 2 || candidate.store_title.trim().length < 2) {
      throw new ApiError(409, "ASSET_RIGHTS_REVIEW_FAILED", "The asset does not have a complete supported rights and download declaration.");
    }
    let stored: Awaited<ReturnType<typeof getObject>>;
    try { stored = await getObject(candidate.storage_key); }
    catch { throw new ApiError(409, "ASSET_STORAGE_UNAVAILABLE", "The asset bytes could not be verified for review."); }
    if (stored.body.byteLength !== Number(candidate.size_bytes) || createHash("sha256").update(stored.body).digest("hex") !== candidate.content_hash) {
      throw new ApiError(409, "ASSET_INTEGRITY_MISMATCH", "The uploaded asset changed after validation and cannot be published.");
    }
    let inspection;
    try { inspection = inspectAsset(candidate.original_name, stored.body); }
    catch { throw new ApiError(409, "ASSET_REVALIDATION_FAILED", "The asset failed revalidation and cannot be published."); }
    if (inspection.contentHash !== candidate.content_hash || inspection.sizeBytes !== Number(candidate.size_bytes)) {
      throw new ApiError(409, "ASSET_REVALIDATION_FAILED", "The asset no longer matches its validated metadata.");
    }
  }

  const timestamp = nowIso();
  const toStatus = decision === "approve" ? "published" : "rejected";
  await transaction(async (tx) => {
    if (tx.dialect === "postgres") await tx.query(`SELECT id FROM assets WHERE id = ? FOR UPDATE`, [assetId]);
    const current = await tx.query<AssetStoreRow>(`SELECT ${selectStoreColumns} FROM assets WHERE id = ? AND deleted_at IS NULL LIMIT 1`, [assetId]);
    if (!current[0] || current[0].publication_status !== "pending_review") throw new ApiError(409, "ASSET_SUBMISSION_CHANGED", "The asset submission was already handled.");
    const changed = await tx.execute(
      `UPDATE assets SET publication_status = ?, published_at = ?, reviewed_at = ?, reviewer_id = ?, moderation_note = ?, updated_at = ?
       WHERE id = ? AND publication_status = 'pending_review' AND deleted_at IS NULL`,
      [toStatus, decision === "approve" ? timestamp : null, timestamp, actorId, normalizedNote, timestamp, assetId],
    );
    if (!changed) throw new ApiError(409, "ASSET_SUBMISSION_CHANGED", "The asset submission was already handled.");
    await insertModerationEvent(tx, { assetId, actorId, action: decision === "approve" ? "approved" : "rejected", fromStatus: "pending_review", toStatus, note: normalizedNote, createdAt: timestamp });
  });
  await logAudit(actorId, `asset.store.${decision}`, "asset", assetId, { note: normalizedNote });
  return { status: toStatus };
}

export async function listPublicStoreAssets(options: { category?: "image" | "model" | "audio"; search?: string } = {}): Promise<PublicAssetStoreItem[]> {
  const conditions = [
    "a.publication_status = 'published'", "a.upload_status = 'ready'", "a.validation_state = 'valid_compatible'",
    "a.rights_confirmed = 1", "a.download_authorized = 1", "a.rights_declaration_at IS NOT NULL", "TRIM(a.attribution) <> ''", "a.deleted_at IS NULL", "u.account_status = 'active'",
    `a.license IN (${licenseIds.map(() => "?").join(", ")})`,
    `a.rights_basis IN (${ASSET_RIGHTS_BASES.map(() => "?").join(", ")})`,
  ];
  const params: (string | number)[] = [...licenseIds, ...ASSET_RIGHTS_BASES];
  if (options.category) { conditions.push("a.category = ?"); params.push(options.category); }
  const search = options.search?.trim().replace(/[%_]/g, " ").slice(0, 80) ?? "";
  if (search) {
    const pattern = `%${search.toLowerCase()}%`;
    conditions.push("(LOWER(a.store_title) LIKE ? OR LOWER(a.original_name) LIKE ? OR LOWER(a.public_description) LIKE ?)");
    params.push(pattern, pattern, pattern);
  }
  const rows = await query<AssetStoreRow>(
    `SELECT ${publicStoreSelectColumns}
     FROM assets a JOIN users u ON u.id = a.owner_id
     WHERE ${conditions.join(" AND ")}
     ORDER BY a.published_at DESC, a.id DESC LIMIT 60`, params);
  return rows.filter((row) => isLicense(row.license)).map(mapPublicAsset);
}

export async function getPublicStoreAsset(assetId: string): Promise<AssetStoreRow> {
  const rows = await query<AssetStoreRow>(
    `SELECT ${publicStoreSelectColumns}
     FROM assets a JOIN users u ON u.id = a.owner_id
     WHERE a.id = ? AND a.publication_status = 'published' AND a.upload_status = 'ready'
       AND a.validation_state = 'valid_compatible' AND a.rights_confirmed = 1 AND a.download_authorized = 1
       AND a.rights_declaration_at IS NOT NULL AND TRIM(a.attribution) <> ''
       AND a.rights_basis IN ('created_by_me', 'licensed_for_redistribution', 'public_domain')
       AND a.license IN (${licenseIds.map(() => "?").join(", ")}) AND a.deleted_at IS NULL AND u.account_status = 'active' LIMIT 1`,
    [assetId, ...licenseIds],
  );
  const asset = rows[0];
  if (!asset || !isLicense(asset.license)) throw new ApiError(404, "ASSET_NOT_FOUND", "That public asset is not available.");
  return asset;
}
