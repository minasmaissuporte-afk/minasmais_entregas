import { randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";
import type { ErrorRequestHandler, Request, RequestHandler, Response } from "express";
import { lt, sql } from "drizzle-orm";
import { apiErrorLogsTable, apiRequestStatsTable, db } from "@workspace/db";
import { logger } from "./logger";

/**
 * Métricas para o Painel técnico. Por requisição: soma na linha da hora/rota/status e,
 * se for erro (4xx menos 401, ou 5xx), guarda método, rota, status, tempo e a mensagem.
 * Nunca guarda corpo, query string, cabeçalhos ou tokens. Falhas aqui não afetam a resposta.
 */
export const instanceStartedAt = new Date();

const ERROR_RETENTION_DAYS = 14;
const STATS_RETENTION_DAYS = 30;

/** Rota "padrão" (com :parâmetros) para agrupar: /api/deliveries/:deliveryId. */
export function routePattern(req: Request) {
  const route = (req as Request & { route?: { path?: unknown } }).route;
  if (route && typeof route.path === "string") return `${req.baseUrl}${route.path}`;
  return "(rota não encontrada)";
}

function statusClass(status: number) {
  return `${Math.floor(status / 100)}xx`;
}

function errorMessage(res: Response): string | null {
  const body = res.locals.telemetryBody as unknown;
  if (res.locals.telemetryError) return String(res.locals.telemetryError).slice(0, 500);
  if (body && typeof body === "object") {
    const record = body as Record<string, unknown>;
    if (typeof record.error === "string") return record.error.slice(0, 500);
    const erp = record.erro as Record<string, unknown> | undefined;
    if (erp && typeof erp.mensagem === "string") return `${erp.codigo ?? ""} ${erp.mensagem}`.trim().slice(0, 500);
  }
  return null;
}

async function record(req: Request, res: Response, durationMs: number) {
  const status = res.statusCode;
  const route = routePattern(req);
  const bucket = new Date();
  bucket.setUTCMinutes(0, 0, 0);
  await db
    .insert(apiRequestStatsTable)
    .values({ bucket, method: req.method, route, statusClass: statusClass(status), count: 1, totalMs: durationMs, maxMs: durationMs })
    .onConflictDoUpdate({
      target: [apiRequestStatsTable.bucket, apiRequestStatsTable.method, apiRequestStatsTable.route, apiRequestStatsTable.statusClass],
      set: {
        count: sql`${apiRequestStatsTable.count} + 1`,
        totalMs: sql`${apiRequestStatsTable.totalMs} + ${durationMs}`,
        maxMs: sql`greatest(${apiRequestStatsTable.maxMs}, ${durationMs})`,
      },
    });
  if (status >= 400 && status !== 401) {
    const appUser = res.locals.appUser as { role?: string } | undefined;
    await db.insert(apiErrorLogsTable).values({
      id: randomUUID(),
      method: req.method,
      route,
      path: (req.originalUrl ?? req.url).split("?")[0].slice(0, 300),
      status,
      durationMs,
      message: errorMessage(res),
      requestId: (res.getHeader("X-Request-Id") as string | undefined) ?? (req.id != null ? String(req.id) : null),
      role: appUser?.role ?? (req.baseUrl.startsWith("/api/v1/erp") ? "ERP" : null),
    });
  }
  // Limpeza de vez em quando (1 a cada ~200 requisições).
  if (Math.random() < 0.005) {
    const day = 24 * 60 * 60_000;
    await db.delete(apiErrorLogsTable).where(lt(apiErrorLogsTable.createdAt, new Date(Date.now() - ERROR_RETENTION_DAYS * day)));
    await db.delete(apiRequestStatsTable).where(lt(apiRequestStatsTable.bucket, new Date(Date.now() - STATS_RETENTION_DAYS * day)));
  }
}

export const telemetryMiddleware: RequestHandler = (req, res, next) => {
  if (req.method === "OPTIONS" || process.env.API_TELEMETRY === "off") return next();
  const started = performance.now();
  const originalJson = res.json.bind(res);
  res.json = ((body: unknown) => {
    if (res.statusCode >= 400) res.locals.telemetryBody = body;
    return originalJson(body);
  }) as Response["json"];
  res.on("finish", () => {
    const duration = Math.round((performance.now() - started) * 10) / 10;
    record(req, res, duration).catch((error) => logger.warn({ err: error }, "Telemetria: não foi possível registrar a requisição"));
  });
  next();
};

/** Erro não tratado: responde JSON (em vez da página HTML padrão) e guarda a mensagem para o painel. */
export const jsonErrorHandler: ErrorRequestHandler = (error, req, res, next) => {
  if (res.headersSent) return next(error);
  const status = typeof (error as { status?: unknown }).status === "number" ? (error as { status: number }).status : 500;
  res.locals.telemetryError = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  if (status >= 500) req.log?.error({ err: error }, "Erro não tratado");
  res.status(status).json({ error: status >= 500 ? "Erro interno. Tente de novo em instantes." : "Requisição inválida." });
};
