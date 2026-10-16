import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { closeDatabase, execute, newId, nowIso } from "@/lib/db";
import { getPrivateAsset } from "@/lib/asset-service";
import { putObject } from "@/lib/storage";

const authState = vi.hoisted(() => ({ userId: "" }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth", () => ({
  requireUser: vi.fn(async () => ({ id: authState.userId, username: "asset_route", displayName: "Asset Route", role: "user", avatar: null, bio: "" })),
}));

import { GET as listAssets, POST as createIntent } from "@/app/api/assets/route";
import { PUT as uploadAsset } from "@/app/api/assets/[id]/upload/route";
import { POST as completeUpload } from "@/app/api/assets/[id]/complete/route";
import { GET as getAssetFile } from "@/app/api/assets/[id]/file/route";
import { DELETE as deleteAsset } from "@/app/api/assets/[id]/route";

const mutableEnv = process.env as unknown as Record<string, string | undefined>;
const oldDatabaseUrl = mutableEnv.DATABASE_URL;
const oldSiteUrl = mutableEnv.NEXT_PUBLIC_SITE_URL;
const databaseUrl = `file:.gameforge-local/asset-routes-${process.pid}.sqlite`;
const png = new Uint8Array(Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/iZk9HQAAAABJRU5ErkJggg==", "base64"));
let requestNumber = 0;

beforeAll(() => {
  mutableEnv.DATABASE_URL = databaseUrl;
  mutableEnv.NEXT_PUBLIC_SITE_URL = "http://localhost:3000";
  for (const name of ["S3_BUCKET", "S3_REGION", "S3_ACCESS_KEY_ID", "S3_SECRET_ACCESS_KEY"]) delete mutableEnv[name];
});
afterAll(async () => {
  await closeDatabase();
  if (oldDatabaseUrl === undefined) delete mutableEnv.DATABASE_URL; else mutableEnv.DATABASE_URL = oldDatabaseUrl;
  if (oldSiteUrl === undefined) delete mutableEnv.NEXT_PUBLIC_SITE_URL; else mutableEnv.NEXT_PUBLIC_SITE_URL = oldSiteUrl;
});

async function createUser(username: string) {
  const id = newId();
  const timestamp = nowIso();
  await execute(
    `INSERT INTO users(id, username, display_name, email, password_hash, role, account_status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, 'user', 'active', ?, ?)`,
    [id, username, username, `${id}@route-assets.invalid`, "test-hash", timestamp, timestamp],
  );
  return id;
}

function headers(origin = "http://localhost:3000") {
  requestNumber += 1;
  return { origin, "x-forwarded-for": `198.51.100.${(requestNumber % 200) + 1}` };
}

describe("private asset API routes", () => {
  it("uploads, validates, lists, serves, and deletes an owner-scoped file without public caching", async () => {
    const owner = await createUser("asset_route_owner");
    const other = await createUser("asset_route_other");
    authState.userId = owner;

    const intentResponse = await createIntent(new Request("http://localhost:3000/api/assets", {
      method: "POST", headers: { ...headers(), "content-type": "application/json" },
      body: JSON.stringify({ filename: "route-test.png", size: png.byteLength }),
    }));
    expect(intentResponse.status).toBe(201);
    const intent = await intentResponse.json() as { assetId: string; uploadUrl: string; method: string; storageMode: string };
    expect(intent).toMatchObject({ method: "PUT", storageMode: "local" });

    const uploadResponse = await uploadAsset(new Request(`http://localhost:3000${intent.uploadUrl}`, {
      method: "PUT", headers: { ...headers(), "content-type": "application/octet-stream" }, body: png,
    }), { params: Promise.resolve({ id: intent.assetId }) });
    expect(uploadResponse.status).toBe(200);

    const completeResponse = await completeUpload(new Request(`http://localhost:3000/api/assets/${intent.assetId}/complete`, { method: "POST", headers: headers() }), { params: Promise.resolve({ id: intent.assetId }) });
    expect(completeResponse.status).toBe(200);
    const completed = await completeResponse.json() as { asset: { id: string; previewUrl: string; validationState: string } };
    expect(completed.asset).toMatchObject({ id: intent.assetId, validationState: "valid_compatible", previewUrl: `/api/assets/${intent.assetId}/file` });

    const listResponse = await listAssets();
    const listing = await listResponse.json() as { assets: Array<{ id: string }> };
    expect(listing.assets.map((asset) => asset.id)).toContain(intent.assetId);

    const fileResponse = await getAssetFile(new Request(`http://localhost:3000${completed.asset.previewUrl}`), { params: Promise.resolve({ id: intent.assetId }) });
    expect(fileResponse.status).toBe(200);
    expect(fileResponse.headers.get("content-type")).toBe("image/png");
    expect(fileResponse.headers.get("cache-control")).toBe("private, no-store, max-age=0");
    expect(fileResponse.headers.get("x-content-type-options")).toBe("nosniff");
    expect(new Uint8Array(await fileResponse.arrayBuffer())).toEqual(png);
    const privateAsset = await getPrivateAsset(owner, intent.assetId);
    const tampered = new Uint8Array(png);
    tampered[0] = 0;
    await putObject(privateAsset.storageKey, tampered, "image/png", "private, no-store, max-age=0");
    const integrityResponse = await getAssetFile(new Request(`http://localhost:3000${completed.asset.previewUrl}`), { params: Promise.resolve({ id: intent.assetId }) });
    expect(integrityResponse.status).toBe(409);
    await putObject(privateAsset.storageKey, png, "image/png", "private, no-store, max-age=0");

    authState.userId = other;
    const deniedFile = await getAssetFile(new Request(`http://localhost:3000${completed.asset.previewUrl}`), { params: Promise.resolve({ id: intent.assetId }) });
    expect(deniedFile.status).toBe(404);
    const deniedDelete = await deleteAsset(new Request(`http://localhost:3000/api/assets/${intent.assetId}`, { method: "DELETE", headers: headers() }), { params: Promise.resolve({ id: intent.assetId }) });
    expect(deniedDelete.status).toBe(404);

    authState.userId = owner;
    const deleteResponse = await deleteAsset(new Request(`http://localhost:3000/api/assets/${intent.assetId}`, { method: "DELETE", headers: headers() }), { params: Promise.resolve({ id: intent.assetId }) });
    expect(deleteResponse.status).toBe(200);
    expect(await deleteResponse.json()).toMatchObject({ ok: true, storageCleanupPending: false });
    expect((await (await listAssets()).json() as { assets: Array<{ id: string }> }).assets).toHaveLength(0);
  });

  it("rejects cross-origin writes before creating an upload intent", async () => {
    const user = await createUser("asset_csrf_test");
    authState.userId = user;
    const response = await createIntent(new Request("http://localhost:3000/api/assets", {
      method: "POST", headers: { ...headers("https://attacker.invalid"), "content-type": "application/json" },
      body: JSON.stringify({ filename: "evil.png", size: png.byteLength }),
    }));
    expect(response.status).toBe(403);
  });
});
