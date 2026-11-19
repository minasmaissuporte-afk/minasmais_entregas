import { performance } from "node:perf_hooks";
import { and, count, desc, eq, gte, ilike, inArray, isNotNull, isNull, or, sql } from "drizzle-orm";
import { Router, type IRouter } from "express";
import { GetDevRequestStatsQueryParams, ListDevApiErrorsQueryParams } from "@workspace/api-zod";
import {
  apiErrorLogsTable,
  apiRequestStatsTable,
  appUsersTable,
  couriersTable,
  db,
  deliveriesTable,
  erpApiCredentialsTable,
  nativePushTokensTable,
  pool,
  pushSubscriptionsTable,
  storesTable,
} from "@workspace/db";
import { requireRole } from "../middlewares/accessControl";
import { getPushConfig } from "../lib/webPush";
import { instanceStartedAt } from "../lib/telemetry";

/**
 * Painel técnico (administrador): deploy, serviços configurados, métricas da API,
 * erros recentes e banco de dados. Nunca devolve valores de segredos, só se estão configurados.
 */
const router: IRouter = Router();
const adminOnly = requireRole("ADMIN");

const env = (name: string) => process.env[name]?.trim() || null;
const ACTIVE_STATUSES = ["REQUESTED", "OFFERED", "AWAITING_COURIER", "ACCEPTED", "TO_STORE", "AT_STORE", "IN_TRANSIT"];

async function databasePing() {
  const started = performance.now();
  try {
    await db.execute(sql`select 1`);
    return { ok: true, latencyMs: Math.round((performance.now() - started) * 10) / 10 };
  } catch {
    return { ok: false, latencyMs: null };
  }
}

function startOfTodaySaoPaulo() {
  const day = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date());
  return new Date(`${day}T00:00:00-03:00`);
}

async function totals(since: Date) {
  const [row] = await db
    .select({
      requests: sql<number>`coalesce(sum(${apiRequestStatsTable.count}), 0)`,
      errors4xx: sql<number>`coalesce(sum(${apiRequestStatsTable.count}) filter (where ${apiRequestStatsTable.statusClass} = '4xx'), 0)`,
      errors5xx: sql<number>`coalesce(sum(${apiRequestStatsTable.count}) filter (where ${apiRequestStatsTable.statusClass} = '5xx'), 0)`,
      totalMs: sql<number>`coalesce(sum(${apiRequestStatsTable.totalMs}), 0)`,
      maxMs: sql<number | null>`max(${apiRequestStatsTable.maxMs})`,
    })
    .from(apiRequestStatsTable)
    .where(gte(apiRequestStatsTable.bucket, since));
  const requests = Number(row?.requests ?? 0);
  return {
    requests,
    errors4xx: Number(row?.errors4xx ?? 0),
    errors5xx: Number(row?.errors5xx ?? 0),
    avgMs: requests ? Math.round((Number(row.totalMs) / requests) * 10) / 10 : null,
    maxMs: row?.maxMs == null ? null : Number(row.maxMs),
  };
}

const total = async (query: Promise<{ total: number }[]>) => Number((await query)[0]?.total ?? 0);

router.get("/admin/dev/overview", adminOnly, async (_req, res): Promise<void> => {
  const database = await databasePing();
  const push = getPushConfig();
  const [
    deliveriesTotal,
    deliveriesToday,
    deliveriesActive,
    deliveriesFromErp,
    couriersTotal,
    couriersOnline,
    stores,
    users,
    pendingUsers,
    pushSubscriptions,
    nativeTokens,
    erpCredentialsActive,
  ] = await Promise.all([
    total(db.select({ total: count() }).from(deliveriesTable)),
    total(db.select({ total: count() }).from(deliveriesTable).where(gte(deliveriesTable.createdAt, startOfTodaySaoPaulo()))),
    total(db.select({ total: count() }).from(deliveriesTable).where(inArray(deliveriesTable.status, ACTIVE_STATUSES))),
    total(db.select({ total: count() }).from(deliveriesTable).where(isNotNull(deliveriesTable.erpSaleId))),
    total(db.select({ total: count() }).from(couriersTable)),
    total(db.select({ total: count() }).from(couriersTable).where(inArray(couriersTable.status, ["AVAILABLE", "BUSY"]))),
    total(db.select({ total: count() }).from(storesTable).where(eq(storesTable.active, true))),
    total(db.select({ total: count() }).from(appUsersTable)),
    total(db.select({ total: count() }).from(appUsersTable).where(eq(appUsersTable.role, "PENDING"))),
    total(db.select({ total: count() }).from(pushSubscriptionsTable)),
    total(db.select({ total: count() }).from(nativePushTokensTable)),
    total(db.select({ total: count() }).from(erpApiCredentialsTable).where(isNull(erpApiCredentialsTable.revokedAt))),
  ]);

  const owner = env("VERCEL_GIT_REPO_OWNER");
  const slug = env("VERCEL_GIT_REPO_SLUG");
  const services = [
    { key: "database", label: "Banco de dados (Postgres)", configured: Boolean(env("DATABASE_URL")), detail: database.ok ? `Conectado · ${database.latencyMs} ms` : "Sem conexão" },
    { key: "supabase-auth", label: "Login (Supabase Auth)", configured: Boolean(env("SUPABASE_URL")), detail: env("SUPABASE_JWT_SECRET") ? "Validação por segredo JWT" : "Validação por chaves públicas (JWKS)" },
    { key: "supabase-admin", label: "Supabase (convites e fotos)", configured: Boolean(env("SUPABASE_SECRET_KEY") ?? env("SUPABASE_SERVICE_ROLE_KEY")), detail: `Bucket das fotos: ${env("SUPABASE_EVIDENCE_BUCKET") ?? "padrão"}` },
    { key: "google-maps", label: "Google Maps (endereços e mapas)", configured: Boolean(env("GOOGLE_MAPS_API_KEY")), detail: "Autocomplete, geocodificação e rotas" },
    { key: "google-optimization", label: "Google Route Optimization", configured: Boolean(env("GOOGLE_SERVICE_ACCOUNT_JSON") ?? env("FIREBASE_SERVICE_ACCOUNT_JSON")), detail: "Ordem sugerida das entregas do motoboy" },
    { key: "web-push", label: "Notificações web (PWA)", configured: push.enabled, detail: "Chaves VAPID" },
    { key: "native-push", label: "Notificações do app Android (Firebase)", configured: Boolean(env("FIREBASE_SERVICE_ACCOUNT_JSON")), detail: "Conta de serviço do Firebase" },
    { key: "erp", label: "Integração ERP", configured: erpCredentialsActive > 0, detail: erpCredentialsActive > 0 ? `${erpCredentialsActive} credencial(is) ativa(s)` : "Nenhuma credencial ativa" },
    { key: "public-url", label: "URL pública do painel", configured: Boolean(env("APP_PUBLIC_URL")), detail: "Links de convite e redefinição de senha" },
    { key: "initial-admin", label: "Administrador inicial", configured: Boolean(env("INITIAL_ADMIN_EMAIL") ?? env("INITIAL_ADMIN_EMAILS")), detail: "Promove o primeiro login a administrador" },
  ];

  res.json({
    environment: env("VERCEL_ENV") ?? (process.env.NODE_ENV === "production" ? "production" : "development"),
    region: env("VERCEL_REGION"),
    commitSha: env("VERCEL_GIT_COMMIT_SHA"),
    commitRef: env("VERCEL_GIT_COMMIT_REF"),
    commitMessage: env("VERCEL_GIT_COMMIT_MESSAGE")?.split("\n")[0] ?? null,
    repoUrl: owner && slug ? `https://github.com/${owner}/${slug}` : null,
    deploymentUrl: env("VERCEL_URL") ? `https://${env("VERCEL_URL")}` : null,
    nodeVersion: process.version,
    instanceStartedAt: instanceStartedAt.toISOString(),
    serverTime: new Date().toISOString(),
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    databaseOk: database.ok,
    databaseLatencyMs: database.latencyMs,
    services,
    counts: {
      deliveriesTotal,
      deliveriesToday,
      deliveriesActive,
      deliveriesFromErp,
      couriersTotal,
      couriersOnline,
      stores,
      users,
      pendingUsers,
      pushSubscriptions,
      nativeTokens,
      erpCredentialsActive,
    },
    last24h: await totals(new Date(Date.now() - 24 * 60 * 60_000)),
  });
});

router.get("/admin/dev/requests", adminOnly, async (req, res): Promise<void> => {
  const query = GetDevRequestStatsQueryParams.safeParse(req.query);
  if (!query.success) {
    res.status(400).json({ error: "Período inválido (1 a 720 horas)." });
    return;
  }
  const hours = query.data.hours ?? 24;
  const to = new Date();
  const from = new Date(to.getTime() - hours * 60 * 60_000);
  from.setUTCMinutes(0, 0, 0);

  const hourlyRows = await db
    .select({
      hour: apiRequestStatsTable.bucket,
      requests: sql<number>`sum(${apiRequestStatsTable.count})`,
      errors: sql<number>`coalesce(sum(${apiRequestStatsTable.count}) filter (where ${apiRequestStatsTable.statusClass} in ('4xx', '5xx')), 0)`,
    })
    .from(apiRequestStatsTable)
    .where(gte(apiRequestStatsTable.bucket, from))
    .groupBy(apiRequestStatsTable.bucket);
  const byHour = new Map(hourlyRows.map((row) => [new Date(row.hour).getTime(), row]));
  const hourly = [];
  for (let time = from.getTime(); time <= to.getTime(); time += 60 * 60_000) {
    const row = byHour.get(time);
    hourly.push({ hour: new Date(time).toISOString(), requests: Number(row?.requests ?? 0), errors: Number(row?.errors ?? 0) });
  }

  const routeRows = await db
    .select({
      method: apiRequestStatsTable.method,
      route: apiRequestStatsTable.route,
      requests: sql<number>`sum(${apiRequestStatsTable.count})`,
      errors4xx: sql<number>`coalesce(sum(${apiRequestStatsTable.count}) filter (where ${apiRequestStatsTable.statusClass} = '4xx'), 0)`,
      errors5xx: sql<number>`coalesce(sum(${apiRequestStatsTable.count}) filter (where ${apiRequestStatsTable.statusClass} = '5xx'), 0)`,
      totalMs: sql<number>`sum(${apiRequestStatsTable.totalMs})`,
      maxMs: sql<number>`max(${apiRequestStatsTable.maxMs})`,
    })
    .from(apiRequestStatsTable)
    .where(gte(apiRequestStatsTable.bucket, from))
    .groupBy(apiRequestStatsTable.method, apiRequestStatsTable.route)
    .orderBy(desc(sql`sum(${apiRequestStatsTable.count})`))
    .limit(100);

  res.json({
    hours,
    from: from.toISOString(),
    to: to.toISOString(),
    totals: await totals(from),
    hourly,
    routes: routeRows.map((row) => {
      const requests = Number(row.requests);
      return {
        method: row.method,
        route: row.route,
        requests,
        errors4xx: Number(row.errors4xx),
        errors5xx: Number(row.errors5xx),
        avgMs: requests ? Math.round((Number(row.totalMs) / requests) * 10) / 10 : 0,
        maxMs: Number(row.maxMs),
      };
    }),
  });
});

router.get("/admin/dev/errors", adminOnly, async (req, res): Promise<void> => {
  const query = ListDevApiErrorsQueryParams.safeParse(req.query);
  if (!query.success) {
    res.status(400).json({ error: "Filtro inválido." });
    return;
  }
  const { status = "ALL", q, limit = 100 } = query.data;
  const term = q?.trim();
  const filters = [
    status === "5XX" ? gte(apiErrorLogsTable.status, 500) : undefined,
    status === "4XX" ? sql`${apiErrorLogsTable.status} between 400 and 499` : undefined,
    term
      ? or(
          ilike(apiErrorLogsTable.route, `%${term}%`),
          ilike(apiErrorLogsTable.path, `%${term}%`),
          ilike(apiErrorLogsTable.message, `%${term}%`),
          ilike(apiErrorLogsTable.requestId, `%${term}%`),
        )
      : undefined,
  ].filter(Boolean);
  const rows = await db
    .select()
    .from(apiErrorLogsTable)
    .where(filters.length ? and(...filters) : undefined)
    .orderBy(desc(apiErrorLogsTable.createdAt))
    .limit(limit);
  res.json(
    rows.map((row) => ({
      id: row.id,
      createdAt: row.createdAt.toISOString(),
      method: row.method,
      route: row.route,
      path: row.path,
      status: row.status,
      durationMs: row.durationMs,
      message: row.message,
      requestId: row.requestId,
      role: row.role,
    })),
  );
});

router.get("/admin/dev/database", adminOnly, async (_req, res): Promise<void> => {
  const ping = await databasePing();
  let version: string | null = null;
  let sizeBytes: number | null = null;
  let tables: { name: string; rows: number; sizeBytes: number }[] = [];
  try {
    const info = await db.execute<{ version: string; size: string }>(
      sql`select current_setting('server_version') as version, pg_database_size(current_database())::text as size`,
    );
    version = info.rows[0]?.version ?? null;
    sizeBytes = info.rows[0]?.size ? Number(info.rows[0].size) : null;
    const tableRows = await db.execute<{ name: string; rows: string; size: string }>(sql`
      select c.relname as name,
             greatest(coalesce(s.n_live_tup, 0), 0)::text as rows,
             pg_total_relation_size(c.oid)::text as size
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      left join pg_stat_user_tables s on s.relid = c.oid
      where n.nspname = 'public' and c.relkind = 'r'
      order by pg_total_relation_size(c.oid) desc
    `);
    tables = tableRows.rows.map((row) => ({ name: row.name, rows: Number(row.rows), sizeBytes: Number(row.size) }));
  } catch {
    // Sem permissão para as views de estatística: mostra só o que deu para ler.
  }
  res.json({
    ok: ping.ok,
    version,
    sizeBytes,
    latencyMs: ping.latencyMs,
    pool: {
      total: pool.totalCount,
      idle: pool.idleCount,
      waiting: pool.waitingCount,
      max: Number(process.env.PG_POOL_MAX ?? 10),
    },
    tables,
  });
});

export default router;
