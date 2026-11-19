import { and, count, desc, eq, gte, ilike, isNotNull, isNull, max, or, sql } from "drizzle-orm";
import { Router, type IRouter, type Request } from "express";
import {
  CreateErpCredentialBody,
  ListErpIntegrationEventsQueryParams,
  RevokeErpCredentialParams,
  ReprocessErpIntegrationEventParams,
  UpdateErpStoreMappingBody,
  UpdateErpStoreMappingParams,
} from "@workspace/api-zod";
import { db, deliveriesTable, erpApiCredentialsTable, erpIntegrationEventsTable, storesTable } from "@workspace/db";
import { requireRole, type AppUserProfile } from "../middlewares/accessControl";
import { createCredential } from "../erp/credentials";
import { normalizeStoreCode } from "../erp/contract";
import { recordEvent, saleKeys } from "../erp/events";
import { publicOrigin, reprocessErpEvent } from "./erp";

/** Painel "Integração ERP": só para administradores. */
const router: IRouter = Router();
const adminOnly = requireRole("ADMIN");

const REPROCESSABLE = new Set(["CREATE", "UPDATE", "CANCEL"]);

function credentialView(row: typeof erpApiCredentialsTable.$inferSelect) {
  return {
    id: row.id,
    name: row.name,
    keyPrefix: `mmerp_${row.keyPrefix}_…`,
    createdAt: row.createdAt.toISOString(),
    createdBy: row.createdBy,
    lastUsedAt: row.lastUsedAt?.toISOString() ?? null,
    revokedAt: row.revokedAt?.toISOString() ?? null,
    revokedBy: row.revokedBy,
  };
}

function storeView(row: typeof storesTable.$inferSelect) {
  return {
    storeId: row.id,
    name: row.name,
    city: row.city,
    code: row.code,
    erpCode: row.erpCode,
    active: row.active,
    deliveryFee: row.deliveryFeeCents / 100,
  };
}

const eventColumns = {
  event: erpIntegrationEventsTable,
  credentialName: erpApiCredentialsTable.name,
  deliveryCode: deliveriesTable.code,
};

function eventView(row: {
  event: typeof erpIntegrationEventsTable.$inferSelect;
  credentialName: string | null;
  deliveryCode: string | null;
}) {
  const { event } = row;
  return {
    id: event.id,
    operation: event.operation,
    saleId: event.saleId,
    storeCode: event.storeCode,
    outcome: event.outcome,
    httpStatus: event.httpStatus,
    errorCode: event.errorCode,
    errorMessage: event.errorMessage,
    deliveryId: event.deliveryId,
    deliveryCode: row.deliveryCode,
    credentialName: row.credentialName,
    clientIp: event.clientIp,
    requestId: event.requestId,
    createdAt: event.createdAt.toISOString(),
    reprocessOf: event.reprocessOf,
    reprocessedAt: event.reprocessedAt?.toISOString() ?? null,
    reprocessedBy: event.reprocessedBy,
    canReprocess:
      event.outcome === "FAILED" &&
      REPROCESSABLE.has(event.operation) &&
      !event.reprocessedAt &&
      event.httpStatus !== 401 &&
      event.credentialId != null,
    payload: event.payload ?? null,
  };
}

async function loadEvent(id: string) {
  const [row] = await db
    .select(eventColumns)
    .from(erpIntegrationEventsTable)
    .leftJoin(erpApiCredentialsTable, eq(erpIntegrationEventsTable.credentialId, erpApiCredentialsTable.id))
    .leftJoin(deliveriesTable, eq(erpIntegrationEventsTable.deliveryId, deliveriesTable.id))
    .where(eq(erpIntegrationEventsTable.id, id))
    .limit(1);
  return row ?? null;
}

function actorName(req: Request, profile: AppUserProfile) {
  return profile.name || profile.email || String(req.ip);
}

router.get("/admin/erp/summary", adminOnly, async (req, res): Promise<void> => {
  let databaseOk = true;
  try {
    await db.execute(sql`select 1`);
  } catch {
    databaseOk = false;
  }
  const since = new Date(Date.now() - 24 * 60 * 60_000);
  const [credentials] = await db
    .select({ total: count() })
    .from(erpApiCredentialsTable)
    .where(isNull(erpApiCredentialsTable.revokedAt));
  const [stores] = await db
    .select({
      active: sql<number>`count(*) filter (where ${storesTable.active})`,
      mapped: sql<number>`count(*) filter (where ${storesTable.active} and ${storesTable.erpCode} is not null)`,
    })
    .from(storesTable);
  const outcomes = await db
    .select({ outcome: erpIntegrationEventsTable.outcome, total: count() })
    .from(erpIntegrationEventsTable)
    .where(and(gte(erpIntegrationEventsTable.createdAt, since), sql`${erpIntegrationEventsTable.operation} <> 'AUTH'`))
    .groupBy(erpIntegrationEventsTable.outcome);
  const [last] = await db
    .select({
      received: max(erpIntegrationEventsTable.createdAt),
      failure: sql<Date | null>`max(${erpIntegrationEventsTable.createdAt}) filter (where ${erpIntegrationEventsTable.outcome} = 'FAILED')`,
    })
    .from(erpIntegrationEventsTable)
    .where(sql`${erpIntegrationEventsTable.operation} <> 'AUTH'`);
  const byOutcome = Object.fromEntries(outcomes.map((row) => [row.outcome, Number(row.total)]));
  const origin = publicOrigin(req);
  const activeCredentials = Number(credentials?.total ?? 0);
  const toIso = (value: Date | string | null | undefined) => (value ? new Date(value).toISOString() : null);
  res.json({
    operational: databaseOk,
    databaseOk,
    baseUrl: `${origin}/api/v1/erp`,
    docsUrl: `${origin}/api/v1/erp/docs`,
    openApiUrl: `${origin}/api/v1/erp/openapi.json`,
    activeCredentials,
    storesMapped: Number(stores?.mapped ?? 0),
    storesActive: Number(stores?.active ?? 0),
    last24h: {
      received: outcomes.reduce((sum, row) => sum + Number(row.total), 0),
      created: byOutcome.CREATED ?? 0,
      duplicates: byOutcome.DUPLICATE ?? 0,
      updated: byOutcome.UPDATED ?? 0,
      cancelled: byOutcome.CANCELLED ?? 0,
      failed: byOutcome.FAILED ?? 0,
    },
    lastReceivedAt: toIso(last?.received),
    lastFailureAt: toIso(last?.failure),
  });
});

router.get("/admin/erp/credentials", adminOnly, async (_req, res): Promise<void> => {
  const rows = await db.select().from(erpApiCredentialsTable).orderBy(desc(erpApiCredentialsTable.createdAt));
  res.json(rows.map(credentialView));
});

router.post("/admin/erp/credentials", adminOnly, async (req, res): Promise<void> => {
  const body = CreateErpCredentialBody.safeParse(req.body);
  if (!body.success || !body.data.name.trim()) {
    res.status(400).json({ error: "Dê um nome à credencial (2 a 80 letras), ex.: \"ERP produção\"." });
    return;
  }
  const profile = res.locals.appUser as AppUserProfile;
  const { credential, token } = await createCredential(body.data.name, actorName(req, profile));
  req.log.info({ credentialId: credential.id }, "ERP: credencial criada");
  res.status(201).json({ credential: credentialView(credential), token });
});

router.post("/admin/erp/credentials/:credentialId/revoke", adminOnly, async (req, res): Promise<void> => {
  const params = RevokeErpCredentialParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: "Credencial inválida." });
    return;
  }
  const profile = res.locals.appUser as AppUserProfile;
  const [updated] = await db
    .update(erpApiCredentialsTable)
    .set({ revokedAt: new Date(), revokedBy: actorName(req, profile) })
    .where(and(eq(erpApiCredentialsTable.id, params.data.credentialId), isNull(erpApiCredentialsTable.revokedAt)))
    .returning();
  if (!updated) {
    const [existing] = await db
      .select()
      .from(erpApiCredentialsTable)
      .where(eq(erpApiCredentialsTable.id, params.data.credentialId))
      .limit(1);
    if (!existing) {
      res.status(404).json({ error: "Credencial não encontrada." });
      return;
    }
    res.json(credentialView(existing));
    return;
  }
  req.log.info({ credentialId: updated.id }, "ERP: credencial revogada");
  res.json(credentialView(updated));
});

router.get("/admin/erp/stores", adminOnly, async (_req, res): Promise<void> => {
  const rows = await db.select().from(storesTable).orderBy(storesTable.city, storesTable.name);
  res.json(rows.map(storeView));
});

router.put("/admin/erp/stores/:storeId", adminOnly, async (req, res): Promise<void> => {
  const params = UpdateErpStoreMappingParams.safeParse(req.params);
  const body = UpdateErpStoreMappingBody.safeParse(req.body);
  if (!params.success || !body.success) {
    res.status(400).json({ error: "Código inválido: use até 32 caracteres." });
    return;
  }
  const raw = body.data.erpCode?.trim() ?? "";
  if (raw && !/^[A-Za-z0-9._\-/]+$/.test(raw)) {
    res.status(400).json({ error: "Use só letras, números, ponto, hífen, barra ou sublinhado no código do ERP." });
    return;
  }
  const erpCode = raw ? normalizeStoreCode(raw) : null;
  if (erpCode) {
    const [taken] = await db
      .select({ id: storesTable.id, name: storesTable.name })
      .from(storesTable)
      .where(and(eq(storesTable.erpCode, erpCode), sql`${storesTable.id} <> ${params.data.storeId}`))
      .limit(1);
    if (taken) {
      res.status(409).json({ error: `O código ${erpCode} já está na filial ${taken.name}.` });
      return;
    }
  }
  const [updated] = await db
    .update(storesTable)
    .set({ erpCode })
    .where(eq(storesTable.id, params.data.storeId))
    .returning();
  if (!updated) {
    res.status(404).json({ error: "Filial não encontrada." });
    return;
  }
  res.json(storeView(updated));
});

router.get("/admin/erp/events", adminOnly, async (req, res): Promise<void> => {
  const query = ListErpIntegrationEventsQueryParams.safeParse(req.query);
  if (!query.success) {
    res.status(400).json({ error: "Filtro inválido." });
    return;
  }
  const { outcome = "ALL", q, limit = 50 } = query.data;
  const term = q?.trim();
  const filters = [
    sql`${erpIntegrationEventsTable.operation} <> 'QUERY'`,
    outcome === "ALL" ? undefined : eq(erpIntegrationEventsTable.outcome, outcome),
    term
      ? or(
          ilike(erpIntegrationEventsTable.saleId, `%${term}%`),
          ilike(erpIntegrationEventsTable.storeCode, `%${term}%`),
          ilike(erpIntegrationEventsTable.errorCode, `%${term}%`),
          ilike(deliveriesTable.code, `%${term}%`),
        )
      : undefined,
  ].filter(Boolean);
  const rows = await db
    .select(eventColumns)
    .from(erpIntegrationEventsTable)
    .leftJoin(erpApiCredentialsTable, eq(erpIntegrationEventsTable.credentialId, erpApiCredentialsTable.id))
    .leftJoin(deliveriesTable, eq(erpIntegrationEventsTable.deliveryId, deliveriesTable.id))
    .where(and(...filters))
    .orderBy(desc(erpIntegrationEventsTable.createdAt))
    .limit(limit);
  res.json(rows.map(eventView));
});

router.post("/admin/erp/events/:eventId/reprocess", adminOnly, async (req, res): Promise<void> => {
  const params = ReprocessErpIntegrationEventParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: "Evento inválido." });
    return;
  }
  const profile = res.locals.appUser as AppUserProfile;
  const actor = actorName(req, profile);
  // Marca primeiro (só um clique vence): evita reprocessar o mesmo evento duas vezes ao mesmo tempo.
  const [claimed] = await db
    .update(erpIntegrationEventsTable)
    .set({ reprocessedAt: new Date(), reprocessedBy: actor })
    .where(
      and(
        eq(erpIntegrationEventsTable.id, params.data.eventId),
        eq(erpIntegrationEventsTable.outcome, "FAILED"),
        isNull(erpIntegrationEventsTable.reprocessedAt),
        isNotNull(erpIntegrationEventsTable.credentialId),
      ),
    )
    .returning();
  if (!claimed || !REPROCESSABLE.has(claimed.operation)) {
    if (claimed) {
      await db
        .update(erpIntegrationEventsTable)
        .set({ reprocessedAt: null, reprocessedBy: null })
        .where(eq(erpIntegrationEventsTable.id, claimed.id));
    }
    res.status(409).json({ error: "Este evento não pode ser reprocessado (já foi, não deu erro ou não é um envio de venda)." });
    return;
  }
  const [credential] = await db
    .select({ source: erpApiCredentialsTable.source })
    .from(erpApiCredentialsTable)
    .where(eq(erpApiCredentialsTable.id, claimed.credentialId!))
    .limit(1);
  const { result, error } = await reprocessErpEvent({
    id: claimed.id,
    operation: claimed.operation,
    saleId: claimed.saleId,
    payload: claimed.payload,
    credentialSource: credential?.source ?? "ERP",
  });
  const keys = claimed.operation === "CREATE" ? saleKeys(claimed.payload) : { saleId: claimed.saleId, storeCode: claimed.storeCode };
  const newId = await recordEvent({
    credentialId: claimed.credentialId,
    operation: claimed.operation as "CREATE" | "UPDATE" | "CANCEL",
    ...keys,
    outcome: result?.outcome ?? "FAILED",
    httpStatus: result?.httpStatus ?? error?.status ?? 500,
    errorCode: error?.code ?? null,
    errorMessage: error
      ? error.details?.length
        ? `${error.message} ${error.details.map((item) => `${item.campo}: ${item.mensagem}`).join("; ")}`
        : error.message
      : `Reprocessado por ${actor}`,
    payload: claimed.payload,
    deliveryId: result?.deliveryId ?? null,
    requestId: null,
    reprocessOf: claimed.id,
  });
  const row = await loadEvent(newId);
  res.json(row ? eventView(row) : null);
});

export default router;
