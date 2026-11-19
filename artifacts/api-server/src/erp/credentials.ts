import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { and, count, eq, gte, isNull } from "drizzle-orm";
import { db, erpApiCredentialsTable, erpIntegrationEventsTable } from "@workspace/db";

/**
 * Token da integração: mmerp_<prefixo>_<segredo>.
 * - prefixo (12 hex): público, identifica a credencial no painel e na busca;
 * - segredo (32 bytes aleatórios): nunca é guardado; o banco só tem o SHA-256 do token inteiro.
 * Como o segredo tem 256 bits de entropia, SHA-256 basta (não precisa de bcrypt).
 */
const TOKEN_PATTERN = /^mmerp_([0-9a-f]{12})_([A-Za-z0-9_-]{43})$/;

export type ErpCredential = typeof erpApiCredentialsTable.$inferSelect;

function hashToken(token: string) {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

export async function createCredential(name: string, createdBy: string) {
  const keyPrefix = randomBytes(6).toString("hex");
  const token = `mmerp_${keyPrefix}_${randomBytes(32).toString("base64url")}`;
  const [credential] = await db
    .insert(erpApiCredentialsTable)
    .values({
      id: randomUUID(),
      name: name.trim(),
      keyPrefix,
      secretHash: hashToken(token),
      createdBy,
    })
    .returning();
  return { credential, token };
}

/** Lê o token do cabeçalho Authorization: Bearer … ou X-API-Key. */
export function tokenFromHeaders(headers: Record<string, string | string[] | undefined>) {
  const authorization = typeof headers.authorization === "string" ? headers.authorization.trim() : "";
  if (/^bearer\s+/i.test(authorization)) return authorization.replace(/^bearer\s+/i, "").trim() || null;
  const apiKey = headers["x-api-key"];
  return typeof apiKey === "string" && apiKey.trim() ? apiKey.trim() : null;
}

/** Confere o token. Retorna a credencial ativa ou null (inválida, desconhecida ou revogada). */
export async function verifyToken(token: string | null): Promise<ErpCredential | null> {
  if (!token) return null;
  const match = TOKEN_PATTERN.exec(token);
  if (!match) return null;
  const [credential] = await db
    .select()
    .from(erpApiCredentialsTable)
    .where(and(eq(erpApiCredentialsTable.keyPrefix, match[1]), isNull(erpApiCredentialsTable.revokedAt)))
    .limit(1);
  if (!credential) return null;
  const expected = Buffer.from(credential.secretHash, "hex");
  const received = Buffer.from(hashToken(token), "hex");
  if (expected.length !== received.length || !timingSafeEqual(expected, received)) return null;
  return credential;
}

export async function touchCredential(id: string) {
  await db.update(erpApiCredentialsTable).set({ lastUsedAt: new Date() }).where(eq(erpApiCredentialsTable.id, id));
}

/** Limites (contados na auditoria, então valem entre todas as instâncias da Vercel). */
export const RATE_LIMIT_PER_MINUTE = 120;
export const AUTH_FAILURES_PER_10_MIN = 20;

export async function requestsInLastMinute(credentialId: string) {
  const [row] = await db
    .select({ total: count() })
    .from(erpIntegrationEventsTable)
    .where(
      and(
        eq(erpIntegrationEventsTable.credentialId, credentialId),
        gte(erpIntegrationEventsTable.createdAt, new Date(Date.now() - 60_000)),
      ),
    );
  return Number(row?.total ?? 0);
}

export async function authFailuresFromIp(ip: string) {
  const [row] = await db
    .select({ total: count() })
    .from(erpIntegrationEventsTable)
    .where(
      and(
        eq(erpIntegrationEventsTable.clientIp, ip),
        eq(erpIntegrationEventsTable.operation, "AUTH"),
        gte(erpIntegrationEventsTable.createdAt, new Date(Date.now() - 10 * 60_000)),
      ),
    );
  return Number(row?.total ?? 0);
}
