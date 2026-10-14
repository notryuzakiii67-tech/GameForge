import { afterEach, describe, expect, it, vi } from "vitest";
import { discoverModels, generateProject } from "@/lib/ai/providers";
import { ApiError } from "@/lib/http";

const originalFetch = globalThis.fetch;
afterEach(() => { vi.stubGlobal("fetch", originalFetch); });

describe("BYOK provider adapters", () => {
  it("discovers Gemini generation models using the documented header, never a key in the URL", async () => {
    const key = "gemini-secret-test-key";
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ models: [
      { name: "models/gemini-flash-test", displayName: "Flash test", supportedGenerationMethods: ["generateContent"] },
      { name: "models/gemini-embed-test", supportedGenerationMethods: ["embedContent"] },
    ] }), { status: 200, headers: { "Content-Type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);
    const models = await discoverModels("gemini", key);
    expect(models).toEqual([{ id: "gemini-flash-test", displayName: "Flash test" }]);
    const [url, options] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).not.toContain(key);
    expect(new Headers(options.headers).get("x-goog-api-key")).toBe(key);
  });

  it("maps an invalid provider key to a safe message without echoing the secret", async () => {
    const key = "test-secret-must-not-appear";
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ error: { message: `bad key ${key}` } }), { status: 401 })));
    await expect(discoverModels("groq", key)).rejects.toMatchObject({ code: "PROVIDER_AUTH_FAILED" });
    try { await discoverModels("groq", key); } catch (error) {
      expect((error as Error).message).not.toContain(key);
      expect((error as Error).message).toContain("Groq");
    }
  });

  it("reports provider throttling and a bounded retry hint", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 429, headers: { "retry-after": "12" } })));
    try {
      await discoverModels("mistral", "mistral-secret-test-key");
      throw new Error("Expected provider rate limit");
    } catch (error) {
      expect(error).toBeInstanceOf(ApiError);
      expect(error).toMatchObject({ code: "PROVIDER_RATE_LIMITED", extra: { retryAfter: 12 } });
    }
  });

  it("keeps the BYOK key out of model request bodies and parses structured game output", async () => {
    const key = "gemini-generation-key";
    const output = JSON.stringify({
      title: "Orb Garden",
      description: "A small playable collecting game.",
      summary: "Added a playable garden loop.",
      files: [{ path: "index.html", content: "<!doctype html><html><body><button>Play</button></body></html>" }],
      deleteFiles: [],
    });
    const fetchMock = vi.fn(async (_url: string | URL | Request, options?: RequestInit) => {
      const body = JSON.parse(String(options?.body));
      expect(JSON.stringify(body)).not.toContain(key);
      return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: output }] } }], usageMetadata: { promptTokenCount: 120, candidatesTokenCount: 90 } }), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);
    const project = await generateProject("gemini", "gemini-flash-test", key, "Make a tiny collecting game.", null, "Arcade");
    expect(project.title).toBe("Orb Garden");
    expect(project.files[0].path).toBe("index.html");
    expect(project.inputTokens).toBe(120);
    const options = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(new Headers(options.headers).get("x-goog-api-key")).toBe(key);
  });

  it("turns provider timeouts into bounded retryable errors", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new DOMException("request timed out", "TimeoutError"); }));
    try {
      await generateProject("groq", "model-test", "groq-secret-test-key", "A small arcade game with a timer.", null);
      throw new Error("Expected timeout");
    } catch (error) {
      expect(error).toMatchObject({ code: "GENERATION_TIMEOUT", status: 504 });
      expect((error as Error).message).not.toContain("groq-secret-test-key");
    }
  });
});
