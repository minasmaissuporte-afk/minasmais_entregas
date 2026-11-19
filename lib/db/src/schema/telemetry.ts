import { doublePrecision, index, integer, pgTable, primaryKey, text, timestamp } from "drizzle-orm/pg-core";

/**
 * Métricas da API para o Painel técnico: contagem por hora, rota e faixa de status.
 * Uma linha por (hora, método, rota, 2xx/4xx/5xx), somada a cada requisição.
 */
export const apiRequestStatsTable = pgTable(
  "api_request_stats",
  {
    bucket: timestamp("bucket", { withTimezone: true }).notNull(),
    method: text("method").notNull(),
    route: text("route").notNull(),
    statusClass: text("status_class").notNull(),
    count: integer("count").notNull().default(0),
    totalMs: doublePrecision("total_ms").notNull().default(0),
    maxMs: doublePrecision("max_ms").notNull().default(0),
  },
  (table) => [primaryKey({ columns: [table.bucket, table.method, table.route, table.statusClass] })],
);

/** Últimos erros da API (4xx menos 401, e 5xx). Sem corpo, sem query string, sem token. */
export const apiErrorLogsTable = pgTable(
  "api_error_logs",
  {
    id: text("id").primaryKey(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    method: text("method").notNull(),
    route: text("route").notNull(),
    path: text("path").notNull(),
    status: integer("status").notNull(),
    durationMs: doublePrecision("duration_ms").notNull(),
    message: text("message"),
    requestId: text("request_id"),
    role: text("role"),
  },
  (table) => [index("api_error_logs_created_idx").on(table.createdAt), index("api_error_logs_status_idx").on(table.status)],
);
