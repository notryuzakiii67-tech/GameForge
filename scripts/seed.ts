import { loadEnvConfig } from "@next/env";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { execute, query, newId, nowIso } from "../src/lib/db";
import { demoGames } from "../src/lib/demo-games";

loadEnvConfig(process.cwd());

async function main() {
  if (process.env.NODE_ENV === "production" && process.env.SEED_DEMO_CONTENT !== "1") {
    throw new Error("Demo content seeding is disabled in production. Set SEED_DEMO_CONTENT=1 only if you explicitly want labeled examples.");
  }
  const timestamp = nowIso();
  let demoUser = (await query<{ id: string }>(`SELECT id FROM users WHERE username = 'gameforge_demo' LIMIT 1`))[0];
  if (!demoUser) {
    // Non-login owner for bundled example rows; `!` is an invalid password hash, not a credential.
    const id = newId();
    await execute(
      `INSERT INTO users(id, username, display_name, email, password_hash, role, account_status, bio, created_at, updated_at)
       VALUES (?, 'gameforge_demo', 'GameForge Starter Studio', 'demo@local.invalid', '!', 'user', 'active', 'Small GameForge starter builds with verification notes.', ?, ?)`,
      [id, timestamp, timestamp],
    );
    demoUser = { id };
  }
  const profile = await query<{ id: string }>(`SELECT id FROM developer_profiles WHERE user_id = ?`, [demoUser.id]);
  if (!profile.length) {
    await execute(
      `INSERT INTO developer_profiles(id, user_id, studio_name, description, verification_status, created_at, updated_at)
       VALUES (?, ?, 'GameForge Starter Studio', 'A few clearly labeled browser game starter builds with verification notes.', 'unverified', ?, ?)`,
      [newId(), demoUser.id, timestamp, timestamp],
    );
  }

  for (const game of demoGames) {
    const controls = game.controls ?? "WASD or arrow keys";
    const instructions = game.instructions ?? game.description;
    const platform = game.slug === "web-arcade-maze" ? ["Desktop browser"] : ["Browser"];
    const warnings = game.slug === "web-arcade-maze" ? ["Horror themes", "Sudden jumpscare and loud sounds"] : [];
    let existing = (await query<{ id: string; is_demo: number }>(`SELECT id, is_demo FROM games WHERE slug = ? LIMIT 1`, [game.slug]))[0];
    if (existing && existing.is_demo !== 1) throw new Error(`Refusing to overwrite non-demo game slug: ${game.slug}`);
    if (!existing) {
      const id = game.id;
      await execute(
        `INSERT INTO games(id, developer_id, title, slug, description, genre, tags_json, cover_image, status, visibility,
                           version, entry_point, controls, instructions, platform_json, content_warnings_json, license,
                           remix_enabled, is_demo, published_at, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'published', 'public', '1.0.0', 'index.html', ?, ?, ?, ?, ?, 0, 1, ?, ?, ?)`,
        [id, demoUser.id, game.title, game.slug, game.description, game.genre, JSON.stringify(game.tags), game.cover,
          controls, instructions, JSON.stringify(platform), JSON.stringify(warnings), game.license ?? "GameForge demonstration content",
          timestamp, timestamp, timestamp],
      );
      existing = { id, is_demo: 1 };
    } else {
      await execute(
        `UPDATE games SET developer_id = ?, title = ?, description = ?, genre = ?, tags_json = ?, cover_image = ?,
                          status = 'published', visibility = 'public', version = '1.0.0', entry_point = 'index.html',
                          controls = ?, instructions = ?, platform_json = ?, content_warnings_json = ?, license = ?,
                          remix_enabled = 0, is_demo = 1, updated_at = ?
         WHERE id = ? AND is_demo = 1`,
        [demoUser.id, game.title, game.description, game.genre, JSON.stringify(game.tags), game.cover, controls, instructions,
          JSON.stringify(platform), JSON.stringify(warnings), game.license ?? "GameForge demonstration content", timestamp, existing.id],
      );
    }
    const version = await query<{ id: string }>(`SELECT id FROM game_versions WHERE game_id = ? AND version_number = 1`, [existing.id]);
    if (!version.length) {
      const filePath = path.join(process.cwd(), "public", "demos", game.slug, "index.html");
      const bytes = await readFile(filePath);
      await execute(
        `INSERT INTO game_versions(id, game_id, version_number, storage_key, entry_point, file_size, content_hash, validation_status, changelog, created_at)
         VALUES (?, ?, 1, ?, 'index.html', ?, ?, 'validated', 'Included as labeled GameForge demonstration content.', ?)`,
        [newId(), existing.id, `demo:${game.slug}`, bytes.byteLength, createHash("sha256").update(bytes).digest("hex"), timestamp],
      );
    }
  }
  console.log(`Seeded ${demoGames.length} clearly labeled GameForge starter builds with verification notes into the local development database.`);
}

void main().catch((error) => {
  console.error(`Seed failed (${error instanceof Error ? error.name : "unknown error"}). Check the database configuration.`);
  process.exitCode = 1;
});
