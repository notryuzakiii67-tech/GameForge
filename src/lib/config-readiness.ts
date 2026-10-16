export type ReadinessStatus = "pass" | "warning" | "fail";
export type ReadinessCheck = { name: string; status: ReadinessStatus; message: string };
export type ProductionReadiness = { ready: boolean; checks: ReadinessCheck[] };

type Environment = Record<string, string | undefined>;

function parseOrigin(value: string | undefined): URL | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password || url.pathname !== "/" || url.search || url.hash) return null;
    return url;
  } catch { return null; }
}

export function evaluateProductionConfig(env: Environment): ProductionReadiness {
  const checks: ReadinessCheck[] = [];
  const add = (name: string, status: ReadinessStatus, message: string) => checks.push({ name, status, message });

  const database = env.DATABASE_URL;
  let postgresConfigured = false;
  if (database) {
    try {
      const parsed = new URL(database);
      postgresConfigured = (parsed.protocol === "postgres:" || parsed.protocol === "postgresql:") && Boolean(parsed.hostname && parsed.pathname.length > 1);
    } catch { postgresConfigured = false; }
  }
  add("Production database", postgresConfigured ? "pass" : "fail", postgresConfigured
    ? "PostgreSQL connection string shape is present; connectivity and schema are not tested."
    : "Set DATABASE_URL to the intended PostgreSQL database. SQLite is not production-ready.");

  const appOrigin = parseOrigin(env.NEXT_PUBLIC_SITE_URL);
  add("Canonical app origin", appOrigin ? "pass" : "fail", appOrigin
    ? "A separate HTTPS app origin is configured."
    : "Set NEXT_PUBLIC_SITE_URL to the HTTPS app origin only, with no path, query, or fragment.");

  const s3Keys = ["S3_BUCKET", "S3_REGION", "S3_ACCESS_KEY_ID", "S3_SECRET_ACCESS_KEY"] as const;
  const configuredS3Count = s3Keys.filter((key) => Boolean(env[key]?.trim())).length;
  const s3Complete = configuredS3Count === s3Keys.length;
  add("Private object storage", s3Complete ? "pass" : "fail", s3Complete
    ? "Required S3-compatible settings are present; credentials, permissions, bucket privacy, and CORS are not tested."
    : "Set S3_BUCKET, S3_REGION, S3_ACCESS_KEY_ID, and S3_SECRET_ACCESS_KEY for private object storage.");

  if (env.S3_ENDPOINT?.trim()) {
    let endpointOk = false;
    try { const endpoint = new URL(env.S3_ENDPOINT); endpointOk = endpoint.protocol === "https:" && !endpoint.username && !endpoint.password; } catch { endpointOk = false; }
    add("S3 endpoint", endpointOk ? "pass" : "fail", endpointOk
      ? "Custom storage endpoint has a valid HTTPS URL shape; it has not been contacted."
      : "S3_ENDPOINT must be an HTTPS URL without embedded credentials.");
  }

  const contentOrigin = parseOrigin(env.GAME_CONTENT_ORIGIN);
  const contentOriginOk = Boolean(contentOrigin && appOrigin && contentOrigin.origin !== appOrigin.origin);
  add("Isolated game-content origin", contentOriginOk ? "pass" : "fail", contentOriginOk
    ? "A distinct HTTPS game-content origin is configured; host ownership, CSP behavior, and deployment are not tested."
    : "Set GAME_CONTENT_ORIGIN to a distinct HTTPS origin from NEXT_PUBLIC_SITE_URL.");

  const cronConfigured = Boolean(env.CRON_SECRET && env.CRON_SECRET.length >= 32);
  add("Scheduled cleanup authorization", cronConfigured ? "pass" : "fail", cronConfigured
    ? "CRON_SECRET meets the minimum length; Vercel schedule delivery is not tested."
    : "Set a server-only CRON_SECRET with at least 32 characters for the configured cleanup schedule.");

  const recoveryKeys = ["ACCOUNT_RECOVERY_SECRET", "RESEND_API_KEY", "GAMEFORGE_EMAIL_FROM"] as const;
  const recoveryCount = recoveryKeys.filter((key) => Boolean(env[key]?.trim())).length;
  const recoveryReady = recoveryCount === recoveryKeys.length && (env.ACCOUNT_RECOVERY_SECRET?.length ?? 0) >= 32;
  if (recoveryCount === 0) add("Email recovery", "warning", "Email verification and recovery are disabled until all recovery and Resend settings are configured.");
  else add("Email recovery", recoveryReady ? "pass" : "fail", recoveryReady
    ? "Required email-recovery settings are present; Resend credentials and delivery are not tested."
    : "Configure ACCOUNT_RECOVERY_SECRET (at least 32 characters), RESEND_API_KEY, and GAMEFORGE_EMAIL_FROM together.");

  const aiKeys = ["GEMINI_API_KEY", "MISTRAL_API_KEY", "GROQ_API_KEY"] as const;
  const configuredProviders = aiKeys.filter((key) => Boolean(env[key]?.trim())).length;
  add("AI provider keys", configuredProviders ? "pass" : "warning", configuredProviders
    ? `${configuredProviders} provider key${configuredProviders === 1 ? " is" : "s are"} configured; model access, quota, billing, and fallback behavior are not tested.`
    : "No AI provider key is configured; AI generation will be unavailable.");

  return { ready: checks.every((check) => check.status !== "fail"), checks };
}
