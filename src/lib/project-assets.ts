import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { ApiError } from "@/lib/http";
import { execute, newId, nowIso, query, transaction, type DatabaseTransaction } from "@/lib/db";
import { validateAiProject } from "@/lib/ai/validate";
import { extractPrivateAssetReferences } from "@/lib/asset-references";
import type { ProjectFile } from "@/lib/zip";

export const MAX_PROJECT_ASSET_BINDINGS = 20;
export const PROJECT_PREVIEW_GRANT_TTL_SECONDS = 15 * 60;
const MAX_PROJECT_VERSIONS = 100;

type BindingRow = {
  asset_id: string;
  original_name: string;
  format: string;
  category: "image" | "model" | "audio";
  mime_type: string;
  size_bytes: number;
  content_hash: string;
  storage_key: string;
  created_at: string;
};

export type ProjectAssetBinding = {
  assetId: string;
  filename: string;
  format: string;
  category: "image" | "model" | "audio";
  sizeBytes: number;
  placeholder: string;
  createdAt: string;
};

export type BoundProjectAssetRecord = ProjectAssetBinding & {
  mimeType: string;
  contentHash: string;
  storageKey: string;
};

function toSummary(row: BindingRow): BoundProjectAssetRecord {
  return {
    assetId: row.asset_id,
    filename: row.original_name,
    format: row.format,
    category: row.category,
    sizeBytes: Number(row.size_bytes),
    placeholder: `gameforge-asset://${row.asset_id}`,
    createdAt: row.created_at,
    mimeType: row.mime_type,
    contentHash: row.content_hash,
    storageKey: row.storage_key,
  };
}

function publicSummary(row: BoundProjectAssetRecord): ProjectAssetBinding {
  return {
    assetId: row.assetId,
    filename: row.filename,
    format: row.format,
    category: row.category,
    sizeBytes: row.sizeBytes,
    placeholder: row.placeholder,
    createdAt: row.createdAt,
  };
}

function safeVersionLimit(): number {
  const value = Number(process.env.MAX_AI_VERSIONS ?? 20);
  return Number.isInteger(value) && value > 0 ? Math.min(value, MAX_PROJECT_VERSIONS) : 20;
}

async function assertOwnedDraftProject(tx: DatabaseTransaction, ownerId: string, projectId: string): Promise<void> {
  const rows = await tx.query<{ status: string }>(`SELECT status FROM ai_projects WHERE id = ? AND owner_id = ? LIMIT 1`, [projectId, ownerId]);
  if (!rows[0]) throw new ApiError(404, "PROJECT_NOT_FOUND", "That project is not in your account.");
  if (rows[0].status === "removed") throw new ApiError(409, "CONTENT_REMOVED", "This project was removed and cannot be changed.");
  if (rows[0].status !== "draft") throw new ApiError(409, "PROJECT_NOT_EDITABLE", "Only a private draft can change its asset bindings.");
}

async function activeBindingIds(
  tx: DatabaseTransaction,
  ownerId: string,
  projectId: string,
  versionNumber: number,
): Promise<string[]> {
  const rows = await tx.query<{ asset_id: string }>(
    `SELECT b.asset_id FROM project_asset_bindings b
     JOIN assets a ON a.id = b.asset_id AND a.owner_id = b.owner_id
     WHERE b.owner_id = ? AND b.project_id = ? AND b.version_number = ?
       AND a.upload_status = 'ready' AND a.publication_status = 'private' AND a.deleted_at IS NULL
     ORDER BY b.created_at, b.asset_id`,
    [ownerId, projectId, versionNumber],
  );
  return rows.map((row) => row.asset_id);
}

export async function bindPrivateAssetsToVersionInTransaction(
  tx: DatabaseTransaction,
  ownerId: string,
  projectId: string,
  versionNumber: number,
  assetIds: string[],
): Promise<void> {
  const distinctIds = [...new Set(assetIds.map((id) => id.toLowerCase()))];
  if (distinctIds.length > MAX_PROJECT_ASSET_BINDINGS) {
    throw new ApiError(413, "PROJECT_ASSET_LIMIT", `A project version can bind at most ${MAX_PROJECT_ASSET_BINDINGS} private assets.`);
  }
  const versionRows = await tx.query<{ validation_status: string }>(
    `SELECT v.validation_status FROM ai_project_versions v
     JOIN ai_projects p ON p.id = v.project_id
     WHERE v.project_id = ? AND v.version_number = ? AND p.owner_id = ? LIMIT 1`,
    [projectId, versionNumber, ownerId],
  );
  if (!versionRows[0] || versionRows[0].validation_status !== "validated") {
    throw new ApiError(409, "VERSION_NOT_FOUND", "The project version is not available for asset binding.");
  }
  for (const assetId of distinctIds) {
    const assets = await tx.query<{ id: string }>(
      `SELECT id FROM assets WHERE id = ? AND owner_id = ? AND upload_status = 'ready'
       AND publication_status = 'private' AND deleted_at IS NULL LIMIT 1`,
      [assetId, ownerId],
    );
    if (!assets[0]) throw new ApiError(404, "ASSET_NOT_FOUND", "One or more selected private assets could not be found.");
    await tx.execute(
      `INSERT INTO project_asset_bindings(project_id, version_number, owner_id, asset_id, created_at)
       VALUES (?, ?, ?, ?, ?) ON CONFLICT(project_id, version_number, asset_id) DO NOTHING`,
      [projectId, versionNumber, ownerId, assetId, nowIso()],
    );
  }
}

export async function copyProjectVersionAssetBindingsInTransaction(
  tx: DatabaseTransaction,
  ownerId: string,
  projectId: string,
  sourceVersion: number,
  targetVersion: number,
): Promise<void> {
  const ids = await activeBindingIds(tx, ownerId, projectId, sourceVersion);
  await bindPrivateAssetsToVersionInTransaction(tx, ownerId, projectId, targetVersion, ids);
}

export async function bindPrivateAssetsToVersion(
  ownerId: string,
  projectId: string,
  versionNumber: number,
  assetIds: string[],
): Promise<void> {
  await transaction(async (tx) => {
    await assertOwnedDraftProject(tx, ownerId, projectId);
    await bindPrivateAssetsToVersionInTransaction(tx, ownerId, projectId, versionNumber, assetIds);
  });
}

export async function getProjectVersionAssetIds(ownerId: string, projectId: string, versionNumber: number): Promise<string[]> {
  const rows = await query<{ asset_id: string }>(
    `SELECT b.asset_id FROM project_asset_bindings b
     JOIN ai_projects p ON p.id = b.project_id AND p.owner_id = b.owner_id
     JOIN assets a ON a.id = b.asset_id AND a.owner_id = b.owner_id
     WHERE b.owner_id = ? AND b.project_id = ? AND b.version_number = ?
       AND a.upload_status = 'ready' AND a.publication_status = 'private' AND a.deleted_at IS NULL
     ORDER BY b.created_at, b.asset_id`,
    [ownerId, projectId, versionNumber],
  );
  return rows.map((row) => row.asset_id);
}

export async function getProjectAssetBindings(
  ownerId: string,
  projectId: string,
  versionNumber?: number,
): Promise<{ version: number; bindings: ProjectAssetBinding[] }> {
  const projects = await query<{ owner_id: string }>(`SELECT owner_id FROM ai_projects WHERE id = ? LIMIT 1`, [projectId]);
  if (!projects[0] || projects[0].owner_id !== ownerId) throw new ApiError(404, "PROJECT_NOT_FOUND", "That project is not in your account.");
  let version = versionNumber;
  if (version === undefined) {
    const latest = await query<{ version_number: number }>(`SELECT version_number FROM ai_project_versions WHERE project_id = ? ORDER BY version_number DESC LIMIT 1`, [projectId]);
    version = Number(latest[0]?.version_number ?? 0);
  }
  if (!Number.isInteger(version) || version < 1) return { version: 0, bindings: [] };
  const rows = await query<BindingRow>(
    `SELECT b.asset_id, a.original_name, a.format, a.category, a.mime_type, a.size_bytes, a.content_hash, a.storage_key, b.created_at
     FROM project_asset_bindings b
     JOIN ai_projects p ON p.id = b.project_id AND p.owner_id = b.owner_id
     JOIN assets a ON a.id = b.asset_id AND a.owner_id = b.owner_id
     WHERE b.owner_id = ? AND b.project_id = ? AND b.version_number = ?
       AND a.upload_status = 'ready' AND a.publication_status = 'private' AND a.deleted_at IS NULL
     ORDER BY b.created_at, b.asset_id`,
    [ownerId, projectId, version],
  );
  return { version, bindings: rows.map(toSummary).map(publicSummary) };
}

export async function getOwnedProjectAssetRecords(
  ownerId: string,
  projectId: string,
  versionNumber: number,
): Promise<BoundProjectAssetRecord[]> {
  const rows = await query<BindingRow>(
    `SELECT b.asset_id, a.original_name, a.format, a.category, a.mime_type, a.size_bytes, a.content_hash, a.storage_key, b.created_at
     FROM project_asset_bindings b
     JOIN ai_projects p ON p.id = b.project_id AND p.owner_id = b.owner_id
     JOIN assets a ON a.id = b.asset_id AND a.owner_id = b.owner_id
     WHERE b.owner_id = ? AND p.owner_id = ? AND b.project_id = ? AND b.version_number = ?
       AND a.upload_status = 'ready' AND a.publication_status = 'private' AND a.deleted_at IS NULL
     ORDER BY b.created_at, b.asset_id`,
    [ownerId, ownerId, projectId, versionNumber],
  );
  return rows.map(toSummary);
}

export async function getBoundProjectAssetForPreview(
  ownerId: string,
  projectId: string,
  versionNumber: number,
  assetId: string,
): Promise<BoundProjectAssetRecord> {
  const rows = await query<BindingRow>(
    `SELECT b.asset_id, a.original_name, a.format, a.category, a.mime_type, a.size_bytes, a.content_hash, a.storage_key, b.created_at
     FROM project_asset_bindings b
     JOIN ai_projects p ON p.id = b.project_id AND p.owner_id = b.owner_id
     JOIN assets a ON a.id = b.asset_id AND a.owner_id = b.owner_id
     WHERE b.owner_id = ? AND p.owner_id = ? AND b.project_id = ? AND b.version_number = ? AND b.asset_id = ?
       AND a.upload_status = 'ready' AND a.publication_status = 'private' AND a.deleted_at IS NULL LIMIT 1`,
    [ownerId, ownerId, projectId, versionNumber, assetId],
  );
  if (!rows[0]) throw new ApiError(404, "PROJECT_ASSET_NOT_FOUND", "That asset is not bound to this project version.");
  return toSummary(rows[0]);
}

export async function changeProjectAssetBindings(
  ownerId: string,
  projectId: string,
  expectedVersion: number,
  assetIds: string[],
  operation: "bind" | "unbind",
): Promise<{ version: number; files: ProjectFile[]; changed: boolean; bindings: ProjectAssetBinding[] }> {
  const distinctIds = [...new Set(assetIds.map((id) => id.toLowerCase()))];
  if (!distinctIds.length || distinctIds.length > MAX_PROJECT_ASSET_BINDINGS) {
    throw new ApiError(400, "INVALID_ASSET_BINDING", `Select between 1 and ${MAX_PROJECT_ASSET_BINDINGS} assets.`);
  }
  const result = await transaction(async (tx) => {
    if (tx.dialect === "postgres") await tx.query(`SELECT id FROM ai_projects WHERE id = ? AND owner_id = ? FOR UPDATE`, [projectId, ownerId]);
    await assertOwnedDraftProject(tx, ownerId, projectId);
    const latest = await tx.query<{
      version_number: number;
      manifest_json: string;
      provider: string;
      model: string;
      validation_status: string;
    }>(
      `SELECT version_number, manifest_json, provider, model, validation_status
       FROM ai_project_versions WHERE project_id = ? ORDER BY version_number DESC LIMIT 1`, [projectId]);
    if (!latest[0] || latest[0].validation_status !== "validated") throw new ApiError(409, "VERSION_NOT_FOUND", "This project has no validated version to bind assets to.");
    const currentVersion = Number(latest[0].version_number);
    if (currentVersion !== expectedVersion) throw new ApiError(409, "PROJECT_VERSION_CHANGED", "This project changed in another tab. Refresh it before changing asset bindings.");
    let files: ProjectFile[];
    try { files = validateAiProject(JSON.parse(latest[0].manifest_json)); }
    catch { throw new ApiError(409, "VERSION_INVALID", "This project version failed validation and was not changed."); }
    const currentIds = await activeBindingIds(tx, ownerId, projectId, currentVersion);
    let nextIds: string[];
    if (operation === "bind") {
      for (const assetId of distinctIds) {
        const rows = await tx.query<{ id: string }>(
          `SELECT id FROM assets WHERE id = ? AND owner_id = ? AND upload_status = 'ready'
           AND publication_status = 'private' AND deleted_at IS NULL LIMIT 1`, [assetId, ownerId]);
        if (!rows[0]) throw new ApiError(404, "ASSET_NOT_FOUND", "One or more selected private assets could not be found.");
      }
      nextIds = [...new Set([...currentIds, ...distinctIds])];
    } else {
      nextIds = currentIds.filter((id) => !distinctIds.includes(id));
    }
    if (nextIds.length > MAX_PROJECT_ASSET_BINDINGS) throw new ApiError(413, "PROJECT_ASSET_LIMIT", `A project version can bind at most ${MAX_PROJECT_ASSET_BINDINGS} private assets.`);
    if (nextIds.length === currentIds.length && currentIds.every((id) => nextIds.includes(id))) {
      return { version: currentVersion, files, changed: false };
    }
    const nextVersion = currentVersion + 1;
    if (nextVersion > safeVersionLimit()) throw new ApiError(409, "VERSION_LIMIT_REACHED", `This project has reached its ${safeVersionLimit()}-version history limit.`);
    const timestamp = nowIso();
    await tx.execute(
      `INSERT INTO ai_project_versions(id, project_id, version_number, prompt_summary, provider, model, manifest_json, validation_status, change_summary, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'validated', ?, ?)`,
      [newId(), projectId, nextVersion, `Asset binding ${operation}`, latest[0].provider, latest[0].model,
        JSON.stringify(files), operation === "bind" ? "Bound private assets to a new project version." : "Removed private asset bindings in a new project version.", timestamp],
    );
    await bindPrivateAssetsToVersionInTransaction(tx, ownerId, projectId, nextVersion, nextIds);
    await tx.execute(`UPDATE ai_projects SET visibility = 'private', status = 'draft', updated_at = ? WHERE id = ? AND owner_id = ?`, [timestamp, projectId, ownerId]);
    return { version: nextVersion, files, changed: true };
  });
  const listed = await getProjectAssetBindings(ownerId, projectId, result.version);
  return { ...result, bindings: listed.bindings };
}

export async function createProjectPreviewSession(
  ownerId: string,
  projectId: string,
  versionNumber: number,
): Promise<{ hasPrivateAssets: boolean; token?: string; expiresAt?: string; expiresInSeconds?: number }> {
  const rows = await query<{
    owner_id: string;
    project_status: string;
    manifest_json: string;
    validation_status: string;
  }>(
    `SELECT p.owner_id, p.status AS project_status, v.manifest_json, v.validation_status FROM ai_projects p
     JOIN ai_project_versions v ON v.project_id = p.id
     WHERE p.id = ? AND p.owner_id = ? AND v.version_number = ? LIMIT 1`,
    [projectId, ownerId, versionNumber],
  );
  if (!rows[0] || rows[0].validation_status !== "validated") throw new ApiError(404, "VERSION_NOT_FOUND", "That project version is not available for preview.");
  if (rows[0].project_status === "removed") throw new ApiError(409, "CONTENT_REMOVED", "This project was removed and can no longer be previewed.");
  let files: ProjectFile[];
  try { files = validateAiProject(JSON.parse(rows[0].manifest_json)); }
  catch { throw new ApiError(409, "VERSION_INVALID", "This project version is not available for preview."); }
  const refs = [...new Set(files.flatMap((file) => extractPrivateAssetReferences(file.content)))];
  const boundIds = await getProjectVersionAssetIds(ownerId, projectId, versionNumber);
  const missing = refs.filter((assetId) => !boundIds.includes(assetId));
  if (missing.length) throw new ApiError(409, "ASSET_REFERENCE_UNBOUND", "This version references a private asset that is not bound to it. Bind the asset or remove the placeholder before previewing.");
  if (!boundIds.length) return { hasPrivateAssets: false };

  const token = randomBytes(32).toString("base64url");
  const createdAt = nowIso();
  const expiresAt = new Date(Date.now() + PROJECT_PREVIEW_GRANT_TTL_SECONDS * 1000).toISOString();
  await execute(`DELETE FROM project_preview_grants WHERE expires_at <= ?`, [createdAt]);
  await execute(
    `INSERT INTO project_preview_grants(id, project_id, version_number, owner_id, token_hash, expires_at, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [newId(), projectId, versionNumber, ownerId, createHash("sha256").update(token).digest("hex"), expiresAt, createdAt],
  );
  return { hasPrivateAssets: true, token, expiresAt, expiresInSeconds: PROJECT_PREVIEW_GRANT_TTL_SECONDS };
}

export async function resolveProjectPreviewGrant(
  projectId: string,
  versionNumber: number,
  token: string,
): Promise<{ ownerId: string }> {
  if (!/^[A-Za-z0-9_-]{43}$/.test(token)) throw new ApiError(404, "PREVIEW_SESSION_NOT_FOUND", "This private preview session is no longer available.");
  const tokenHash = createHash("sha256").update(token).digest("hex");
  const rows = await query<{ owner_id: string }>(
    `SELECT g.owner_id FROM project_preview_grants g
     JOIN ai_projects p ON p.id = g.project_id AND p.owner_id = g.owner_id
     JOIN ai_project_versions v ON v.project_id = g.project_id AND v.version_number = g.version_number
     WHERE g.project_id = ? AND g.version_number = ? AND g.token_hash = ? AND g.expires_at > ?
       AND v.validation_status = 'validated' AND p.status <> 'removed' LIMIT 1`,
    [projectId, versionNumber, tokenHash, nowIso()],
  );
  if (!rows[0]) throw new ApiError(404, "PREVIEW_SESSION_NOT_FOUND", "This private preview session is no longer available.");
  return { ownerId: rows[0].owner_id };
}

export async function isPrivateAssetBoundToProjectVersion(
  ownerId: string,
  projectId: string,
  versionNumber: number,
  assetId: string,
): Promise<boolean> {
  const rows = await query<{ asset_id: string }>(
    `SELECT b.asset_id FROM project_asset_bindings b
     JOIN ai_projects p ON p.id = b.project_id AND p.owner_id = b.owner_id
     JOIN assets a ON a.id = b.asset_id AND a.owner_id = b.owner_id
     WHERE b.owner_id = ? AND p.owner_id = ? AND b.project_id = ? AND b.version_number = ? AND b.asset_id = ?
       AND a.upload_status = 'ready' AND a.publication_status = 'private' AND a.deleted_at IS NULL LIMIT 1`,
    [ownerId, ownerId, projectId, versionNumber, assetId],
  );
  return Boolean(rows[0]);
}
