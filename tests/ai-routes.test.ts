import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { closeDatabase } from "@/lib/db";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth", () => ({
  requireUser: vi.fn(async () => ({ id: "ai-route-test-user", username: "route_tester", displayName: "Route Tester", role: "user", avatar: null, bio: "" })),
}));

import { POST as loadModels } from "@/app/api/ai/models/route";

const mutableEnv = process.env as unknown as Record<string, string | undefined>;
const previousEnv = {
  databaseUrl: mutableEnv.DATABASE_URL,
  siteUrl: mutableEnv.NEXT_PUBLIC_SITE_URL,
  geminiKey: mutableEnv.GEMINI_API_KEY,
  mistralKey: mutableEnv.MISTRAL_API_KEY,
  groqKey: mutableEnv.GROQ_API_KEY,
};
let requestCount = 0;
const databaseUrl = `file:.gameforge-local/ai-routes-${process.pid}.sqlite`;

beforeAll(() => {
  mutableEnv.DATABASE_URL = databaseUrl;
  mutableEnv.NEXT_PUBLIC_SITE_URL = "http://localhost:3000";
});
afterAll(async () => {
  await closeDatabase();
  if (previousEnv.databaseUrl === undefined) delete mutableEnv.DATABASE_URL; else mutableEnv.DATABASE_URL = previousEnv.databaseUrl;
  if (previousEnv.siteUrl === undefined) delete mutableEnv.NEXT_PUBLIC_SITE_URL; else mutableEnv.NEXT_PUBLIC_SITE_URL = previousEnv.siteUrl;
  if (previousEnv.geminiKey === undefined) delete mutableEnv.GEMINI_API_KEY; else mutableEnv.GEMINI_API_KEY = previousEnv.geminiKey;
  if (previousEnv.mistralKey === undefined) delete mutableEnv.MISTRAL_API_KEY; else mutableEnv.MISTRAL_API_KEY = previousEnv.mistralKey;
  if (previousEnv.groqKey === undefined) delete mutableEnv.GROQ_API_KEY; else mutableEnv.GROQ_API_KEY = previousEnv.groqKey;
});

function request(body: unknown) {
  requestCount += 1;
  return new Request("http://localhost:3000/api/ai/models", {
    method: "POST",
    headers: {
      origin: "http://localhost:3000",
      "content-type": "application/json",
      "x-forwarded-for": `192.0.2.${(requestCount % 200) + 1}`,
    },
    body: JSON.stringify(body),
  });
}

describe("AI model API credential boundary", () => {
  it("ignores client-supplied keys and uses only the server-side provider secret", async () => {
    const serverKey = "server-configured-gemini-key";
    const clientKey = "attacker-controlled-client-key";
    mutableEnv.GEMINI_API_KEY = serverKey;
    const fetchMock = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      return Response.json({ models: [{ name: "models/gemini-flash-test", displayName: "Flash test", supportedGenerationMethods: ["generateContent"] }] }, { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);
    try {
      const response = await loadModels(request({ provider: "gemini", apiKey: clientKey }));
      const result = await response.json();
      expect(response.status).toBe(200);
      expect(result.models).toEqual([{ id: "gemini-flash-test", displayName: "Flash test" }]);
      expect(JSON.stringify(result)).not.toContain(serverKey);
      expect(JSON.stringify(result)).not.toContain(clientKey);
      const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
      expect(new Headers(init.headers).get("x-goog-api-key")).toBe(serverKey);
      expect(fetchMock).toHaveBeenCalledTimes(1);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("returns a clear configuration error without calling the provider when its server key is absent", async () => {
    delete mutableEnv.MISTRAL_API_KEY;
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    try {
      const response = await loadModels(request({ provider: "mistral" }));
      const result = await response.json();
      expect(response.status).toBe(503);
      expect(result.error.code).toBe("AI_PROVIDER_NOT_CONFIGURED");
      expect(result.error.message).toContain("MISTRAL_API_KEY");
      expect(fetchMock).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("discovers fallback models in Gemini → Mistral → Groq order after quota limits", async () => {
    mutableEnv.GEMINI_API_KEY = "gemini-server-fallback-key";
    mutableEnv.MISTRAL_API_KEY = "mistral-server-fallback-key";
    mutableEnv.GROQ_API_KEY = "groq-server-fallback-key";
    const calls: string[] = [];
    const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      calls.push(new URL(url).hostname);
      if (url.includes("generativelanguage.googleapis.com")) return new Response(JSON.stringify({ error: { message: "quota exceeded" } }), { status: 429 });
      if (url.includes("api.mistral.ai")) return new Response(JSON.stringify({ message: "rate limit" }), { status: 429 });
      return Response.json({ data: [{ id: "llama-3.3-70b-versatile" }] }, { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);
    try {
      const response = await loadModels(request({ provider: "gemini" }));
      const result = await response.json();
      expect(response.status).toBe(200);
      expect(result).toMatchObject({ provider: "groq", requestedProvider: "gemini", fallbackFrom: "gemini", providerName: "Groq" });
      expect(result.models).toEqual([{ id: "llama-3.3-70b-versatile", displayName: "llama-3.3-70b-versatile" }]);
      expect(calls).toEqual(["generativelanguage.googleapis.com", "api.mistral.ai", "api.groq.com"]);
      expect(JSON.stringify(result)).not.toContain("server-fallback-key");
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
