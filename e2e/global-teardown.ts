import { cleanupDatabase, closeDb } from "./support/db.ts";

export default async function globalTeardown() {
  if (process.env.E2E_KEEP_DATA === "1") return;
  await cleanupDatabase();
  await closeDb();
}
