import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { closeDatabase, execute, newId, nowIso, query } from "@/lib/db";

const cleanupState = vi.hoisted(() => ({ failKeys: [] as string[] }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/asset-storage", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/asset-storage")>();
  return {
    ...actual,
    deletePrivateAssetObject: vi.fn(async (key: string) => {
      if (cleanupState.failKeys.includes(key)) throw new Error("simulated temporary delete failure");
      return actual.deletePrivateAssetObject(key);
    }),
  };
});

import { cleanupExpiredAssetUploads, createAssetUploadIntent, deletePrivateAsset, getPrivateAsset, listPrivateAssets, uploadLocalAssetBytes } from "@/lib/asset-service";
import { ApiError } from "@/lib/http";
import { getObject, putObject } from "@/lib/storage";

const mutableEnv = process.env as unknown as Record<string, string | undefined>;
const oldDatabaseUrl = mutableEnv.DATABASE_URL;
const oldAssetQuota = mutableEnv.ASSET_USER_QUOTA_BYTES;
const oldAssetLimit = mutableEnv.ASSET_MAX_PER_USER;
const databaseUrl = `file:.gameforge-local/assets-${process.pid}.sqlite`;
const png = new Uint8Array(Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/iZk9HQAAAABJRU5ErkJggg==", "base64"));
let userCounter = 0;

beforeAll(() => {
  mutableEnv.DATABASE_URL = databaseUrl;
  delete mutableEnv.S3_BUCKET;
  delete mutableEnv.S3_REGION;
  delete mutableEnv.S3_ACCESS_KEY_ID;
  delete mutableEnv.S3_SECRET_ACCESS_KEY;
});
afterAll(async () => {
  await closeDatabase();
  if (oldDatabaseUrl === undefined) delete mutableEnv.DATABASE_URL; else mutableEnv.DATABASE_URL = oldDatabaseUrl;
  if (oldAssetQuota === undefined) delete mutableEnv.ASSET_USER_QUOTA_BYTES; else mutableEnv.ASSET_USER_QUOTA_BYTES = oldAssetQuota;
  if (oldAssetLimit === undefined) delete mutableEnv.ASSET_MAX_PER_USER; else mutableEnv.ASSET_MAX_PER_USER = oldAssetLimit;
});

async function createUser() {
  userCounter += 1;
  const id = newId();
  const timestamp = nowIso();
  await execute(
    `INSERT INTO users(id, username, display_name, email, password_hash, role, account_status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, 'user', 'active', ?, ?)`,
    [id, `asset_test_${userCounter}_${id.slice(0, 6)}`, "Asset Test", `${id}@assets.invalid`, "test-hash", timestamp, timestamp],
  );
  return id;
}

describe("private asset upload service", () => {
  it("creates local upload intents, validates content, scopes listings, and deletes only for the owner", async () => {
    const owner = await createUser();
    const other = await createUser();
    const intent = await createAssetUploadIntent(owner, "tiny.png", png.byteLength);
    expect(intent).toMatchObject({ method: "PUT", storageMode: "local", assetId: expect.any(String) });

    const saved = await uploadLocalAssetBytes(owner, intent.assetId, png);
    expect(saved).toMatchObject({ filename: "tiny.png", format: "PNG", category: "image", sizeBytes: png.byteLength, validationState: "valid_compatible" });
    expect(await listPrivateAssets(owner)).toHaveLength(1);
    expect(await listPrivateAssets(other)).toHaveLength(0);
    await expect(getPrivateAsset(other, saved.id)).rejects.toMatchObject({ code: "ASSET_NOT_FOUND", status: 404 });
    await expect(deletePrivateAsset(other, saved.id)).rejects.toMatchObject({ code: "ASSET_NOT_FOUND", status: 404 });
    const privateRecord = await getPrivateAsset(owner, saved.id);
    const replay = new Uint8Array(png);
    replay[0] = 0;
    await putObject(`assets/pending/${owner}/${saved.id}`, replay, "application/octet-stream", "private, no-store, max-age=0");
    expect(new Uint8Array((await getObject(privateRecord.storageKey)).body)).toEqual(png);
    await deletePrivateAsset(owner, saved.id);
    expect(await listPrivateAssets(owner)).toHaveLength(0);
  });

  it("closes an upload whose declared size differs from its body", async () => {
    const owner = await createUser();
    const intent = await createAssetUploadIntent(owner, "size-check.png", png.byteLength + 1);
    await expect(uploadLocalAssetBytes(owner, intent.assetId, png)).rejects.toMatchObject({ code: "ASSET_SIZE_MISMATCH", status: 400 });
    const row = await query<{ upload_status: string; validation_state: string }>(`SELECT upload_status, validation_state FROM assets WHERE id = ?`, [intent.assetId]);
    expect(row[0]).toEqual({ upload_status: "failed", validation_state: "size_mismatch" });
  });

  it("rejects invalid bytes and never lists the failed upload as a private asset", async () => {
    const owner = await createUser();
    const intent = await createAssetUploadIntent(owner, "spoofed.png", png.byteLength);
    const spoofed = new Uint8Array(png);
    spoofed[0] = 0;
    await expect(uploadLocalAssetBytes(owner, intent.assetId, spoofed)).rejects.toBeInstanceOf(ApiError);
    const row = await query<{ upload_status: string; validation_state: string }>(`SELECT upload_status, validation_state FROM assets WHERE id = ?`, [intent.assetId]);
    expect(row[0]).toMatchObject({ upload_status: "failed", validation_state: "asset_invalid" });
    expect(await listPrivateAssets(owner)).toHaveLength(0);
  });

  it("reserves storage and count quotas before creating another active intent", async () => {
    const owner = await createUser();
    mutableEnv.ASSET_USER_QUOTA_BYTES = String(png.byteLength);
    mutableEnv.ASSET_MAX_PER_USER = "1";
    const first = await createAssetUploadIntent(owner, "first.png", png.byteLength);
    await expect(createAssetUploadIntent(owner, "over-quota.png", 1)).rejects.toMatchObject({ code: "ASSET_COUNT_QUOTA", status: 413 });
    await execute(`UPDATE assets SET deleted_at = ?, upload_status = 'failed', updated_at = ? WHERE id = ?`, [nowIso(), nowIso(), first.assetId]);
    mutableEnv.ASSET_MAX_PER_USER = oldAssetLimit;
    await expect(createAssetUploadIntent(owner, "over-by-one.png", png.byteLength + 1)).rejects.toMatchObject({ code: "ASSET_STORAGE_QUOTA", status: 413 });
  });

  it("retries failed deletion of tombstoned private objects with a backoff lease", async () => {
    const owner = await createUser();
    const intent = await createAssetUploadIntent(owner, "retry-delete.png", png.byteLength);
    const saved = await uploadLocalAssetBytes(owner, intent.assetId, png);
    const asset = await getPrivateAsset(owner, saved.id);
    const stagingKey = `assets/pending/${owner}/${saved.id}`;
    cleanupState.failKeys = [asset.storageKey, stagingKey];
    try {
      const deleted = await deletePrivateAsset(owner, saved.id);
      expect(deleted).toMatchObject({ storageCleanupPending: true });
      const firstAttempt = await query<{ asset_storage_cleanup_status: string; asset_storage_cleanup_attempts: number; asset_storage_cleanup_next_attempt_at: string | null }>(
        `SELECT asset_storage_cleanup_status, asset_storage_cleanup_attempts, asset_storage_cleanup_next_attempt_at FROM assets WHERE id = ?`, [saved.id]);
      expect(firstAttempt[0]).toMatchObject({ asset_storage_cleanup_status: "pending", asset_storage_cleanup_attempts: 1 });
      expect(firstAttempt[0]?.asset_storage_cleanup_next_attempt_at).toBeTruthy();
      expect(new Uint8Array((await getObject(asset.storageKey)).body)).toEqual(png);

      cleanupState.failKeys = [];
      await execute(`UPDATE assets SET asset_storage_cleanup_next_attempt_at = ? WHERE id = ?`, [new Date(Date.now() - 60_000).toISOString(), saved.id]);
      const swept = await cleanupExpiredAssetUploads(100);
      expect(swept.cleanupCompleted).toBeGreaterThanOrEqual(1);
      const final = await query<{ asset_storage_cleanup_status: string; asset_storage_cleanup_attempts: number }>(
        `SELECT asset_storage_cleanup_status, asset_storage_cleanup_attempts FROM assets WHERE id = ?`, [saved.id]);
      expect(final[0]).toEqual({ asset_storage_cleanup_status: "complete", asset_storage_cleanup_attempts: 2 });
      await expect(getObject(asset.storageKey)).rejects.toMatchObject({ status: 404 });
    } finally { cleanupState.failKeys = []; }
  });

  it("retries a leftover staging object without deleting a ready private asset", async () => {
    const owner = await createUser();
    const intent = await createAssetUploadIntent(owner, "staging-retry.png", png.byteLength);
    const stagingKey = `assets/pending/${owner}/${intent.assetId}`;
    cleanupState.failKeys = [stagingKey];
    try {
      const saved = await uploadLocalAssetBytes(owner, intent.assetId, png);
      const privateRecord = await getPrivateAsset(owner, saved.id);
      const initial = await query<{ asset_staging_cleanup_status: string; asset_staging_cleanup_attempts: number }>(
        `SELECT asset_staging_cleanup_status, asset_staging_cleanup_attempts FROM assets WHERE id = ?`, [saved.id]);
      expect(initial[0]).toEqual({ asset_staging_cleanup_status: "pending", asset_staging_cleanup_attempts: 0 });
      expect(new Uint8Array((await getObject(privateRecord.storageKey)).body)).toEqual(png);

      cleanupState.failKeys = [];
      await execute(`UPDATE assets SET asset_staging_cleanup_next_attempt_at = ? WHERE id = ?`, [new Date(Date.now() - 60_000).toISOString(), saved.id]);
      const swept = await cleanupExpiredAssetUploads(100);
      expect(swept.stagingCleanupCompleted).toBeGreaterThanOrEqual(1);
      expect(new Uint8Array((await getObject(privateRecord.storageKey)).body)).toEqual(png);
      await expect(getObject(stagingKey)).rejects.toMatchObject({ status: 404 });
    } finally { cleanupState.failKeys = []; }
  });
});
