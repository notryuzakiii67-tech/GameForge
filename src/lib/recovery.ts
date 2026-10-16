import "server-only";
import { createHmac, randomBytes, randomInt, timingSafeEqual } from "node:crypto";
import bcrypt from "bcryptjs";
import { isNoContactEmail, strongPasswordSchema } from "@/lib/auth-validation";
import { ApiError } from "@/lib/http";
import { execute, newId, nowIso, query, transaction } from "@/lib/db";

const CODE_TTL_MS = 10 * 60 * 1000;
const RESET_TTL_MS = 15 * 60 * 1000;
const MAX_CODE_ATTEMPTS = 5;
const EMAIL_API = "https://api.resend.com/emails";

type RecoveryPurpose = "verify_email" | "password_reset";
type RecoveryConfig = { secret: Buffer; apiKey: string; from: string };
type ChallengeRow = {
  id: string;
  user_id: string;
  purpose: RecoveryPurpose;
  contact: string;
  code_hash: string;
  attempts: number;
  expires_at: string;
  verified_at: string | null;
  consumed_at: string | null;
  reset_token_hash: string | null;
  reset_expires_at: string | null;
  reset_used_at: string | null;
};

function recoverySecret(): Buffer {
  const secretHex = process.env.ACCOUNT_RECOVERY_SECRET?.trim() ?? "";
  if (!/^[a-f0-9]{64,}$/i.test(secretHex) || secretHex.length % 2 !== 0 || Buffer.from(secretHex, "hex").length < 32) {
    throw new ApiError(503, "RECOVERY_SECRET_NOT_CONFIGURED", "Account recovery is not configured. Set ACCOUNT_RECOVERY_SECRET to at least 32 random bytes in the server environment.");
  }
  return Buffer.from(secretHex, "hex");
}

function recoveryConfig(): RecoveryConfig {
  const secret = recoverySecret();
  const apiKey = process.env.RESEND_API_KEY?.trim() ?? "";
  const from = process.env.GAMEFORGE_EMAIL_FROM?.trim() ?? "";
  if (!apiKey || !from || from.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(from)) {
    throw new ApiError(503, "EMAIL_RECOVERY_NOT_CONFIGURED", "Email recovery is not configured. Set RESEND_API_KEY and GAMEFORGE_EMAIL_FROM in the server environment.");
  }
  return { secret, apiKey, from };
}

export function assertEmailRecoveryConfigured(): void {
  recoveryConfig();
}

function digest(secret: Buffer, value: string): string {
  return createHmac("sha256", secret).update(value).digest("hex");
}

function codeDigest(secret: Buffer, id: string, userId: string, purpose: RecoveryPurpose, contact: string, code: string): string {
  return digest(secret, `code\u0000${id}\u0000${userId}\u0000${purpose}\u0000${contact}\u0000${code}`);
}

function equalDigest(left: string, right: string): boolean {
  const a = Buffer.from(left, "hex");
  const b = Buffer.from(right, "hex");
  return a.length === b.length && timingSafeEqual(a, b);
}

async function consumeAccountRateLimit(userId: string, purpose: RecoveryPurpose, limit: number, windowMs: number): Promise<boolean> {
  const now = Date.now();
  const nowIsoValue = new Date(now).toISOString();
  const resetAt = new Date(now + windowMs).toISOString();
  const key = `account-recovery:${purpose}:${digest(recoverySecret(), `rate\u0000${userId}`)}`;
  const rows = await query<{ count: number }>(
    `INSERT INTO rate_limits(bucket_key, count, reset_at) VALUES (?, 1, ?)
     ON CONFLICT(bucket_key) DO UPDATE SET
       count = CASE WHEN rate_limits.reset_at <= ? THEN 1 ELSE rate_limits.count + 1 END,
       reset_at = CASE WHEN rate_limits.reset_at <= ? THEN excluded.reset_at ELSE rate_limits.reset_at END
     RETURNING count`,
    [key, resetAt, nowIsoValue, nowIsoValue],
  );
  return Number(rows[0]?.count ?? 0) <= limit;
}

export function maskEmail(email: string): string {
  const [local, domain] = email.split("@");
  if (!local || !domain) return "your verified email";
  const visible = local.length <= 2 ? local[0] : `${local[0]}${"•".repeat(Math.min(5, local.length - 1))}`;
  return `${visible}@${domain}`;
}

async function sendCodeEmail(to: string, code: string, purpose: RecoveryPurpose): Promise<void> {
  const config = recoveryConfig();
  const subject = purpose === "verify_email" ? "Verify your GameForge email" : "Your GameForge password reset code";
  const action = purpose === "verify_email" ? "verify this email address" : "reset your GameForge password";
  const text = `Use this one-time code to ${action}: ${code}\n\nIt expires in 10 minutes. If you did not request this, you can ignore this message.`;
  try {
    const response = await fetch(EMAIL_API, {
      method: "POST",
      headers: { Authorization: `Bearer ${config.apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: config.from, to: [to], subject, text }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) throw new Error("EMAIL_DELIVERY_FAILED");
    // Do not read or log provider response bodies; they may contain private delivery metadata.
  } catch {
    console.error(JSON.stringify({ level: "warn", scope: "account-recovery", event: "email_delivery_failed" }));
    throw new ApiError(503, "EMAIL_DELIVERY_FAILED", "GameForge could not deliver the email. Check the email provider configuration and try again.");
  }
}

async function issueEmailChallenge(userId: string, purpose: RecoveryPurpose, contact: string, id = newId()): Promise<{ id: string; expiresAt: string }> {
  const config = recoveryConfig();
  const code = randomInt(0, 1_000_000).toString().padStart(6, "0");
  const timestamp = nowIso();
  const expiresAt = new Date(Date.now() + CODE_TTL_MS).toISOString();
  await execute(`DELETE FROM account_recovery_challenges WHERE created_at < ?`, [new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()]);
  await execute(
    `UPDATE account_recovery_challenges
     SET consumed_at = COALESCE(consumed_at, ?), reset_token_hash = NULL, reset_used_at = COALESCE(reset_used_at, ?)
     WHERE user_id = ? AND purpose = ?`,
    [timestamp, timestamp, userId, purpose],
  );
  await execute(
    `INSERT INTO account_recovery_challenges(id, user_id, purpose, contact, code_hash, attempts, expires_at, created_at)
     VALUES (?, ?, ?, ?, ?, 0, ?, ?)`,
    [id, userId, purpose, contact, codeDigest(config.secret, id, userId, purpose, contact, code), expiresAt, timestamp],
  );
  try {
    await sendCodeEmail(contact, code, purpose);
  } catch (error) {
    await execute(`UPDATE account_recovery_challenges SET consumed_at = ? WHERE id = ? AND consumed_at IS NULL`, [nowIso(), id]);
    throw error;
  }
  return { id, expiresAt };
}

/** Always returns a random request ID and generic success for known, unknown, and unverified accounts. */
export async function startPasswordRecovery(identifier: string): Promise<{ requestId: string }> {
  recoveryConfig();
  const requestId = newId();
  const normalized = identifier.trim().toLowerCase();
  const users = await query<{ id: string; email: string; email_verified_at: string | null }>(
    `SELECT id, email, email_verified_at FROM users
     WHERE email_verified_at IS NOT NULL AND (LOWER(username) = ? OR LOWER(email) = ?)
     ORDER BY CASE WHEN LOWER(username) = ? THEN 0 ELSE 1 END LIMIT 1`,
    [normalized, normalized, normalized],
  );
  const user = users[0];
  if (user?.email_verified_at && !isNoContactEmail(user.email) && await consumeAccountRateLimit(user.id, "password_reset", 3, 60 * 60 * 1000)) {
    try {
      await issueEmailChallenge(user.id, "password_reset", user.email, requestId);
    } catch (error) {
      if (error instanceof ApiError && error.code === "EMAIL_DELIVERY_FAILED") {
        // Keep the public response identical to avoid account enumeration. Never log identifiers or codes.
      } else {
        throw error;
      }
    }
  }
  return { requestId };
}

export async function startEmailVerification(userId: string, email: string): Promise<{ requestId: string; maskedEmail: string; expiresAt: string }> {
  recoveryConfig();
  const normalized = email.trim().toLowerCase();
  const existing = await query<{ id: string; email: string; email_verified_at: string | null }>(
    `SELECT id, email, email_verified_at FROM users WHERE id = ? LIMIT 1`, [userId]);
  if (!existing[0]) throw new ApiError(404, "ACCOUNT_NOT_FOUND", "Your account could not be found.");
  if (existing[0].email.toLowerCase() === normalized && existing[0].email_verified_at) {
    throw new ApiError(409, "EMAIL_ALREADY_VERIFIED", "That email address is already verified.");
  }
  const conflict = await query<{ id: string }>(`SELECT id FROM users WHERE LOWER(email) = ? AND id <> ? LIMIT 1`, [normalized, userId]);
  if (conflict.length) throw new ApiError(409, "EMAIL_UNAVAILABLE", "That email address cannot be used for this account.");
  if (!(await consumeAccountRateLimit(userId, "verify_email", 3, 60 * 60 * 1000))) {
    throw new ApiError(429, "EMAIL_VERIFICATION_RATE_LIMITED", "You have requested too many email codes. Try again later.");
  }
  const challenge = await issueEmailChallenge(userId, "verify_email", normalized);
  return { requestId: challenge.id, maskedEmail: maskEmail(normalized), expiresAt: challenge.expiresAt };
}

export async function verifyEmailChallenge(userId: string, requestId: string, code: string): Promise<{ email: string }> {
  const secret = recoverySecret();
  const timestamp = nowIso();
  const outcome = await transaction(async (tx) => {
    if (tx.dialect === "postgres") {
      await tx.query(`SELECT id FROM account_recovery_challenges WHERE id = ? AND user_id = ? AND purpose = 'verify_email' FOR UPDATE`, [requestId, userId]);
    }
    const rows = await tx.query<ChallengeRow>(
      `SELECT * FROM account_recovery_challenges WHERE id = ? AND user_id = ? AND purpose = 'verify_email' LIMIT 1`, [requestId, userId]);
    const challenge = rows[0];
    if (!challenge || challenge.consumed_at || challenge.attempts >= MAX_CODE_ATTEMPTS || challenge.expires_at <= timestamp) return { valid: false as const };
    const valid = equalDigest(challenge.code_hash, codeDigest(secret, challenge.id, userId, challenge.purpose, challenge.contact, code));
    if (!valid) {
      await tx.execute(
        `UPDATE account_recovery_challenges SET attempts = attempts + 1,
         consumed_at = CASE WHEN attempts >= ? THEN ? ELSE consumed_at END WHERE id = ? AND attempts < ?`,
        [MAX_CODE_ATTEMPTS - 1, timestamp, challenge.id, MAX_CODE_ATTEMPTS],
      );
      return { valid: false as const };
    }
    const current = await tx.query<{ email: string; email_verified_at: string | null }>(`SELECT email, email_verified_at FROM users WHERE id = ? LIMIT 1`, [userId]);
    const previousEmail = current[0]?.email_verified_at ? current[0].email : null;
    await tx.execute(`UPDATE users SET email = ?, email_verified_at = ?, updated_at = ? WHERE id = ?`, [challenge.contact, timestamp, timestamp, userId]);
    await tx.execute(`UPDATE account_recovery_challenges SET verified_at = ?, consumed_at = ? WHERE id = ?`, [timestamp, timestamp, challenge.id]);
    await tx.execute(
      `INSERT INTO audit_events(id, actor_id, event_type, target_type, target_id, details_json, created_at)
       VALUES (?, ?, 'account.email_verified', 'user', ?, '{}', ?)`, [newId(), userId, userId, timestamp]);
    return { valid: true as const, email: challenge.contact, previousEmail };
  });
  if (!outcome.valid) throw new ApiError(400, "INVALID_OR_EXPIRED_CODE", "That code is invalid or expired. Request a new code and try again.");
  if (outcome.previousEmail && outcome.previousEmail.toLowerCase() !== outcome.email.toLowerCase() && !isNoContactEmail(outcome.previousEmail)) {
    void sendSecurityNotice(outcome.previousEmail, "Your GameForge recovery email changed", "A recovery email was changed on your account. If you did not do this, sign in and update your account security.");
  }
  return { email: outcome.email };
}

export async function verifyPasswordRecoveryCode(requestId: string, code: string): Promise<{ resetToken: string }> {
  const secret = recoverySecret();
  const timestamp = nowIso();
  const resetToken = randomBytes(32).toString("base64url");
  const resetTokenHash = digest(secret, `reset\u0000${resetToken}`);
  const resetExpiresAt = new Date(Date.now() + RESET_TTL_MS).toISOString();
  const outcome = await transaction(async (tx) => {
    if (tx.dialect === "postgres") {
      await tx.query(`SELECT id FROM account_recovery_challenges WHERE id = ? AND purpose = 'password_reset' FOR UPDATE`, [requestId]);
    }
    const rows = await tx.query<ChallengeRow>(
      `SELECT * FROM account_recovery_challenges WHERE id = ? AND purpose = 'password_reset' LIMIT 1`, [requestId]);
    const challenge = rows[0];
    if (!challenge || challenge.consumed_at || challenge.attempts >= MAX_CODE_ATTEMPTS || challenge.expires_at <= timestamp) return false;
    const valid = equalDigest(challenge.code_hash, codeDigest(secret, challenge.id, challenge.user_id, challenge.purpose, challenge.contact, code));
    if (!valid) {
      await tx.execute(
        `UPDATE account_recovery_challenges SET attempts = attempts + 1,
         consumed_at = CASE WHEN attempts >= ? THEN ? ELSE consumed_at END WHERE id = ? AND attempts < ?`,
        [MAX_CODE_ATTEMPTS - 1, timestamp, challenge.id, MAX_CODE_ATTEMPTS],
      );
      return false;
    }
    await tx.execute(
      `UPDATE account_recovery_challenges SET verified_at = ?, consumed_at = ?, reset_token_hash = ?, reset_expires_at = ? WHERE id = ? AND consumed_at IS NULL`,
      [timestamp, timestamp, resetTokenHash, resetExpiresAt, challenge.id],
    );
    return true;
  });
  if (!outcome) throw new ApiError(400, "INVALID_OR_EXPIRED_CODE", "That code is invalid or expired. Request a new code and try again.");
  return { resetToken };
}

export async function completePasswordRecovery(resetToken: string, password: string): Promise<void> {
  const parsedPassword = strongPasswordSchema.safeParse(password);
  if (!parsedPassword.success) throw new ApiError(400, "INVALID_PASSWORD", "Password must be at least 12 characters and no more than 72 UTF-8 bytes.");
  const secret = recoverySecret();
  const timestamp = nowIso();
  const tokenHash = digest(secret, `reset\u0000${resetToken}`);
  const passwordHash = await bcrypt.hash(parsedPassword.data, 12);
  const changed = await transaction(async (tx) => {
    if (tx.dialect === "postgres") {
      await tx.query(`SELECT id FROM account_recovery_challenges WHERE reset_token_hash = ? FOR UPDATE`, [tokenHash]);
    }
    const rows = await tx.query<{ id: string; user_id: string; contact: string }>(
      `SELECT id, user_id, contact FROM account_recovery_challenges
       WHERE reset_token_hash = ? AND purpose = 'password_reset' AND verified_at IS NOT NULL
         AND reset_expires_at > ? AND reset_used_at IS NULL LIMIT 1`, [tokenHash, timestamp]);
    const challenge = rows[0];
    if (!challenge) return null;
    const users = await tx.query<{ email: string; email_verified_at: string | null }>(`SELECT email, email_verified_at FROM users WHERE id = ? LIMIT 1`, [challenge.user_id]);
    if (!users[0]) return null;
    await tx.execute(`UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?`, [passwordHash, timestamp, challenge.user_id]);
    await tx.execute(`DELETE FROM sessions WHERE user_id = ?`, [challenge.user_id]);
    await tx.execute(`UPDATE account_recovery_challenges SET reset_used_at = ?, reset_token_hash = NULL WHERE id = ?`, [timestamp, challenge.id]);
    await tx.execute(
      `UPDATE account_recovery_challenges SET consumed_at = COALESCE(consumed_at, ?), reset_token_hash = NULL,
       reset_used_at = COALESCE(reset_used_at, ?) WHERE user_id = ? AND id <> ?`,
      [timestamp, timestamp, challenge.user_id, challenge.id],
    );
    await tx.execute(
      `INSERT INTO audit_events(id, actor_id, event_type, target_type, target_id, details_json, created_at)
       VALUES (?, NULL, 'user.password_reset', 'user', ?, '{}', ?)`, [newId(), challenge.user_id, timestamp]);
    return { userId: challenge.user_id, email: users[0].email, emailVerified: Boolean(users[0].email_verified_at) };
  });
  if (!changed) throw new ApiError(400, "INVALID_OR_EXPIRED_RESET", "That password reset link is invalid or expired. Request a new code.");
  if (changed.emailVerified && !isNoContactEmail(changed.email)) {
    void sendSecurityNotice(changed.email, "Your GameForge password changed", "Your GameForge password was reset. If you did not request this, contact support immediately.");
  }
}

export async function sendSecurityNotice(to: string, subject: string, text: string): Promise<void> {
  try {
    const config = recoveryConfig();
    const response = await fetch(EMAIL_API, {
      method: "POST",
      headers: { Authorization: `Bearer ${config.apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: config.from, to: [to], subject, text }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) throw new Error("EMAIL_DELIVERY_FAILED");
  } catch {
    // Notifications are best-effort after the security-sensitive change has committed.
  }
}
