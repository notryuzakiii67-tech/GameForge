import bcrypt from "bcryptjs";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { closeDatabase, execute, newId, nowIso, query } from "@/lib/db";
import { completePasswordRecovery, startEmailVerification, startPasswordRecovery, verifyEmailChallenge, verifyPasswordRecoveryCode } from "@/lib/recovery";
import { POST as startRecoveryRoute } from "@/app/api/auth/recovery/start/route";

vi.mock("server-only", () => ({}));

const mutableEnv = process.env as unknown as Record<string, string | undefined>;
const oldEnv = {
  databaseUrl: mutableEnv.DATABASE_URL,
  siteUrl: mutableEnv.NEXT_PUBLIC_SITE_URL,
  secret: mutableEnv.ACCOUNT_RECOVERY_SECRET,
  resendKey: mutableEnv.RESEND_API_KEY,
  emailFrom: mutableEnv.GAMEFORGE_EMAIL_FROM,
};
const databaseUrl = `file:.gameforge-local/recovery-${process.pid}.sqlite`;
const recoverySecret = "71".repeat(32);
let mailCalls: Array<{ to: string[]; subject: string; text: string }> = [];
let requestCounter = 0;

beforeAll(() => {
  mutableEnv.DATABASE_URL = databaseUrl;
  mutableEnv.NEXT_PUBLIC_SITE_URL = "http://localhost:3000";
  mutableEnv.ACCOUNT_RECOVERY_SECRET = recoverySecret;
  mutableEnv.RESEND_API_KEY = "re_test_not_a_real_key";
  mutableEnv.GAMEFORGE_EMAIL_FROM = "noreply@example.com";
});
beforeEach(() => {
  mailCalls = [];
  vi.stubGlobal("fetch", vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
    const payload = JSON.parse(String(init?.body)) as { to: string[]; subject: string; text: string };
    mailCalls.push(payload);
    return new Response(null, { status: 200 });
  }));
});
afterAll(async () => {
  vi.unstubAllGlobals();
  await closeDatabase();
  if (oldEnv.databaseUrl === undefined) delete mutableEnv.DATABASE_URL; else mutableEnv.DATABASE_URL = oldEnv.databaseUrl;
  if (oldEnv.siteUrl === undefined) delete mutableEnv.NEXT_PUBLIC_SITE_URL; else mutableEnv.NEXT_PUBLIC_SITE_URL = oldEnv.siteUrl;
  if (oldEnv.secret === undefined) delete mutableEnv.ACCOUNT_RECOVERY_SECRET; else mutableEnv.ACCOUNT_RECOVERY_SECRET = oldEnv.secret;
  if (oldEnv.resendKey === undefined) delete mutableEnv.RESEND_API_KEY; else mutableEnv.RESEND_API_KEY = oldEnv.resendKey;
  if (oldEnv.emailFrom === undefined) delete mutableEnv.GAMEFORGE_EMAIL_FROM; else mutableEnv.GAMEFORGE_EMAIL_FROM = oldEnv.emailFrom;
});

async function createUser(options: { email?: string; verified?: boolean } = {}) {
  const id = newId();
  const timestamp = nowIso();
  const email = options.email ?? `recovery-${id}@example.test`;
  const passwordHash = await bcrypt.hash("an old secure password 123", 4);
  await execute(
    `INSERT INTO users(id, username, display_name, email, email_verified_at, password_hash, role, account_status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, 'user', 'active', ?, ?)`,
    [id, `recovery_${id.slice(0, 8)}`, "Recovery Test", email, options.verified ? timestamp : null, passwordHash, timestamp, timestamp],
  );
  return { id, username: `recovery_${id.slice(0, 8)}`, email, passwordHash };
}

function codeFromLatestEmail(): string {
  const text = mailCalls.at(-1)?.text ?? "";
  const match = text.match(/: (\d{6})\n/);
  if (!match) throw new Error("Expected a six-digit code in the mocked email payload.");
  return match[1];
}

function recoveryRequest(body: unknown) {
  requestCounter += 1;
  return new Request("http://localhost:3000/api/auth/recovery/start", {
    method: "POST",
    headers: {
      origin: "http://localhost:3000",
      "content-type": "application/json",
      "x-forwarded-for": `203.0.113.${(requestCounter % 200) + 1}`,
    },
    body: JSON.stringify(body),
  });
}

describe("email contact verification and password recovery", () => {
  it("keeps recovery-start responses generic for unknown, unverified, and verified accounts", async () => {
    const unverified = await createUser();
    const verified = await createUser({ verified: true });

    const unknownResponse = await startRecoveryRoute(recoveryRequest({ identifier: "account_does_not_exist" }));
    const unverifiedResponse = await startRecoveryRoute(recoveryRequest({ identifier: unverified.username }));
    const verifiedResponse = await startRecoveryRoute(recoveryRequest({ identifier: verified.username.toUpperCase() }));
    const [unknown, noContact, known] = await Promise.all([unknownResponse.json(), unverifiedResponse.json(), verifiedResponse.json()]);

    expect(unknownResponse.status).toBe(202);
    expect(unverifiedResponse.status).toBe(202);
    expect(verifiedResponse.status).toBe(202);
    expect(unknown.message).toBe(noContact.message);
    expect(noContact.message).toBe(known.message);
    expect(unknown.requestId).not.toBe(noContact.requestId);
    expect(known).not.toHaveProperty("email");
    expect(mailCalls).toHaveLength(1);
    expect(mailCalls[0].to).toEqual([verified.email]);
  });

  it("limits code delivery to three requests per account per hour", async () => {
    const user = await createUser({ verified: true });
    await startPasswordRecovery(user.username);
    await startPasswordRecovery(user.username);
    await startPasswordRecovery(user.username);
    await startPasswordRecovery(user.username);
    expect(mailCalls).toHaveLength(3);
  });

  it("verifies a newly supplied email only after the emailed code is confirmed", async () => {
    const user = await createUser({ email: `no-contact+pending-${newId()}@users.gameforge.invalid` });
    const newEmail = `verified-${user.id}@example.test`;
    const challenge = await startEmailVerification(user.id, newEmail);
    const before = await query<{ email: string; email_verified_at: string | null }>(`SELECT email, email_verified_at FROM users WHERE id = ?`, [user.id]);
    expect(before[0]).toMatchObject({ email: user.email, email_verified_at: null });
    expect(challenge.maskedEmail).toContain("@example.test");

    const result = await verifyEmailChallenge(user.id, challenge.requestId, codeFromLatestEmail());
    const after = await query<{ email: string; email_verified_at: string | null }>(`SELECT email, email_verified_at FROM users WHERE id = ?`, [user.id]);
    expect(result.email).toBe(newEmail);
    expect(after[0]?.email).toBe(newEmail);
    expect(after[0]?.email_verified_at).toBeTruthy();
    expect(await query(`SELECT id FROM audit_events WHERE target_id = ? AND event_type = 'account.email_verified'`, [user.id])).toHaveLength(1);
  });

  it("limits incorrect codes, uses a single-use reset token, revokes sessions, and changes the password", async () => {
    const user = await createUser({ verified: true });
    const timestamp = nowIso();
    await execute(`INSERT INTO sessions(id, user_id, token_hash, expires_at, created_at) VALUES (?, ?, ?, ?, ?)`, [
      newId(), user.id, `session-${user.id}`, new Date(Date.now() + 86_400_000).toISOString(), timestamp,
    ]);

    const { requestId } = await startPasswordRecovery(user.username);
    const code = codeFromLatestEmail();
    for (let attempt = 0; attempt < 4; attempt += 1) {
      await expect(verifyPasswordRecoveryCode(requestId, "000000" === code ? "000001" : "000000"))
        .rejects.toMatchObject({ code: "INVALID_OR_EXPIRED_CODE" });
    }
    const { resetToken } = await verifyPasswordRecoveryCode(requestId, code);
    expect(resetToken).not.toContain(code);
    expect(resetToken.length).toBeGreaterThan(40);

    const newPassword = "a fresh strong password 456";
    await completePasswordRecovery(resetToken, newPassword);
    const updated = await query<{ password_hash: string }>(`SELECT password_hash FROM users WHERE id = ?`, [user.id]);
    expect(await bcrypt.compare(newPassword, updated[0].password_hash)).toBe(true);
    expect(await bcrypt.compare("an old secure password 123", updated[0].password_hash)).toBe(false);
    expect(await query(`SELECT id FROM sessions WHERE user_id = ?`, [user.id])).toHaveLength(0);
    expect(await query(`SELECT id FROM audit_events WHERE target_id = ? AND event_type = 'user.password_reset'`, [user.id])).toHaveLength(1);
    await expect(completePasswordRecovery(resetToken, "another fresh strong password 789"))
      .rejects.toMatchObject({ code: "INVALID_OR_EXPIRED_RESET" });
  });

  it("consumes a password-recovery code after five failed attempts", async () => {
    const user = await createUser({ verified: true });
    const { requestId } = await startPasswordRecovery(user.email);
    const correctCode = codeFromLatestEmail();
    const wrongCode = correctCode === "000000" ? "000001" : "000000";
    for (let attempt = 0; attempt < 5; attempt += 1) {
      await expect(verifyPasswordRecoveryCode(requestId, wrongCode)).rejects.toMatchObject({ code: "INVALID_OR_EXPIRED_CODE" });
    }
    await expect(verifyPasswordRecoveryCode(requestId, correctCode)).rejects.toMatchObject({ code: "INVALID_OR_EXPIRED_CODE" });
    const challenge = await query<{ attempts: number; consumed_at: string | null }>(`SELECT attempts, consumed_at FROM account_recovery_challenges WHERE id = ?`, [requestId]);
    expect(challenge[0]).toMatchObject({ attempts: 5 });
    expect(challenge[0].consumed_at).toBeTruthy();
  });
});
