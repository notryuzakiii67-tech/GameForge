import { describe, expect, it } from "vitest";
import { evaluateProductionConfig } from "@/lib/config-readiness";

const validInfra = {
  DATABASE_URL: "postgresql://operator:private-password@db.example.invalid/gameforge",
  NEXT_PUBLIC_SITE_URL: "https://play.example.invalid",
  GAME_CONTENT_ORIGIN: "https://games.example.invalid",
  S3_BUCKET: "private-gameforge",
  S3_REGION: "us-east-1",
  S3_ACCESS_KEY_ID: "example-access-key",
  S3_SECRET_ACCESS_KEY: "example-secret-key-not-real",
  CRON_SECRET: "a-long-placeholder-cron-secret-that-is-not-real",
};

describe("production configuration readiness", () => {
  it("accepts the required configuration shape without disclosing credentials or claiming connectivity", () => {
    const result = evaluateProductionConfig({
      ...validInfra,
      ACCOUNT_RECOVERY_SECRET: "r".repeat(64),
      RESEND_API_KEY: "re_example_not_real",
      GAMEFORGE_EMAIL_FROM: "no-reply@example.invalid",
      GEMINI_API_KEY: "example-key-not-real",
    });
    expect(result.ready).toBe(true);
    expect(result.checks.every((check) => check.status !== "fail")).toBe(true);
    expect(result.checks.map((check) => check.message).join(" ")).not.toContain("private-password");
    expect(result.checks.map((check) => check.message).join(" ")).not.toContain("example-key-not-real");
    expect(result.checks.find((check) => check.name === "Private object storage")?.message).toContain("not tested");
    expect(result.checks.find((check) => check.name === "AI provider keys")?.message).toContain("not tested");
  });

  it("rejects SQLite, a shared app/content origin, weak cron secrets, and partial recovery setup", () => {
    const result = evaluateProductionConfig({
      ...validInfra,
      DATABASE_URL: "file:.gameforge-local/gameforge.sqlite",
      GAME_CONTENT_ORIGIN: "https://play.example.invalid",
      CRON_SECRET: "short",
      ACCOUNT_RECOVERY_SECRET: "configured-alone",
    });
    expect(result.ready).toBe(false);
    expect(result.checks.filter((check) => check.status === "fail").map((check) => check.name)).toEqual(expect.arrayContaining([
      "Production database", "Isolated game-content origin", "Scheduled cleanup authorization", "Email recovery",
    ]));
  });

  it("treats AI and email recovery as explicit optional warnings when absent", () => {
    const result = evaluateProductionConfig(validInfra);
    expect(result.ready).toBe(true);
    expect(result.checks.find((check) => check.name === "Email recovery")?.status).toBe("warning");
    expect(result.checks.find((check) => check.name === "AI provider keys")?.status).toBe("warning");
  });
});
