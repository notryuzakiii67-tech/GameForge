import { mkdir } from "node:fs/promises";
import path from "node:path";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import postgres, { type Sql } from "postgres";
import { migrations } from "@/lib/migrations";

export type DbValue = string | number | bigint | boolean | null | Uint8Array;
type SqliteHandle = DatabaseSync;
type Driver = { kind: "sqlite"; client: SqliteHandle } | { kind: "postgres"; client: Sql };

let driverPromise: Promise<Driver> | undefined;
let migrationPromise: Promise<void> | undefined;

export class DatabaseConfigurationError extends Error {
  constructor() {
    super("DATABASE_URL must point to PostgreSQL in production.");
    this.name = "DatabaseConfigurationError";
  }
}

function isPostgresUrl(value: string): boolean {
  return value.startsWith("postgres://") || value.startsWith("postgresql://");
}

function databasePoolSize(): number {
  const value = Number(process.env.DATABASE_POOL_SIZE);
  return Number.isInteger(value) && value > 0 ? Math.min(value, 10) : 1;
}

async function createDriver(): Promise<Driver> {
  const url = process.env.DATABASE_URL?.trim();
  if (url && isPostgresUrl(url)) {
    const client = postgres(url, {
      max: databasePoolSize(),
      idle_timeout: 20,
      connect_timeout: 10,
      prepare: false,
      transform: { undefined: null },
    });
    return { kind: "postgres", client };
  }

  if (process.env.NODE_ENV === "production") {
    throw new DatabaseConfigurationError();
  }
  if (url && !url.startsWith("file:")) {
    throw new Error("DATABASE_URL must be a PostgreSQL URL or file: SQLite URL.");
  }

  const configuredPath = url?.startsWith("file:") ? url.slice("file:".length) : ".gameforge-local/gameforge.sqlite";
  const dbPath = path.isAbsolute(configuredPath) ? configuredPath : path.resolve(/*turbopackIgnore: true*/ process.cwd(), configuredPath);
  await mkdir(path.dirname(dbPath), { recursive: true });
  const client = new DatabaseSync(dbPath);
  client.exec("PRAGMA foreign_keys = ON");
  client.exec("PRAGMA journal_mode = WAL");
  client.exec("PRAGMA busy_timeout = 5000");
  return { kind: "sqlite", client };
}

async function driver(): Promise<Driver> {
  driverPromise ??= createDriver();
  return driverPromise;
}

function postgresPlaceholders(sql: string): string {
  let count = 0;
  return sql.replace(/\?/g, () => `$${++count}`);
}

async function rawAll<T>(sql: string, params: DbValue[] = []): Promise<T[]> {
  const current = await driver();
  if (current.kind === "sqlite") {
    return current.client.prepare(sql).all(...(params as SQLInputValue[])) as T[];
  }
  const rows = await current.client.unsafe(postgresPlaceholders(sql), params as never[]);
  return rows as unknown as T[];
}

async function rawRun(sql: string, params: DbValue[] = []): Promise<number> {
  const current = await driver();
  if (current.kind === "sqlite") {
    return Number(current.client.prepare(sql).run(...(params as SQLInputValue[])).changes);
  }
  const result = await current.client.unsafe(postgresPlaceholders(sql), params as never[]);
  return result.count;
}

async function applyMigrations(): Promise<void> {
  await rawRun(`CREATE TABLE IF NOT EXISTS schema_migrations (version TEXT PRIMARY KEY, applied_at TEXT NOT NULL)`);
  const applied = new Set((await rawAll<{ version: string }>(`SELECT version FROM schema_migrations`)).map((row) => row.version));

  for (const migration of migrations) {
    if (applied.has(migration.version)) continue;
    const current = await driver();
    if (current.kind === "sqlite") current.client.exec("BEGIN IMMEDIATE");
    try {
      for (const statement of migration.statements) await rawRun(statement);
      await rawRun(`INSERT INTO schema_migrations(version, applied_at) VALUES (?, ?) ON CONFLICT(version) DO NOTHING`, [
        migration.version,
        new Date().toISOString(),
      ]);
      if (current.kind === "sqlite") current.client.exec("COMMIT");
    } catch (error) {
      if (current.kind === "sqlite") current.client.exec("ROLLBACK");
      throw error;
    }
  }
}

export async function ensureDatabase(): Promise<void> {
  migrationPromise ??= applyMigrations();
  await migrationPromise;
}

export async function query<T = Record<string, unknown>>(sql: string, params: DbValue[] = []): Promise<T[]> {
  await ensureDatabase();
  return rawAll<T>(sql, params);
}

export async function execute(sql: string, params: DbValue[] = []): Promise<number> {
  await ensureDatabase();
  return rawRun(sql, params);
}

export async function closeDatabase(): Promise<void> {
  if (!driverPromise) return;
  const current = await driverPromise;
  if (current.kind === "sqlite") current.client.close();
  else await current.client.end({ timeout: 5 });
  driverPromise = undefined;
  migrationPromise = undefined;
}

export function newId(): string {
  return crypto.randomUUID();
}

export function nowIso(): string {
  return new Date().toISOString();
}
