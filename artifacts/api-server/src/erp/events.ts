import { randomUUID } from "node:crypto";
import { db, erpIntegrationEventsTable } from "@workspace/db";
import { logger } from "../lib/logger";

export type ErpOperation = "CREATE" | "UPDATE" | "CANCEL" | "QUERY" | "AUTH";

/** Guarda o corpo recebido (até ~32 KB) para diagnóstico e reprocessamento pelo administrador. */
function storablePayload(payload: unknown) {
  if (payload == null) return null;
  try {
    const text = JSON.stringify(payload);
    return text.length > 32_000 ? { truncado: true, inicio: text.slice(0, 2000) } : payload;
  } catch {
    return null;
  }
}

export async function recordEvent(event: {
  credentialId: string | null;
  operation: ErpOperation;
  saleId?: string | null;
  storeCode?: string | null;
  outcome: string;
  httpStatus: number;
  errorCode?: string | null;
  errorMessage?: string | null;
  payload?: unknown;
  deliveryId?: string | null;
  clientIp?: string | null;
  requestId?: string | null;
  reprocessOf?: string | null;
}) {
  const id = randomUUID();
  try {
    await db.insert(erpIntegrationEventsTable).values({
      id,
      credentialId: event.credentialId,
      operation: event.operation,
      saleId: event.saleId?.slice(0, 64) ?? null,
      storeCode: event.storeCode?.slice(0, 32) ?? null,
      outcome: event.outcome,
      httpStatus: event.httpStatus,
      errorCode: event.errorCode ?? null,
      errorMessage: event.errorMessage?.slice(0, 1000) ?? null,
      payload: storablePayload(event.payload),
      deliveryId: event.deliveryId ?? null,
      clientIp: event.clientIp ?? null,
      requestId: event.requestId ?? null,
      reprocessOf: event.reprocessOf ?? null,
    });
  } catch (error) {
    logger.error({ err: error, operation: event.operation }, "ERP: não foi possível gravar a auditoria");
  }
  return id;
}

/** Tira do corpo os campos de identificação para a auditoria (sem expor nada sensível nos logs). */
export function saleKeys(body: unknown) {
  const record = body && typeof body === "object" ? (body as Record<string, unknown>) : {};
  const asText = (value: unknown) => (typeof value === "string" || typeof value === "number" ? String(value).trim() : null);
  return { saleId: asText(record.idVenda), storeCode: asText(record.codigoFilial) };
}
