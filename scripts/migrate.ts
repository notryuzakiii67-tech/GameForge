import { loadEnvConfig } from "@next/env";
import { ensureDatabase } from "../src/lib/db";

loadEnvConfig(process.cwd());

void (async () => {
  try {
    await ensureDatabase();
    console.log("GameForge database migrations are up to date.");
    process.exitCode = 0;
  } catch (error) {
    console.error(`Database migration failed (${error instanceof Error ? error.name : "unknown error"}). Check DATABASE_URL and database connectivity.`);
    process.exitCode = 1;
  }
})();
