import { loadEnvConfig } from "@next/env";
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { execute, query, nowIso } from "../src/lib/db";
import { logAudit } from "../src/lib/http";

loadEnvConfig(process.cwd());

void (async () => {
  const terminal = createInterface({ input, output });
  try {
    const email = (await terminal.question("Existing GameForge account email: ")).trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error("Enter a valid account email.");
    const users = await query<{ id: string; email: string; role: string }>(`SELECT id, email, role FROM users WHERE email = ? LIMIT 1`, [email]);
    const user = users[0];
    if (!user) throw new Error("No account with that email exists. Register it first, then rerun this local administrator setup command.");
    if (user.role === "admin") {
      console.log("This account is already an administrator.");
      return;
    }
    const confirmation = await terminal.question(`Type PROMOTE ${email} to grant administrator access: `);
    if (confirmation !== `PROMOTE ${email}`) throw new Error("Confirmation did not match. No changes were made.");
    await execute(`UPDATE users SET role = 'admin', updated_at = ? WHERE id = ?`, [nowIso(), user.id]);
    await logAudit(null, "admin.initial_setup", "user", user.id, { email });
    console.log(`Administrator role granted to ${email}. No password was created or changed.`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : "Administrator setup failed.");
    process.exitCode = 1;
  } finally {
    terminal.close();
  }
})();
