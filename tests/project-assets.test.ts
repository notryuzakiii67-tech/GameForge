import { createHash } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { unzipSync } from "fflate";
import { closeDatabase, execute, newId, nowIso, query } from "@/lib/db";
import { putObject } from "@/lib/storage";

const authState = vi.hoisted(() => ({ userId: "" }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth", () => ({
  requireUser: vi.fn(async () => ({ id: authState.userId, username: "asset_binding_test", displayName: "Asset Binding Test", role: "user", avatar: null, bio: "" })),
  getCurrentUser: vi.fn(async () => ({ id: authState.userId, username: "asset_binding_test", displayName: "Asset Binding Test", role: "user", avatar: null, bio: "" })),
}));

import { POST as bindAssets } from "@/app/api/ai/projects/[id]/assets/route";
import { DELETE as unbindAsset } from "@/app/api/ai/projects/[id]/assets/[assetId]/route";
import { POST as createPreviewSession } from "@/app/api/ai/projects/[id]/preview-session/route";
import { GET as readPrivatePreview } from "@/app/api/ai/projects/[id]/preview/[version]/[token]/[...filePath]/route";
import { GET as readPrivateAssetPreview } from "@/app/api/ai/projects/[id]/preview-asset/route";
import { GET as exportProject } from "@/app/api/ai/projects/[id]/export/route";
import { PATCH as updateProject } from "@/app/api/ai/projects/[id]/route";
import { POST as publishProject } from "@/app/api/ai/projects/[id]/publish/route";
import { getProjectVersionAssetIds } from "@/lib/project-assets";

const mutableEnv = process.env as unknown as Record<string, string | undefined>;
const databaseUrl = `file:.gameforge-local/project-assets-${process.pid}.sqlite`;
const oldEnv = {
  databaseUrl: mutableEnv.DATABASE_URL,
  siteUrl: mutableEnv.NEXT_PUBLIC_SITE_URL,
  s3Bucket: mutableEnv.S3_BUCKET,
  s3Region: mutableEnv.S3_REGION,
  s3AccessKey: mutableEnv.S3_ACCESS_KEY_ID,
  s3Secret: mutableEnv.S3_SECRET_ACCESS_KEY,
  s3Endpoint: mutableEnv.S3_ENDPOINT,
};
let requestSequence = 0;

beforeAll(() => {
  mutableEnv.DATABASE_URL = databaseUrl;
  mutableEnv.NEXT_PUBLIC_SITE_URL = "http://localhost:3000";
  delete mutableEnv.S3_BUCKET;
  delete mutableEnv.S3_REGION;
  delete mutableEnv.S3_ACCESS_KEY_ID;
  delete mutableEnv.S3_SECRET_ACCESS_KEY;
  delete mutableEnv.S3_ENDPOINT;
});
afterAll(async () => {
  await closeDatabase();
  if (oldEnv.databaseUrl === undefined) delete mutableEnv.DATABASE_URL; else mutableEnv.DATABASE_URL = oldEnv.databaseUrl;
  if (oldEnv.siteUrl === undefined) delete mutableEnv.NEXT_PUBLIC_SITE_URL; else mutableEnv.NEXT_PUBLIC_SITE_URL = oldEnv.siteUrl;
  if (oldEnv.s3Bucket === undefined) delete mutableEnv.S3_BUCKET; else mutableEnv.S3_BUCKET = oldEnv.s3Bucket;
  if (oldEnv.s3Region === undefined) delete mutableEnv.S3_REGION; else mutableEnv.S3_REGION = oldEnv.s3Region;
  if (oldEnv.s3AccessKey === undefined) delete mutableEnv.S3_ACCESS_KEY_ID; else mutableEnv.S3_ACCESS_KEY_ID = oldEnv.s3AccessKey;
  if (oldEnv.s3Secret === undefined) delete mutableEnv.S3_SECRET_ACCESS_KEY; else mutableEnv.S3_SECRET_ACCESS_KEY = oldEnv.s3Secret;
  if (oldEnv.s3Endpoint === undefined) delete mutableEnv.S3_ENDPOINT; else mutableEnv.S3_ENDPOINT = oldEnv.s3Endpoint;
});

function request(path: string, method: string, body?: unknown, origin = "http://localhost:3000"): Request {
  requestSequence += 1;
  return new Request(`http://localhost:3000${path}`, {
    method,
    headers: {
      origin,
      "content-type": "application/json",
      "x-forwarded-for": `198.51.100.${(requestSequence % 240) + 1}`,
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

async function createUser(username: string): Promise<string> {
  const id = newId();
  const timestamp = nowIso();
  await execute(
    `INSERT INTO users(id, username, display_name, email, password_hash, role, account_status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, 'user', 'active', ?, ?)`,
    [id, username, username, `${id}@project-assets.invalid`, "test-hash", timestamp, timestamp],
  );
  return id;
}

async function createProject(ownerId: string, content = "<!doctype html><html><body><h1>Project test content</h1></body></html>") {
  const id = newId();
  const timestamp = nowIso();
  const files = [{ path: "index.html", content }];
  await execute(
    `INSERT INTO ai_projects(id, owner_id, title, description, genre, visibility, status, created_at, updated_at)
     VALUES (?, ?, 'Binding test', '', 'Puzzle', 'private', 'draft', ?, ?)`, [id, ownerId, timestamp, timestamp]);
  await execute(
    `INSERT INTO ai_project_versions(id, project_id, version_number, prompt_summary, provider, model, manifest_json, validation_status, change_summary, created_at)
     VALUES (?, ?, 1, '', 'gemini', 'test-model', ?, 'validated', '', ?)`,
    [newId(), id, JSON.stringify(files), timestamp]);
  return { id, files };
}

async function createAsset(ownerId: string, filename = "private sprite.png") {
  const id = newId();
  const timestamp = nowIso();
  const bytes = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3, 4]);
  const storageKey = `assets/private/${ownerId}/${id}`;
  const hash = createHash("sha256").update(bytes).digest("hex");
  await putObject(storageKey, bytes, "image/png", "private, no-store");
  await execute(
    `INSERT INTO assets(id, owner_id, original_name, extension, format, category, mime_type, size_bytes, content_hash, storage_key,
       upload_status, publication_status, validation_state, validation_json, created_at, updated_at)
     VALUES (?, ?, ?, 'png', 'PNG', 'image', 'image/png', ?, ?, ?, 'ready', 'private', 'valid_compatible', '{}', ?, ?)`,
    [id, ownerId, filename, bytes.byteLength, hash, storageKey, timestamp, timestamp],
  );
  return { id, bytes, storageKey, hash, filename };
}

async function bodyJson(response: Response) {
  return await response.json() as Record<string, any>;
}

describe("versioned private project asset bindings", () => {
  it("creates a new version for bind/unbind, restores an earlier binding, and denies another owner", async () => {
    const owner = await createUser("binding_owner_one");
    const other = await createUser("binding_owner_two");
    authState.userId = owner;
    const project = await createProject(owner);
    const asset = await createAsset(owner);

    const bound = await bindAssets(request(`/api/ai/projects/${project.id}/assets`, "POST", { version: 1, assetIds: [asset.id] }), { params: Promise.resolve({ id: project.id }) });
    const boundBody = await bodyJson(bound);
    expect(bound.status).toBe(200);
    expect(boundBody).toMatchObject({ changed: true, version: 2, bindings: [{ assetId: asset.id, filename: asset.filename, placeholder: `gameforge-asset://${asset.id}` }] });
    expect(await getProjectVersionAssetIds(owner, project.id, 1)).toEqual([]);
    expect(await getProjectVersionAssetIds(owner, project.id, 2)).toEqual([asset.id]);

    authState.userId = other;
    const denied = await bindAssets(request(`/api/ai/projects/${project.id}/assets`, "POST", { version: 2, assetIds: [asset.id] }), { params: Promise.resolve({ id: project.id }) });
    expect(denied.status).toBe(404);

    authState.userId = owner;
    const unbound = await unbindAsset(request(`/api/ai/projects/${project.id}/assets/${asset.id}`, "DELETE", { version: 2 }), { params: Promise.resolve({ id: project.id, assetId: asset.id }) });
    expect(await bodyJson(unbound)).toMatchObject({ changed: true, version: 3, bindings: [] });
    expect(await getProjectVersionAssetIds(owner, project.id, 2)).toEqual([asset.id]);
    expect(await getProjectVersionAssetIds(owner, project.id, 3)).toEqual([]);

    const restored = await (await import("@/app/api/ai/projects/[id]/restore/route")).POST(
      request(`/api/ai/projects/${project.id}/restore`, "POST", { version: 2 }), { params: Promise.resolve({ id: project.id }) });
    const restoredBody = await bodyJson(restored);
    expect(restored.status).toBe(200);
    expect(restoredBody).toMatchObject({ version: 4, assetBindings: [{ assetId: asset.id }] });
    expect(await getProjectVersionAssetIds(owner, project.id, 4)).toEqual([asset.id]);

    const stale = await bindAssets(request(`/api/ai/projects/${project.id}/assets`, "POST", { version: 1, assetIds: [asset.id] }), { params: Promise.resolve({ id: project.id }) });
    expect(stale.status).toBe(409);
    expect((await bodyJson(stale)).error.code).toBe("PROJECT_VERSION_CHANGED");
  });

  it("issues a short-lived version-scoped capability, resolves placeholders, and verifies private bytes", async () => {
    const owner = await createUser("binding_preview_owner");
    authState.userId = owner;
    const assetId = newId();
    const project = await createProject(owner, `<!doctype html><html><body><img id="sprite" src="gameforge-asset://${assetId}"></body></html>`);
    const asset = await createAsset(owner, "token-only.png");
    expect(asset.id).not.toBe(assetId);

    const bound = await bindAssets(request(`/api/ai/projects/${project.id}/assets`, "POST", { version: 1, assetIds: [assetId] }), { params: Promise.resolve({ id: project.id }) });
    expect(bound.status).toBe(404);
    // The reference itself must name an existing owner asset; bindings never accept invented IDs.
    const projectTwo = await createProject(owner, `<!doctype html><html><body><img id="sprite" src="gameforge-asset://${asset.id}"></body></html>`);
    const bindResponse = await bindAssets(request(`/api/ai/projects/${projectTwo.id}/assets`, "POST", { version: 1, assetIds: [asset.id] }), { params: Promise.resolve({ id: projectTwo.id }) });
    expect(bindResponse.status).toBe(200);
    const sessionResponse = await createPreviewSession(request(`/api/ai/projects/${projectTwo.id}/preview-session`, "POST", { version: 2 }), { params: Promise.resolve({ id: projectTwo.id }) });
    const session = await bodyJson(sessionResponse);
    expect(sessionResponse.status).toBe(200);
    expect(session).toMatchObject({ hasPrivateAssets: true, expiresInSeconds: 900 });
    expect(session.token).toMatch(/^[A-Za-z0-9_-]{43}$/);

    const htmlResponse = await readPrivatePreview(new Request(`http://localhost:3000/api/ai/projects/${projectTwo.id}/preview/2/${session.token}/index.html`), {
      params: Promise.resolve({ id: projectTwo.id, version: "2", token: session.token, filePath: ["index.html"] }),
    });
    const html = await htmlResponse.text();
    expect(htmlResponse.status).toBe(200);
    expect(html).toContain(`/api/ai/projects/${projectTwo.id}/preview-asset?version=2&token=${session.token}&asset=${asset.id}`);
    expect(html).not.toContain(asset.storageKey);
    expect(htmlResponse.headers.get("access-control-allow-origin")).toBe("*");
    expect(htmlResponse.headers.get("cache-control")).toContain("no-store");

    const assetResponse = await readPrivateAssetPreview(new Request(`http://localhost:3000/api/ai/projects/${projectTwo.id}/preview-asset?version=2&token=${session.token}&asset=${asset.id}`), {
      params: Promise.resolve({ id: projectTwo.id }),
    });
    expect(assetResponse.status).toBe(200);
    expect(new Uint8Array(await assetResponse.arrayBuffer())).toEqual(asset.bytes);
    expect(assetResponse.headers.get("access-control-allow-origin")).toBe("*");
    expect(assetResponse.headers.get("cache-control")).toContain("no-store");
    const alteredBytes = asset.bytes.map((value, index) => index === 8 ? value ^ 0xff : value);
    await putObject(asset.storageKey, alteredBytes, "image/png", "private, no-store");
    const tampered = await readPrivateAssetPreview(new Request(`http://localhost:3000/api/ai/projects/${projectTwo.id}/preview-asset?version=2&token=${session.token}&asset=${asset.id}`), {
      params: Promise.resolve({ id: projectTwo.id }),
    });
    expect(tampered.status).toBe(409);
    expect((await bodyJson(tampered)).error.code).toBe("ASSET_INTEGRITY_MISMATCH");

    const wrongVersion = await readPrivatePreview(new Request("http://localhost:3000/unused"), {
      params: Promise.resolve({ id: projectTwo.id, version: "1", token: session.token, filePath: ["index.html"] }),
    });
    expect(wrongVersion.status).toBe(404);

    const tokenHash = createHash("sha256").update(session.token).digest("hex");
    await execute(`UPDATE project_preview_grants SET expires_at = ? WHERE token_hash = ?`, [new Date(Date.now() - 60_000).toISOString(), tokenHash]);
    const expired = await readPrivatePreview(new Request("http://localhost:3000/unused"), {
      params: Promise.resolve({ id: projectTwo.id, version: "2", token: session.token, filePath: ["index.html"] }),
    });
    expect(expired.status).toBe(404);
  });

  it("blocks unresolved references and any private bound asset from public listing or game submission", async () => {
    const owner = await createUser("binding_publication_owner");
    authState.userId = owner;
    const asset = await createAsset(owner, "still-private.png");
    const project = await createProject(owner, `<!doctype html><html><body><img src="gameforge-asset://${asset.id}"></body></html>`);

    const missingSession = await createPreviewSession(request(`/api/ai/projects/${project.id}/preview-session`, "POST", { version: 1 }), { params: Promise.resolve({ id: project.id }) });
    expect(missingSession.status).toBe(409);
    expect((await bodyJson(missingSession)).error.code).toBe("ASSET_REFERENCE_UNBOUND");

    const unboundListing = await updateProject(request(`/api/ai/projects/${project.id}`, "PATCH", { visibility: "public" }), { params: Promise.resolve({ id: project.id }) });
    expect(unboundListing.status).toBe(409);

    const bound = await bindAssets(request(`/api/ai/projects/${project.id}/assets`, "POST", { version: 1, assetIds: [asset.id] }), { params: Promise.resolve({ id: project.id }) });
    expect(bound.status).toBe(200);
    const boundListing = await updateProject(request(`/api/ai/projects/${project.id}`, "PATCH", { visibility: "public" }), { params: Promise.resolve({ id: project.id }) });
    expect(boundListing.status).toBe(409);
    expect((await bodyJson(boundListing)).error.code).toBe("PRIVATE_ASSET_PUBLICATION_BLOCKED");

    const publish = await publishProject(request(`/api/ai/projects/${project.id}/publish`, "POST", { license: "all-rights-reserved" }), { params: Promise.resolve({ id: project.id }) });
    expect(publish.status).toBe(409);
    expect((await bodyJson(publish)).error.code).toBe("PRIVATE_ASSET_PUBLICATION_BLOCKED");
    expect(await query(`SELECT id FROM games WHERE source_project_id = ?`, [project.id])).toHaveLength(0);
  });

  it("exports bound assets as private ZIP entries and rewrites placeholders to relative paths", async () => {
    const owner = await createUser("binding_export_owner");
    authState.userId = owner;
    const asset = await createAsset(owner, "Moon Garden.png");
    const project = await createProject(owner, `<!doctype html><html><body><img src="gameforge-asset://${asset.id}"></body></html>`);
    const bound = await bindAssets(request(`/api/ai/projects/${project.id}/assets`, "POST", { version: 1, assetIds: [asset.id] }), { params: Promise.resolve({ id: project.id }) });
    expect(bound.status).toBe(200);

    const response = await exportProject(new Request(`http://localhost:3000/api/ai/projects/${project.id}/export`), { params: Promise.resolve({ id: project.id }) });
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toContain("no-store");
    const zip = unzipSync(new Uint8Array(await response.arrayBuffer()));
    const archiveAssetPath = `assets/${asset.id.slice(0, 8)}-${asset.filename}`;
    const encodedAssetUrl = `assets/${encodeURIComponent(`${asset.id.slice(0, 8)}-${asset.filename}`)}`;
    const html = new TextDecoder().decode(zip["index.html"]);
    expect(html).toContain(encodedAssetUrl);
    expect(html).not.toContain("gameforge-asset://");
    expect(html).not.toContain(asset.storageKey);
    expect(zip[archiveAssetPath]).toEqual(asset.bytes);
  });
});
