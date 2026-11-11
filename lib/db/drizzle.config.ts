import { defineConfig } from "drizzle-kit";
import { existsSync } from "fs";
import path from "path";

// Carrega o .env da raiz do monorepo em desenvolvimento local.
const rootEnv = path.join(__dirname, "..", "..", ".env");
if (!process.env.DATABASE_URL && existsSync(rootEnv)) {
  process.loadEnvFile(rootEnv);
}

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL, ensure the database is provisioned");
}

export default defineConfig({
  // Caminho relativo: o drizzle-kit não resolve caminhos absolutos com "\" no Windows
  schema: "./src/schema/index.ts",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL,
  },
});
