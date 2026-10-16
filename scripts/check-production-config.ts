import { loadEnvConfig } from "@next/env";
import { evaluateProductionConfig } from "../src/lib/config-readiness";

loadEnvConfig(process.cwd());
const result = evaluateProductionConfig(process.env);
const symbols = { pass: "PASS", warning: "WARN", fail: "FAIL" } as const;
for (const check of result.checks) console.log(`${symbols[check.status]}  ${check.name}: ${check.message}`);
console.log("\nThis checks environment-variable shapes only; it does not connect to PostgreSQL, S3, Vercel Cron, AI providers, or Resend.");
console.log(result.ready ? "Required production configuration shape is complete." : "Required production configuration is incomplete.");
process.exitCode = result.ready ? 0 : 1;
