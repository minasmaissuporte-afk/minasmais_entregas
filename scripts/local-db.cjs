// Liga/desliga o Postgres local do projeto (instância própria, porta 5433, sem precisar de administrador).
// Uso: node scripts/local-db.cjs start | stop | status
const { spawnSync, spawn } = require("node:child_process");
const path = require("node:path");
const fs = require("node:fs");

const pgBin = process.env.PG_BIN || "C:\\Program Files\\PostgreSQL\\18\\bin";
const baseDir =
  process.env.LOCAL_PG_DIR ||
  path.join(process.env.LOCALAPPDATA || path.join(require("node:os").homedir(), ".local"), "minas-mais-pg");
const dataDir = path.join(baseDir, "data");
const logFile = path.join(baseDir, "postgres.log");
const port = process.env.LOCAL_PG_PORT || "5433";
const pgCtl = path.join(pgBin, process.platform === "win32" ? "pg_ctl.exe" : "pg_ctl");

if (!fs.existsSync(dataDir)) {
  console.error(`Pasta de dados não encontrada: ${dataDir}`);
  process.exit(1);
}

const command = process.argv[2] || "status";

if (command === "start") {
  // stdio "ignore" + detached: o pg_ctl não prende o terminal.
  const child = spawn(
    pgCtl,
    ["-D", dataDir, "-o", `-p ${port} -c listen_addresses=localhost`, "-l", logFile, "-w", "start"],
    { stdio: "ignore", detached: true, windowsHide: true },
  );
  child.on("exit", (code) => {
    console.log(code === 0 ? `Postgres local ligado na porta ${port}.` : `Falha ao ligar (veja ${logFile}).`);
    process.exit(code ?? 1);
  });
} else if (command === "stop" || command === "status") {
  const result = spawnSync(pgCtl, ["-D", dataDir, command === "stop" ? "stop" : "status"], {
    stdio: "inherit",
    windowsHide: true,
  });
  process.exit(result.status ?? 1);
} else {
  console.error("Uso: node scripts/local-db.cjs start | stop | status");
  process.exit(1);
}
