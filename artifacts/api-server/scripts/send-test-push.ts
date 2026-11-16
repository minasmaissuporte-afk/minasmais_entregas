/**
 * Envia uma notificação de teste para administradores e central que ativaram
 * notificações no navegador (Web Push), pelo mesmo código que o sistema usa.
 * Uso: pnpm push:test
 *
 * Usa o banco do DATABASE_URL e as chaves VAPID do .env da raiz.
 */
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const rootEnv = path.resolve(here, "..", "..", "..", ".env");
if (existsSync(rootEnv)) process.loadEnvFile(rootEnv);

const { db, pool, appUsersTable, pushSubscriptionsTable } = await import("@workspace/db");
const { inArray } = await import("drizzle-orm");
const { getPushConfig, notifyCentralUsers } = await import("../src/lib/webPush.ts");

const config = getPushConfig();
console.log("Web Push configurado:", JSON.stringify(config));

const users = await db
  .select({ id: appUsersTable.id, email: appUsersTable.email })
  .from(appUsersTable)
  .where(inArray(appUsersTable.role, ["ADMIN", "CENTRAL"]));
const subscriptions = users.length
  ? await db
      .select({ userId: pushSubscriptionsTable.userId })
      .from(pushSubscriptionsTable)
      .where(inArray(pushSubscriptionsTable.userId, users.map((user) => user.id)))
  : [];

console.log(`Aparelhos com notificação ativada (admin/central): ${subscriptions.length}`);
for (const user of users) {
  const count = subscriptions.filter((s) => s.userId === user.id).length;
  if (count) console.log(`  ${user.email}: ${count}`);
}

if (!subscriptions.length) {
  console.log("Nenhum aparelho ativado. Clique em \"Ativar notificações\" em /entregas e rode de novo.");
} else {
  await notifyCentralUsers({
    title: "Teste de notificação",
    body: "Se você está vendo isto, as notificações do Minas Mais Entregas estão funcionando.",
    url: "/entregas#ocorrencias",
  });
  const remaining = await db
    .select({ userId: pushSubscriptionsTable.userId })
    .from(pushSubscriptionsTable)
    .where(inArray(pushSubscriptionsTable.userId, users.map((user) => user.id)));
  console.log(
    remaining.length === subscriptions.length
      ? "Notificação enviada ao serviço de push do navegador. Confira na tela."
      : `Atenção: ${subscriptions.length - remaining.length} inscrição(ões) foram recusadas pelo navegador e removidas.`,
  );
}

await pool.end();
