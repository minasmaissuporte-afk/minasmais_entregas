// Garante que as dependências sejam instaladas com pnpm (funciona em Windows, Linux e macOS).
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
for (const lockfile of ["package-lock.json", "yarn.lock"]) {
  fs.rmSync(path.join(root, lockfile), { force: true });
}

const userAgent = process.env.npm_config_user_agent || "";
if (!userAgent.startsWith("pnpm/")) {
  console.error("Use pnpm para instalar as dependências deste projeto.");
  process.exit(1);
}
