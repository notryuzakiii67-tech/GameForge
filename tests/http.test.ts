import { afterEach, describe, expect, it } from "vitest";
import { DatabaseConfigurationError } from "@/lib/db";
import { ApiError, assertSameOrigin, errorResponse } from "@/lib/http";

const mutableEnv = process.env as unknown as Record<string, string | undefined>;
const previousSiteUrl = mutableEnv.NEXT_PUBLIC_SITE_URL;
const previousNodeEnv = mutableEnv.NODE_ENV;

afterEach(() => {
  if (previousSiteUrl === undefined) delete mutableEnv.NEXT_PUBLIC_SITE_URL;
  else mutableEnv.NEXT_PUBLIC_SITE_URL = previousSiteUrl;
  if (previousNodeEnv === undefined) delete mutableEnv.NODE_ENV;
  else mutableEnv.NODE_ENV = previousNodeEnv;
});

describe("HTTP error handling", () => {
  it("returns a clear service-unavailable response for a missing production database", async () => {
    const response = errorResponse(new DatabaseConfigurationError());
    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({ error: { code: "DATABASE_NOT_CONFIGURED" } });
  });
});

describe("mutation request origin checks", () => {
  it("accepts a same-origin browser request", () => {
    delete process.env.NEXT_PUBLIC_SITE_URL;
    expect(() => assertSameOrigin(new Request("https://gameforge.test/api/me", {
      method: "POST",
      headers: { origin: "https://gameforge.test" },
    }))).not.toThrow();
  });

  it("uses a same-origin Referer when Origin is omitted", () => {
    delete process.env.NEXT_PUBLIC_SITE_URL;
    expect(() => assertSameOrigin(new Request("https://gameforge.test/api/me", {
      method: "POST",
      headers: { referer: "https://gameforge.test/settings" },
    }))).not.toThrow();
  });

  it("rejects missing, malformed, and cross-origin sources", () => {
    delete process.env.NEXT_PUBLIC_SITE_URL;
    const requests = [
      new Request("https://gameforge.test/api/me", { method: "POST" }),
      new Request("https://gameforge.test/api/me", { method: "POST", headers: { origin: "not a URL" } }),
      new Request("https://gameforge.test/api/me", { method: "POST", headers: { origin: "https://attacker.test" } }),
    ];
    for (const request of requests) {
      expect(() => assertSameOrigin(request)).toThrow(ApiError);
    }
  });

  it("respects the configured public site origin in production", () => {
    mutableEnv.NODE_ENV = "production";
    process.env.NEXT_PUBLIC_SITE_URL = "https://play.gameforge.test/";
    expect(() => assertSameOrigin(new Request("https://play.gameforge.test/api/me", {
      method: "POST",
      headers: { origin: "https://play.gameforge.test" },
    }))).not.toThrow();
    expect(() => assertSameOrigin(new Request("https://preview.gameforge.test/api/me", {
      method: "POST",
      headers: { origin: "https://preview.gameforge.test" },
    }))).toThrow(ApiError);
  });

  it("accepts a same-origin forwarded host in local preview mode only", () => {
    mutableEnv.NODE_ENV = "development";
    process.env.NEXT_PUBLIC_SITE_URL = "http://localhost:3000";
    expect(() => assertSameOrigin(new Request("http://0.0.0.0:3000/api/me", {
      method: "POST",
      headers: {
        host: "0.0.0.0:3000",
        "x-forwarded-host": "3000-sandbox.example.test",
        "x-forwarded-proto": "https",
        origin: "https://3000-sandbox.example.test",
      },
    }))).not.toThrow();
    expect(() => assertSameOrigin(new Request("http://0.0.0.0:3000/api/me", {
      method: "POST",
      headers: {
        host: "0.0.0.0:3000",
        "x-forwarded-host": "3000-sandbox.example.test",
        "x-forwarded-proto": "https",
        origin: "https://attacker.example.test",
      },
    }))).toThrow(ApiError);
  });
});
