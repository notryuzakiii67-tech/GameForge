import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { closeDatabase, execute, newId, nowIso, query } from "@/lib/db";

const authState = vi.hoisted(() => ({ userId: "" }));
const providerState = vi.hoisted(() => ({ prompts: [] as string[], providers: [] as string[], quotaProviders: [] as string[] }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth", () => ({
  requireUser: vi.fn(async () => ({ id: authState.userId, username: "asset_ai_test", displayName: "Asset AI Test", role: "user", avatar: null, bio: "" })),
}));
vi.mock("@/lib/ai/providers", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/ai/providers")>();
  const http = await import("@/lib/http");
  return {
    ...actual,
    getConfiguredProviderKey: vi.fn(() => "server-only-test-key"),
    discoverModels: vi.fn(async () => [{ id: "test-model", displayName: "Test model" }]),
    generateProject: vi.fn(async (provider: string, _model: string, _key: string, prompt: string) => {
      providerState.providers.push(provider);
      providerState.prompts.push(prompt);
      if (providerState.quotaProviders.includes(provider)) throw new http.ApiError(429, "PROVIDER_RATE_LIMITED", "Rate limited.");
      return {
        title: "Attached reference game", description: "", summary: "Created a test game.", deleteFiles: [],
        files: [{ path: "index.html", content: "<!doctype html><html><body><h1>Ready</h1></body></html>" }],
      };
    }),
  };
});

import { POST as generate } from "@/app/api/ai/generate/route";

const mutableEnv = process.env as unknown as Record<string, string | undefined>;
const oldDatabaseUrl = mutableEnv.DATABASE_URL;
const oldSiteUrl = mutableEnv.NEXT_PUBLIC_SITE_URL;
const oldMistralKey = mutableEnv.MISTRAL_API_KEY;
const databaseUrl = `file:.gameforge-local/asset-ai-${process.pid}.sqlite`;
let requestNumber = 0;

beforeAll(() => {
  mutableEnv.DATABASE_URL = databaseUrl;
  mutableEnv.NEXT_PUBLIC_SITE_URL = "http://localhost:3000";
});
afterAll(async () => {
  await closeDatabase();
  if (oldDatabaseUrl === undefined) delete mutableEnv.DATABASE_URL; else mutableEnv.DATABASE_URL = oldDatabaseUrl;
  if (oldSiteUrl === undefined) delete mutableEnv.NEXT_PUBLIC_SITE_URL; else mutableEnv.NEXT_PUBLIC_SITE_URL = oldSiteUrl;
  if (oldMistralKey === undefined) delete mutableEnv.MISTRAL_API_KEY; else mutableEnv.MISTRAL_API_KEY = oldMistralKey;
});

async function createUser(username: string) {
  const id = newId();
  const timestamp = nowIso();
  await execute(
    `INSERT INTO users(id, username, display_name, email, password_hash, role, account_status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, 'user', 'active', ?, ?)`,
    [id, username, username, `${id}@asset-ai.invalid`, "test-hash", timestamp, timestamp],
  );
  return id;
}

async function createAsset(ownerId: string, filename: string) {
  const id = newId();
  const timestamp = nowIso();
  await execute(
    `INSERT INTO assets(id, owner_id, original_name, extension, format, category, mime_type, size_bytes, content_hash, storage_key,
       upload_status, publication_status, validation_state, validation_json, created_at, updated_at)
     VALUES (?, ?, ?, 'png', 'PNG', 'image', 'image/png', 70, ?, ?, 'ready', 'private', 'valid_compatible', ?, ?, ?)`,
    [id, ownerId, filename, "b".repeat(64), `assets/private/${ownerId}/${id}`, JSON.stringify({ width: 1, height: 1, pixelCount: 1 }), timestamp, timestamp],
  );
  return id;
}

function request(body: unknown) {
  requestNumber += 1;
  return new Request("http://localhost:3000/api/ai/generate", {
    method: "POST",
    headers: { origin: "http://localhost:3000", "content-type": "application/json", "x-forwarded-for": `203.0.113.${(requestNumber % 200) + 1}` },
    body: JSON.stringify(body),
  });
}

describe("AI private asset prompt context", () => {
  it("sends only opted-in filenames and verified metadata, never private file bytes", async () => {
    const owner = await createUser("asset_prompt_owner");
    authState.userId = owner;
    providerState.prompts.length = 0;
    const assetId = await createAsset(owner, "Moon Garden Reference.png");
    const response = await generate(request({ provider: "gemini", model: "test-model", prompt: "Make a garden puzzle", assetIds: [assetId] }));
    const body = await response.json();
    expect(response.status).toBe(201);
    expect(providerState.prompts).toHaveLength(1);
    expect(providerState.prompts[0]).toContain("Moon Garden Reference.png");
    expect(providerState.prompts[0]).toContain(`gameforge-asset://${assetId}`);
    expect(body.assetBindings).toMatchObject([{ assetId, placeholder: `gameforge-asset://${assetId}` }]);
    expect(await query(`SELECT asset_id FROM project_asset_bindings WHERE project_id = ? AND version_number = 1`, [body.project.id])).toHaveLength(1);
    expect(providerState.prompts[0]).toContain("width: 1");
    expect(providerState.prompts[0]).toContain("file bytes have not been sent");
    expect(providerState.prompts[0]).not.toContain("data:image/png;base64,");
    expect(providerState.prompts[0]).not.toContain(`/api/assets/${assetId}/file`);
  });

  it("does not allow attaching another account’s asset or contact the provider for it", async () => {
    const owner = await createUser("asset_prompt_owner_two");
    const other = await createUser("asset_prompt_other");
    authState.userId = owner;
    const privateAssetId = await createAsset(other, "not-yours.png");
    providerState.prompts.length = 0;
    const response = await generate(request({ provider: "gemini", model: "test-model", prompt: "Make a puzzle", assetIds: [privateAssetId] }));
    const body = await response.json();
    expect(response.status).toBe(404);
    expect(body.error.code).toBe("ASSET_NOT_FOUND");
    expect(providerState.prompts).toHaveLength(0);
    expect(await query(`SELECT id FROM ai_generations WHERE user_id = ? AND status = 'running'`, [owner])).toHaveLength(0);
  });

  it("uses Mistral after a Gemini quota response and records the provider/model that generated the version", async () => {
    const owner = await createUser("asset_quota_fallback_owner");
    authState.userId = owner;
    mutableEnv.MISTRAL_API_KEY = "mistral-fallback-test-key";
    providerState.prompts.length = 0;
    providerState.providers.length = 0;
    providerState.quotaProviders = ["gemini"];
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ data: [{ id: "mistral-small-latest" }] }, { status: 200 })));
    try {
      const response = await generate(request({ provider: "gemini", model: "test-model", prompt: "Make a quota fallback test game" }));
      const body = await response.json();
      expect(response.status).toBe(201);
      expect(providerState.providers).toEqual(["gemini", "mistral"]);
      expect(body.aiProvider).toMatchObject({ requested: "gemini", used: "mistral", usedName: "Mistral", model: "mistral-small-latest", fallbackFrom: "gemini", fallbackReason: "quota_exhausted" });
      const version = await query<{ provider: string; model: string }>(`SELECT provider, model FROM ai_project_versions WHERE project_id = ? AND version_number = 1`, [body.project.id]);
      expect(version[0]).toEqual({ provider: "mistral", model: "mistral-small-latest" });
      const generation = await query<{ provider: string; model: string; status: string }>(`SELECT provider, model, status FROM ai_generations WHERE id = (SELECT id FROM ai_generations WHERE user_id = ? ORDER BY started_at DESC LIMIT 1)`, [owner]);
      expect(generation[0]).toEqual({ provider: "mistral", model: "mistral-small-latest", status: "completed" });
    } finally {
      providerState.quotaProviders = [];
      vi.unstubAllGlobals();
    }
  });
});
