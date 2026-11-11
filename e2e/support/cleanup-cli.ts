// Uso: pnpm --filter @workspace/e2e run clean [-- --auth]
// Remove os dados de teste do banco local e, com --auth, os logins de teste do Supabase.
import { cleanupDatabase, closeDb } from "./db.ts";
import { deleteAuthUsers } from "./auth.ts";

await cleanupDatabase();
await closeDb();
console.log("Dados E2E removidos do banco local.");
if (process.argv.includes("--auth")) {
  await deleteAuthUsers();
  console.log("Logins E2E removidos do Supabase.");
}
