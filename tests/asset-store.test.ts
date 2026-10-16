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
import { DELETE as deletePrivateAsset } from "@/app/api/assets/[id]/route";
import { PUT as uploadAsset } from "@/app/api/assets/[id]/upload/route";
import { POST as completeUpload } from "@/app/api/assets/[id]/complete/route";
import { POST as submitForStore, DELETE as withdrawFromStore } from "@/app/api/assets/[id]/store/route";
import { POST as submitAppeal } from "@/app/api/assets/[id]/appeal/route";
import { POST as importStoreAsset } from "@/app/api/asset-store/[id]/import/route";
import { POST as reviewAppeal } from "@/app/api/admin/asset-store/appeals/[id]/decision/route";
import { GET as cleanupExpiredAssets } from "@/app/api/cron/assets/cleanup/route";
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
const previousCleanupSecret = mutableEnv.CRON_SECRET;
const databaseUrl = `file:.gameforge-local/asset-store-${process.pid}.sqlite`;
const png = new Uint8Array(Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/iZk9HQAAAABJRU5ErkJggg==", "base64"));
let requestNumber = 0;

beforeAll(() => {
  mutableEnv.DATABASE_URL = databaseUrl;
  mutableEnv.NEXT_PUBLIC_SITE_URL = "http://localhost:3000";
  mutableEnv.CRON_SECRET = "test-cleanup-secret-that-is-more-than-32-characters";
  for (const name of ["S3_BUCKET", "S3_REGION", "S3_ACCESS_KEY_ID", "S3_SECRET_ACCESS_KEY"]) delete mutableEnv[name];
});
afterAll(async () => {
  await closeDatabase();
  if (previousDatabaseUrl === undefined) delete mutableEnv.DATABASE_URL; else mutableEnv.DATABASE_URL = previousDatabaseUrl;
  if (previousSiteUrl === undefined) delete mutableEnv.NEXT_PUBLIC_SITE_URL; else mutableEnv.NEXT_PUBLIC_SITE_URL = previousSiteUrl;
  if (previousCleanupSecret === undefined) delete mutableEnv.CRON_SECRET; else mutableEnv.CRON_SECRET = previousCleanupSecret;
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

async function appeal(assetId: string, explanation = "The submitted file is my original work and the reviewer may have missed the attached rights documentation.") {
  return submitAppeal(new Request(`http://localhost:3000/api/assets/${assetId}/appeal`, {
    method: "POST", headers: { ...headers(), "content-type": "application/json" }, body: JSON.stringify({ explanation }),
  }), { params: Promise.resolve({ id: assetId }) });
}

async function resolveAssetAppeal(appealId: string, decision: "reopen" | "uphold", note = "The additional information has been reviewed.") {
  return reviewAppeal(new Request(`http://localhost:3000/api/admin/asset-store/appeals/${appealId}/decision`, {
    method: "POST", headers: { ...headers(), "content-type": "application/json" }, body: JSON.stringify({ decision, note }),
  }), { params: Promise.resolve({ id: appealId }) });
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

  it("imports an approved Asset Store file into private storage with license and attribution provenance", async () => {
    const owner = await createUser("store_import_owner");
    const importer = await createUser("store_import_user");
    const admin = await createUser("store_import_admin", "admin");
    authState.adminId = admin;
    const sourceId = await createValidatedAsset(owner);
    expect((await submit(sourceId)).status).toBe(202);
    expect((await decideAsset(sourceId, "approve")).status).toBe(200);

    authState.userId = importer;
    const response = await importStoreAsset(new Request(`http://localhost:3000/api/asset-store/${sourceId}/import`, {
      method: "POST", headers: headers(),
    }), { params: Promise.resolve({ id: sourceId }) });
    expect(response.status).toBe(201);
    const imported = await response.json() as { asset: Awaited<ReturnType<typeof getPrivateAsset>> };
    expect(imported.asset).not.toHaveProperty("storageKey");
    expect(imported.asset).toMatchObject({
      publicationStatus: "private", rightsConfirmed: false, downloadAuthorized: false,
      importSource: {
        assetId: sourceId, license: "cc-by-4.0", licenseUrl: "https://creativecommons.org/licenses/by/4.0/",
        attribution: declaration.attribution, creatorUsername: "store_import_owner",
      },
    });
    expect((await getPrivateAsset(importer, imported.asset.id)).publicationStatus).toBe("private");
    expect((await submit(imported.asset.id)).status).toBe(409);
    const listed = await publicListing(new Request("http://localhost:3000/api/asset-store"));
    const listedAssets = (await listed.json() as { assets: Array<{ id: string }> }).assets;
    expect(listedAssets).toContainEqual(expect.objectContaining({ id: sourceId }));
    expect(listedAssets).not.toContainEqual(expect.objectContaining({ id: imported.asset.id }));

    authState.userId = owner;
    expect((await withdrawFromStore(new Request(`http://localhost:3000/api/assets/${sourceId}/store`, { method: "DELETE", headers: headers() }), { params: Promise.resolve({ id: sourceId }) })).status).toBe(200);
    authState.userId = importer;
    const afterWithdrawal = await importStoreAsset(new Request(`http://localhost:3000/api/asset-store/${sourceId}/import`, {
      method: "POST", headers: headers(),
    }), { params: Promise.resolve({ id: sourceId }) });
    expect(afterWithdrawal.status).toBe(404);
  });

  it("queues owner appeals and keeps accepted appeals private until ordinary moderation approves them", async () => {
    const owner = await createUser("store_appeal_owner");
    const admin = await createUser("store_appeal_admin", "admin");
    authState.adminId = admin;
    const assetId = await createValidatedAsset(owner);
    expect((await submit(assetId)).status).toBe(202);
    expect((await decideAsset(assetId, "reject", "Please provide clearer rights evidence.")).status).toBe(200);

    authState.userId = owner;
    expect((await appeal(assetId, "Too short.")).status).toBe(400);
    const submitted = await appeal(assetId);
    expect(submitted.status).toBe(201);
    const appealData = await submitted.json() as { appealId: string; status: string };
    expect(appealData.status).toBe("open");
    expect((await appeal(assetId)).status).toBe(409);
    const blockedDeletion = await deletePrivateAsset(new Request(`http://localhost:3000/api/assets/${assetId}`, { method: "DELETE", headers: headers() }), { params: Promise.resolve({ id: assetId }) });
    expect(blockedDeletion.status).toBe(409);

    const queue = await adminQueue();
    expect((await queue.json() as { appeals: Array<{ id: string; assetId: string; explanation: string }> }).appeals)
      .toContainEqual(expect.objectContaining({ id: appealData.appealId, assetId, explanation: expect.stringContaining("original work") }));
    const reopened = await resolveAssetAppeal(appealData.appealId, "reopen");
    expect(reopened.status).toBe(200);
    expect(await reopened.json()).toMatchObject({ status: "reopened", assetId });
    expect((await getPrivateAsset(owner, assetId)).publicationStatus).toBe("pending_review");
    expect((await publicDownload(new Request("http://localhost:3000"), { params: Promise.resolve({ id: assetId }) })).status).toBe(404);

    expect((await decideAsset(assetId, "reject", "The review decision still stands.")).status).toBe(200);
    authState.userId = owner;
    const secondAppeal = await appeal(assetId, "I have attached further documentation that directly addresses the review note.");
    expect(secondAppeal.status).toBe(201);
    const secondId = (await secondAppeal.json() as { appealId: string }).appealId;
    authState.adminId = admin;
    const upheld = await resolveAssetAppeal(secondId, "uphold");
    expect(upheld.status).toBe(200);
    expect(await upheld.json()).toMatchObject({ status: "upheld", assetId });
    expect((await getPrivateAsset(owner, assetId)).appeal).toMatchObject({ status: "upheld", reviewerNote: "The additional information has been reviewed." });
  });

  it("requires a strong cron secret and cleans expired private uploads", async () => {
    const owner = await createUser("store_cleanup_owner");
    authState.userId = owner;
    const intentResponse = await createIntent(new Request("http://localhost:3000/api/assets", {
      method: "POST", headers: { ...headers(), "content-type": "application/json" },
      body: JSON.stringify({ filename: "abandoned.png", size: png.byteLength }),
    }));
    const intent = await intentResponse.json() as { assetId: string };
    const past = new Date(Date.now() - 60_000).toISOString();
    await execute(`UPDATE assets SET upload_expires_at = ? WHERE id = ?`, [past, intent.assetId]);

    const denied = await cleanupExpiredAssets(new Request("http://localhost:3000/api/cron/assets/cleanup"));
    expect(denied.status).toBe(401);
    const cleaned = await cleanupExpiredAssets(new Request("http://localhost:3000/api/cron/assets/cleanup?limit=25", {
      headers: { authorization: `Bearer ${mutableEnv.CRON_SECRET}` },
    }));
    expect(cleaned.status).toBe(200);
    expect(await cleaned.json()).toMatchObject({ ok: true, scanned: 1, expired: 1, cleanupPending: 0 });
    const row = await query<{ upload_status: string; validation_state: string; upload_expires_at: string | null; deleted_at: string | null }>(
      `SELECT upload_status, validation_state, upload_expires_at, deleted_at FROM assets WHERE id = ?`, [intent.assetId]);
    expect(row[0]).toMatchObject({ upload_status: "failed", validation_state: "expired", upload_expires_at: null });
    expect(row[0]?.deleted_at).toBeTruthy();
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
