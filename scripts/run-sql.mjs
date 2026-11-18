// Roda um arquivo .sql no banco de DATABASE_URL (ou do arquivo --env indicado).
// Uso: node scripts/run-sql.mjs scripts/migrations/<arquivo>.sql [--env .env.vercel]
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(new URL("../lib/db/package.json", import.meta.url));
const pg = require("pg");

const args = process.argv.slice(2);
const file = args.find((arg) => arg.endsWith(".sql"));
const envIndex = args.indexOf("--env");
const envFile = envIndex >= 0 ? args[envIndex + 1] : ".env";
if (!file) {
  console.error("Informe o arquivo .sql");
  process.exit(1);
}
let url = process.env.DATABASE_URL;
if (!url || envIndex >= 0) {
  for (const line of readFileSync(envFile, "utf8").split(/\r?\n/)) {
    const match = line.match(/^\s*DATABASE_URL\s*=\s*(.*)\s*$/);
    if (match) url = match[1].replace(/^(['"])(.*)\1$/, "$2");
  }
}
if (!url) {
  console.error("DATABASE_URL não encontrado");
  process.exit(1);
}
const client = new pg.Client({ connectionString: url });
await client.connect();
try {
  await client.query("BEGIN");
  const result = await client.query(readFileSync(file, "utf8"));
  await client.query("COMMIT");
  const list = Array.isArray(result) ? result : [result];
  for (const item of list) console.log(item.command, item.rowCount ?? "");
} catch (error) {
  await client.query("ROLLBACK");
  console.error(error.message);
  process.exitCode = 1;
} finally {
  await client.end();
}
