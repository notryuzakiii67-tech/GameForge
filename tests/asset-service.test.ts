import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { closeDatabase, execute, newId, nowIso, query } from "@/lib/db";

vi.mock("server-only", () => ({}));

import { createAssetUploadIntent, deletePrivateAsset, getPrivateAsset, listPrivateAssets, uploadLocalAssetBytes } from "@/lib/asset-service";
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
});
