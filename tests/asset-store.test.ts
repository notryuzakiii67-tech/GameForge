import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { closeDatabase, execute, newId, nowIso } from "@/lib/db";
import { getPrivateAsset } from "@/lib/asset-service";
import { putObject } from "@/lib/storage";

const authState = vi.hoisted(() => ({ userId: "", adminId: "" }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth", () => ({
  requireUser: vi.fn(async () => ({ id: authState.userId, username: "store_user", displayName: "Store User", role: "user", avatar: null, bio: "" })),
  requireAdmin: vi.fn(async () => ({ id: authState.adminId, username: "store_admin", displayName: "Store Admin", role: "admin", avatar: null, bio: "" })),
}));

import { POST as createIntent } from "@/app/api/assets/route";
import { PUT as uploadAsset } from "@/app/api/assets/[id]/upload/route";
import { POST as completeUpload } from "@/app/api/assets/[id]/complete/route";
import { POST as submitForStore, DELETE as withdrawFromStore } from "@/app/api/assets/[id]/store/route";
import { GET as publicListing } from "@/app/api/asset-store/route";
import { GET as publicDownload } from "@/app/api/asset-store/[id]/download/route";
import { GET as adminReviewDownload } from "@/app/api/admin/assets/[id]/download/route";
import { GET as adminQueue } from "@/app/api/admin/queue/route";
import { POST as assetDecision } from "@/app/api/admin/assets/[id]/decision/route";
import { POST as createReport } from "@/app/api/reports/route";
import { POST as reportDecision } from "@/app/api/admin/reports/[id]/decision/route";
import { query } from "@/lib/db";

const mutableEnv = process.env as unknown as Record<string, string | undefined>;
const previousDatabaseUrl = mutableEnv.DATABASE_URL;
const previousSiteUrl = mutableEnv.NEXT_PUBLIC_SITE_URL;
const databaseUrl = `file:.gameforge-local/asset-store-${process.pid}.sqlite`;
const png = new Uint8Array(Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/iZk9HQAAAABJRU5ErkJggg==", "base64"));
let requestNumber = 0;

beforeAll(() => {
  mutableEnv.DATABASE_URL = databaseUrl;
  mutableEnv.NEXT_PUBLIC_SITE_URL = "http://localhost:3000";
  for (const name of ["S3_BUCKET", "S3_REGION", "S3_ACCESS_KEY_ID", "S3_SECRET_ACCESS_KEY"]) delete mutableEnv[name];
});
afterAll(async () => {
  await closeDatabase();
  if (previousDatabaseUrl === undefined) delete mutableEnv.DATABASE_URL; else mutableEnv.DATABASE_URL = previousDatabaseUrl;
  if (previousSiteUrl === undefined) delete mutableEnv.NEXT_PUBLIC_SITE_URL; else mutableEnv.NEXT_PUBLIC_SITE_URL = previousSiteUrl;
});

async function createUser(username: string, role = "user") {
  const id = newId();
  const timestamp = nowIso();
  await execute(
    `INSERT INTO users(id, username, display_name, email, password_hash, role, account_status, created_at, updated_at)
     VALUES (?, ?, ?, ?, 'test-hash', ?, 'active', ?, ?)`,
    [id, username, username, `${id}@asset-store.invalid`, role, timestamp, timestamp],
  );
  return id;
}

function headers() {
  requestNumber += 1;
  return { origin: "http://localhost:3000", "x-forwarded-for": `203.0.113.${(requestNumber % 200) + 1}` };
}

async function createValidatedAsset(ownerId: string) {
  authState.userId = ownerId;
  const intentResponse = await createIntent(new Request("http://localhost:3000/api/assets", {
    method: "POST", headers: { ...headers(), "content-type": "application/json" },
    body: JSON.stringify({ filename: "community-sprite.png", size: png.byteLength }),
  }));
  expect(intentResponse.status).toBe(201);
  const intent = await intentResponse.json() as { assetId: string; uploadUrl: string };
  const uploaded = await uploadAsset(new Request(`http://localhost:3000${intent.uploadUrl}`, {
    method: "PUT", headers: { ...headers(), "content-type": "application/octet-stream" }, body: png,
  }), { params: Promise.resolve({ id: intent.assetId }) });
  expect(uploaded.status).toBe(200);
  const completed = await completeUpload(new Request(`http://localhost:3000/api/assets/${intent.assetId}/complete`, {
    method: "POST", headers: headers(),
  }), { params: Promise.resolve({ id: intent.assetId }) });
  expect(completed.status).toBe(200);
  return intent.assetId;
}

const declaration = {
  title: "Community Sprite",
  description: "A small, original sprite for game prototypes.",
  license: "cc-by-4.0",
  attribution: "Artwork created by Store User",
  rightsBasis: "created_by_me",
  rightsConfirmed: true,
  downloadAuthorized: true,
};

async function submit(assetId: string, body: unknown = declaration) {
  return submitForStore(new Request(`http://localhost:3000/api/assets/${assetId}/store`, {
    method: "POST", headers: { ...headers(), "content-type": "application/json" }, body: JSON.stringify(body),
  }), { params: Promise.resolve({ id: assetId }) });
}

async function decideAsset(assetId: string, decision: "approve" | "reject" | "remove", note = "") {
  return assetDecision(new Request(`http://localhost:3000/api/admin/assets/${assetId}/decision`, {
    method: "POST", headers: { ...headers(), "content-type": "application/json" }, body: JSON.stringify({ decision, note }),
  }), { params: Promise.resolve({ id: assetId }) });
}

describe("rights-aware public Asset Store routes", () => {
  it("requires owner declarations and moderator approval, then serves an authorized attachment until withdrawal", async () => {
    const owner = await createUser("store_asset_owner");
    const other = await createUser("store_asset_other");
    const admin = await createUser("store_asset_admin", "admin");
    authState.adminId = admin;
    const assetId = await createValidatedAsset(owner);

    const incomplete = await submit(assetId, { ...declaration, downloadAuthorized: false });
    expect(incomplete.status).toBe(400);
    expect((await publicListing(new Request("http://localhost:3000/api/asset-store"))).status).toBe(200);

    authState.userId = other;
    expect((await submit(assetId)).status).toBe(404);
    authState.userId = owner;
    const submitted = await submit(assetId);
    expect(submitted.status).toBe(202);
    expect(await submitted.json()).toMatchObject({ status: "pending_review" });

    const beforeApproval = await publicListing(new Request("http://localhost:3000/api/asset-store"));
    expect((await beforeApproval.json() as { assets: Array<{ id: string }> }).assets).not.toContainEqual(expect.objectContaining({ id: assetId }));
    expect((await publicDownload(new Request("http://localhost:3000"), { params: Promise.resolve({ id: assetId }) })).status).toBe(404);
    const queue = await adminQueue();
    expect((await queue.json() as { assets: Array<{ id: string; rightsConfirmed: boolean; downloadAuthorized: boolean }> }).assets)
      .toContainEqual(expect.objectContaining({ id: assetId, rightsConfirmed: true, downloadAuthorized: true }));
    const reviewFile = await adminReviewDownload(new Request("http://localhost:3000"), { params: Promise.resolve({ id: assetId }) });
    expect(reviewFile.status).toBe(200);
    expect(reviewFile.headers.get("content-disposition")).toContain("attachment;");
    expect(reviewFile.headers.get("cache-control")).toBe("private, no-store, max-age=0");

    const approved = await decideAsset(assetId, "approve");
    expect(approved.status).toBe(200);
    expect(await approved.json()).toMatchObject({ status: "published" });
    const listing = await publicListing(new Request("http://localhost:3000/api/asset-store?q=community"));
    const assets = (await listing.json() as { assets: Array<{ id: string; license: { id: string }; attribution: string }> }).assets;
    expect(assets.find((asset) => asset.id === assetId)).toMatchObject({ id: assetId, license: { id: "cc-by-4.0" }, attribution: declaration.attribution });

    const downloaded = await publicDownload(new Request("http://localhost:3000"), { params: Promise.resolve({ id: assetId }) });
    expect(downloaded.status).toBe(200);
    expect(downloaded.headers.get("content-type")).toBe("application/octet-stream");
    expect(downloaded.headers.get("content-disposition")).toContain("attachment;");
    expect(downloaded.headers.get("x-content-type-options")).toBe("nosniff");
    expect(downloaded.headers.get("cache-control")).toBe("private, no-store, max-age=0");
    expect(new Uint8Array(await downloaded.arrayBuffer())).toEqual(png);
    const ownedAsset = await getPrivateAsset(owner, assetId);
    const corrupted = new Uint8Array(png);
    corrupted[0] = 0;
    await putObject(ownedAsset.storageKey, corrupted, "image/png", "private, no-store, max-age=0");
    expect((await publicDownload(new Request("http://localhost:3000"), { params: Promise.resolve({ id: assetId }) })).status).toBe(409);
    await putObject(ownedAsset.storageKey, png, "image/png", "private, no-store, max-age=0");

    const withdrawn = await withdrawFromStore(new Request(`http://localhost:3000/api/assets/${assetId}/store`, { method: "DELETE", headers: headers() }), { params: Promise.resolve({ id: assetId }) });
    expect(withdrawn.status).toBe(200);
    expect(await withdrawn.json()).toMatchObject({ status: "private" });
    expect((await publicDownload(new Request("http://localhost:3000"), { params: Promise.resolve({ id: assetId }) })).status).toBe(404);
  });

  it("lets a moderator action an asset report and remove its public listing", async () => {
    const owner = await createUser("store_report_owner");
    const reporter = await createUser("store_report_user");
    const admin = await createUser("store_report_admin", "admin");
    authState.adminId = admin;
    authState.userId = owner;
    const assetId = await createValidatedAsset(owner);
    expect((await submit(assetId)).status).toBe(202);
    expect((await decideAsset(assetId, "approve")).status).toBe(200);

    authState.userId = reporter;
    const reportResponse = await createReport(new Request("http://localhost:3000/api/reports", {
      method: "POST", headers: { ...headers(), "content-type": "application/json" },
      body: JSON.stringify({ targetType: "asset", targetId: assetId, reason: "copyright", details: "I believe this upload is not authorized." }),
    }));
    expect(reportResponse.status).toBe(201);
    const queue = await adminQueue();
    const queueData = await queue.json() as { reports: Array<{ id: string; target_type: string; targetTitle: string; targetHref: string }> };
    const report = queueData.reports.find((item) => item.target_type === "asset");
    expect(report).toMatchObject({ targetTitle: "Community Sprite", targetHref: `/asset-store#asset-${assetId}` });
    const decision = await reportDecision(new Request(`http://localhost:3000/api/admin/reports/${report!.id}/decision`, {
      method: "POST", headers: { ...headers(), "content-type": "application/json" },
      body: JSON.stringify({ decision: "actioned", note: "Removed pending rights investigation.", takeDown: true }),
    }), { params: Promise.resolve({ id: report!.id }) });
    expect(decision.status).toBe(200);
    expect(await decision.json()).toMatchObject({ status: "actioned", removedTargets: [`asset:${assetId}`] });
    const retainedReviewCopy = await adminReviewDownload(new Request("http://localhost:3000"), { params: Promise.resolve({ id: assetId }) });
    expect(retainedReviewCopy.status).toBe(200);
    expect(retainedReviewCopy.headers.get("content-disposition")).toContain("attachment;");
    expect((await publicDownload(new Request("http://localhost:3000"), { params: Promise.resolve({ id: assetId }) })).status).toBe(404);
    const hidden = await publicListing(new Request("http://localhost:3000/api/asset-store"));
    expect((await hidden.json() as { assets: Array<{ id: string }> }).assets).not.toContainEqual(expect.objectContaining({ id: assetId }));
    expect(await query<{ action: string }>(`SELECT action FROM asset_moderation_events WHERE asset_id = ? ORDER BY created_at DESC LIMIT 1`, [assetId]))
      .toEqual([{ action: "removed" }]);
  });

  it("requires a moderator note when rejecting a submission", async () => {
    const owner = await createUser("store_reject_owner");
    const admin = await createUser("store_reject_admin", "admin");
    authState.adminId = admin;
    const assetId = await createValidatedAsset(owner);
    expect((await submit(assetId)).status).toBe(202);
    const missingNote = await decideAsset(assetId, "reject");
    expect(missingNote.status).toBe(400);
    const rejected = await decideAsset(assetId, "reject", "Rights declaration needs clarification.");
    expect(rejected.status).toBe(200);
    expect(await rejected.json()).toMatchObject({ status: "rejected" });
    const row = await query<{ publication_status: string; moderation_note: string }>(`SELECT publication_status, moderation_note FROM assets WHERE id = ?`, [assetId]);
    expect(row).toEqual([{ publication_status: "rejected", moderation_note: "Rights declaration needs clarification." }]);
    expect((await publicDownload(new Request("http://localhost:3000"), { params: Promise.resolve({ id: assetId }) })).status).toBe(404);
  });
});
