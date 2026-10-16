import { loadEnvConfig } from "@next/env";
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { execute, query, nowIso } from "../src/lib/db";
import { logAudit } from "../src/lib/http";

loadEnvConfig(process.cwd());

void (async () => {
  const terminal = createInterface({ input, output });
  try {
    const username = (await terminal.question("Existing GameForge account username: ")).trim().toLowerCase();
    if (!/^[a-z0-9_]{3,24}$/.test(username)) throw new Error("Enter a username with 3–24 letters, numbers, or underscores.");
    const users = await query<{ id: string; username: string; role: string }>(`SELECT id, username, role FROM users WHERE LOWER(username) = ? LIMIT 1`, [username]);
    const user = users[0];
    if (!user) throw new Error("No account with that username exists. Register it first, then rerun this local administrator setup command.");
    if (user.role === "admin") {
      console.log("This account is already an administrator.");
      return;
    }
    const confirmation = await terminal.question(`Type PROMOTE ${user.username} to grant administrator access: `);
    if (confirmation !== `PROMOTE ${user.username}`) throw new Error("Confirmation did not match. No changes were made.");
    await execute(`UPDATE users SET role = 'admin', updated_at = ? WHERE id = ?`, [nowIso(), user.id]);
    await logAudit(null, "admin.initial_setup", "user", user.id, { username: user.username });
    console.log(`Administrator role granted to @${user.username}. No password was created or changed.`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : "Administrator setup failed.");
    process.exitCode = 1;
  } finally {
    terminal.close();
  }
})();
