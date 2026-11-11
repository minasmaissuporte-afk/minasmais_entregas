import { mkdirSync } from "node:fs";
import { assertSafeEnvironment, authDir } from "./support/env.ts";
import { ensureAuthUsers } from "./support/auth.ts";
import { cleanupDatabase, closeDb, seedDatabase } from "./support/db.ts";
import type { RoleKey } from "./support/fixtures-data.ts";

export default async function globalSetup() {
  assertSafeEnvironment();
  mkdirSync(authDir, { recursive: true });

  const creds = await ensureAuthUsers();
  const ids = Object.fromEntries(Object.entries(creds).map(([k, v]) => [k, v.id])) as Record<RoleKey, string>;

  await cleanupDatabase();
  await seedDatabase(ids);
  await closeDb();
}
