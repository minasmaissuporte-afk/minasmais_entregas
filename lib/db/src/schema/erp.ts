import { index, integer, jsonb, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { deliveriesTable } from "./deliveries";

/**
 * Credenciais da integração com o ERP (separadas do login de pessoas).
 * O token completo só aparece uma vez, na criação. Aqui fica o prefixo público
 * (para achar a credencial) e o SHA-256 do token (para conferir).
 */
export const erpApiCredentialsTable = pgTable("erp_api_credentials", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  // Identifica o sistema de origem. Junto com o ID da venda, garante que a venda não se repete.
  source: text("source").notNull().default("ERP"),
  keyPrefix: text("key_prefix").notNull().unique(),
  secretHash: text("secret_hash").notNull(),
  createdBy: text("created_by"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
  revokedBy: text("revoked_by"),
});

/**
 * Auditoria de tudo que o ERP enviou: sucesso, duplicada, erro (com motivo) e reprocessamentos.
 * Também serve para limitar requisições por credencial e por IP.
 */
export const erpIntegrationEventsTable = pgTable(
  "erp_integration_events",
  {
    id: text("id").primaryKey(),
    credentialId: text("credential_id").references(() => erpApiCredentialsTable.id, { onDelete: "set null" }),
    // CREATE | UPDATE | CANCEL | QUERY | AUTH
    operation: text("operation").notNull(),
    saleId: text("sale_id"),
    storeCode: text("store_code"),
    // CREATED | DUPLICATE | UPDATED | CANCELLED | OK | FAILED
    outcome: text("outcome").notNull(),
    httpStatus: integer("http_status").notNull(),
    errorCode: text("error_code"),
    errorMessage: text("error_message"),
    payload: jsonb("payload"),
    deliveryId: text("delivery_id").references(() => deliveriesTable.id, { onDelete: "set null" }),
    clientIp: text("client_ip"),
    requestId: text("request_id"),
    // Reprocessamento feito pelo administrador a partir de um evento com erro.
    reprocessOf: text("reprocess_of"),
    reprocessedAt: timestamp("reprocessed_at", { withTimezone: true }),
    reprocessedBy: text("reprocessed_by"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("erp_events_created_idx").on(table.createdAt),
    index("erp_events_credential_idx").on(table.credentialId, table.createdAt),
    index("erp_events_ip_idx").on(table.clientIp, table.createdAt),
    index("erp_events_outcome_idx").on(table.outcome),
    index("erp_events_sale_idx").on(table.saleId),
  ],
);
