import { randomUUID } from "node:crypto";
import { and, eq, inArray, sql } from "drizzle-orm";
import {
  couriersTable,
  db,
  deliveriesTable,
  deliveryCancellationsTable,
  deliveryEventsTable,
  deliveryRoutesTable,
  storesTable,
} from "@workspace/db";
import { notifyCityCouriers, offerToCity } from "../lib/deliveryOffers";
import { notifyCouriers } from "../lib/webPush";
import { geocodeAddress } from "../lib/googleMaps";
import { logger } from "../lib/logger";
import {
  ErpSaleInput,
  normalizeStoreCode,
  paymentAliases,
  validationDetails,
  type ErpSale,
  type ErpSalePatchInput,
} from "./contract";

export class ErpError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details?: { campo: string; mensagem: string }[],
  ) {
    super(message);
  }
}

export type ErpResult = {
  httpStatus: number;
  outcome: "CREATED" | "DUPLICATE" | "UPDATED" | "CANCELLED" | "OK";
  body: Record<string, unknown>;
  deliveryId: string | null;
};

export const ERP_ACTOR = "Integração ERP";

/** Situações em que a entrega terminou: não muda mais. */
const CLOSED = new Set(["COMPLETED", "CANCELLED", "NOT_DELIVERED", "PRODUCT_RETURNED"]);
/** Ainda na fila, sem motoboy: dá para trocar endereço. */
const QUEUED = new Set(["REQUESTED", "OFFERED", "AWAITING_COURIER"]);

const statusText: Record<string, string> = {
  REQUESTED: "Solicitada",
  OFFERED: "Aguardando um motoboy aceitar",
  AWAITING_COURIER: "Aguardando outro motoboy",
  ACCEPTED: "Aceita: motoboy indo à filial",
  TO_STORE: "Aceita: motoboy indo à filial",
  AT_STORE: "Motoboy na filial",
  IN_TRANSIT: "Saiu para entrega",
  COMPLETED: "Entregue",
  CANCELLED: "Cancelada",
  NOT_DELIVERED: "Não entregue",
  RETURNING_TO_STORE: "Retornando à filial",
  PRODUCT_RETURNED: "Produto devolvido à filial",
};

const cents = (value: number | null | undefined) => (value != null && value > 0 ? Math.round(value * 100) : null);
const brl = (valueCents: number) => (valueCents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

function formatPostalCode(value: string | null | undefined) {
  const digits = (value ?? "").replace(/\D/g, "");
  return digits.length === 8 ? `${digits.slice(0, 5)}-${digits.slice(5)}` : value?.trim() || null;
}

/** "Rua X, 123, Apto 2 - Bairro, Cidade - UF, 37500-000" (o formato que a central já usa). */
function formatAddress(address: ErpSale["endereco"], fallbackCity: string, withComplement = true) {
  const street = [address.rua, address.numero || "s/n", withComplement ? address.complemento : null].filter(Boolean).join(", ");
  const cityState = [address.cidade || fallbackCity, address.estado?.toUpperCase()].filter(Boolean).join(" - ");
  return [street, [address.bairro, cityState, formatPostalCode(address.cep)].filter(Boolean).join(", ")]
    .filter(Boolean)
    .join(" - ");
}

type StoreRow = typeof storesTable.$inferSelect;

/** Converte a venda do ERP nos campos da entrega (as mesmas regras do cadastro manual). */
function deliveryFields(sale: ErpSale, store: StoreRow) {
  const order = sale.pedido ?? {};
  const method = order.formaPagamento ? paymentAliases[order.formaPagamento] : null;
  const prepaid = order.pago === true || method === "PAID" || order.valorReceber === 0;
  const paymentMethod = prepaid ? null : (method as "CASH" | "PIX" | "CARD" | null);
  if (!prepaid && !paymentMethod) {
    throw new ErpError(422, "FORMA_PAGAMENTO_OBRIGATORIA", "Informe pedido.formaPagamento (ou pedido.pago = true).", [
      { campo: "pedido.formaPagamento", mensagem: "obrigatório quando o pedido não está pago" },
    ]);
  }
  const productsAmountCents = cents(order.valorTotal);
  const notes: string[] = [];
  if (order.observacoes) notes.push(order.observacoes);
  if (sale.endereco.referencia) notes.push(`Referência: ${sale.endereco.referencia}`);
  // O sistema cobra produtos + taxa da filial. Se o ERP mandar outro valor, a central e o motoboy veem o aviso.
  const toReceive = cents(order.valorReceber);
  if (!prepaid && toReceive != null) {
    const computed = productsAmountCents != null ? productsAmountCents + store.deliveryFeeCents : null;
    if (computed == null || Math.abs(computed - toReceive) > 1) {
      notes.push(`Valor a receber informado pelo ERP: ${brl(toReceive)}`);
    }
  }
  return {
    customerName: sale.cliente.nome,
    customerPhone: sale.cliente.telefone || null,
    destination: formatAddress(sale.endereco, store.city),
    orderNumber: order.numeroPedido || sale.idVenda,
    notes: notes.join("\n") || null,
    requiresPrescription: order.receita === true,
    paymentMethod,
    changeForCents: paymentMethod === "CASH" ? cents(order.trocoPara) : null,
    bringCardMachine: paymentMethod === "CARD" ? order.levarMaquininha ?? true : null,
    productsAmountCents,
    prepaid,
  };
}

/** Coordenadas do cliente para o mapa (melhor esforço: sem Google Maps, a entrega segue sem pino). */
async function locate(sale: ErpSale, store: StoreRow) {
  try {
    const query = formatAddress(sale.endereco, store.city, false);
    const coordinate = await Promise.race([
      geocodeAddress(query),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), 5000)),
    ]);
    return coordinate ? { customerLatitude: coordinate.latitude, customerLongitude: coordinate.longitude } : null;
  } catch (error) {
    logger.info({ err: error instanceof Error ? error.message : error }, "ERP: endereço sem coordenadas");
    return null;
  }
}

async function findStore(code: string) {
  const [store] = await db.select().from(storesTable).where(eq(storesTable.erpCode, normalizeStoreCode(code))).limit(1);
  if (!store) {
    throw new ErpError(
      422,
      "FILIAL_NAO_CADASTRADA",
      `A filial "${code}" não está vinculada no Sistema de Entregas. Peça ao administrador para cadastrar o código da filial do ERP.`,
    );
  }
  if (!store.active) throw new ErpError(422, "FILIAL_INATIVA", `A filial "${code}" está inativa no Sistema de Entregas.`);
  if (store.deliveryFeeCents <= 0) {
    throw new ErpError(422, "FILIAL_SEM_TARIFA", `A filial "${code}" ainda não tem a taxa de entrega configurada.`);
  }
  return store;
}

async function findBySale(source: string, saleId: string) {
  const [row] = await db
    .select()
    .from(deliveriesTable)
    .where(and(eq(deliveriesTable.erpSource, source), eq(deliveriesTable.erpSaleId, saleId)))
    .limit(1);
  return row ?? null;
}

/** Resposta enviada ao ERP: situação da entrega, sem dados internos (motoboy só pelo nome). */
export async function erpView(deliveryId: string) {
  const [row] = await db
    .select({ delivery: deliveriesTable, store: storesTable, courierName: couriersTable.name })
    .from(deliveriesTable)
    .innerJoin(storesTable, eq(deliveriesTable.storeId, storesTable.id))
    .leftJoin(couriersTable, eq(deliveriesTable.courierId, couriersTable.id))
    .where(eq(deliveriesTable.id, deliveryId))
    .limit(1);
  if (!row) return null;
  const { delivery, store } = row;
  const events = await db
    .select({ timestamp: deliveryEventsTable.timestamp, label: deliveryEventsTable.label })
    .from(deliveryEventsTable)
    .where(eq(deliveryEventsTable.deliveryId, deliveryId))
    .orderBy(deliveryEventsTable.timestamp);
  const products = delivery.productsAmountCents;
  return {
    idVenda: delivery.erpSaleId,
    codigoEntrega: delivery.code,
    status: delivery.status,
    situacao: statusText[delivery.status] ?? delivery.status,
    filial: { codigo: store.erpCode, nome: store.name },
    cliente: { nome: delivery.customerName, telefone: delivery.customerPhone },
    endereco: delivery.destination,
    numeroPedido: delivery.orderNumber,
    pagamento: {
      formaPagamento: delivery.prepaid ? "PAGO" : delivery.paymentMethod === "CASH" ? "DINHEIRO" : delivery.paymentMethod === "CARD" ? "CARTAO" : delivery.paymentMethod,
      pago: delivery.prepaid,
      valorProdutos: products == null ? null : products / 100,
      taxaEntrega: delivery.deliveryAmountCents / 100,
      valorCobrarNaEntrega: delivery.prepaid ? 0 : products == null ? null : (products + delivery.deliveryAmountCents) / 100,
      trocoPara: delivery.changeForCents == null ? null : delivery.changeForCents / 100,
    },
    motoboy: row.courierName ? { nome: row.courierName.split(/\s+/)[0] } : null,
    criadaEm: delivery.createdAt.toISOString(),
    atualizadaEm: delivery.updatedAt.toISOString(),
    historico: events.map((event) => ({ data: event.timestamp.toISOString(), descricao: event.label })),
  };
}

async function insertEvent(deliveryId: string, kind: string, label: string) {
  await db.insert(deliveryEventsTable).values({ id: randomUUID(), deliveryId, kind, label, actor: ERP_ACTOR });
}

/** POST /entregas: cria a entrega (ou devolve a existente, se a venda já chegou antes). */
export async function createFromErp(source: string, rawBody: unknown): Promise<ErpResult> {
  const parsed = ErpSaleInput.safeParse(rawBody);
  if (!parsed.success) {
    throw new ErpError(400, "DADOS_INVALIDOS", "Confira os campos enviados.", validationDetails(parsed.error));
  }
  const sale = parsed.data;
  const duplicate = async (deliveryId: string): Promise<ErpResult> => ({
    httpStatus: 200,
    outcome: "DUPLICATE",
    body: { duplicada: true, mensagem: "Esta venda já tinha sido recebida. Nenhuma entrega nova foi criada.", entrega: await erpView(deliveryId) },
    deliveryId,
  });

  const existing = await findBySale(source, sale.idVenda);
  if (existing) return duplicate(existing.id);

  const store = await findStore(sale.codigoFilial);
  const fields = deliveryFields(sale, store);
  const coordinates = await locate(sale, store);
  const soldAt = sale.dataVenda ? new Date(sale.dataVenda) : null;

  const created = await db.transaction(async (tx) => {
    const sequence = await tx.execute<{ value: string }>(sql`select nextval('delivery_code_seq')::text as value`);
    const code = `MM-${String(sequence.rows[0]?.value ?? "").padStart(6, "0")}`;
    // A restrição única (origem + ID da venda) segura envios simultâneos da mesma venda:
    // o segundo espera o primeiro e não insere nada.
    const [row] = await tx
      .insert(deliveriesTable)
      .values({
        id: randomUUID(),
        code,
        ...fields,
        customerLatitude: coordinates?.customerLatitude ?? null,
        customerLongitude: coordinates?.customerLongitude ?? null,
        storeId: store.id,
        status: "REQUESTED",
        priority: "normal",
        deliveryAmountCents: store.deliveryFeeCents,
        erpSource: source,
        erpSaleId: sale.idVenda,
        erpSoldAt: soldAt,
        erpPayload: sale,
      })
      .onConflictDoNothing({ target: [deliveriesTable.erpSource, deliveriesTable.erpSaleId] })
      .returning();
    if (!row) return null;
    await tx.insert(deliveryEventsTable).values({
      id: randomUUID(),
      deliveryId: row.id,
      kind: "requested",
      label: `Entrega solicitada pelo ERP (venda ${sale.idVenda})`,
      actor: ERP_ACTOR,
    });
    // Mesmo fluxo do cadastro manual: vai direto para os motoboys da cidade; quem aceitar primeiro leva.
    await offerToCity(tx, { id: row.id, courierId: null }, `Enviada para os motoboys de ${store.city}`, "Sistema");
    return row;
  });

  if (!created) {
    const concurrent = await findBySale(source, sale.idVenda);
    if (concurrent) return duplicate(concurrent.id);
    throw new ErpError(500, "ERRO_INTERNO", "Não foi possível registrar a venda. Tente de novo.");
  }
  try {
    await notifyCityCouriers(created.id, "Nova entrega disponível", `${created.code} · ${store.name}. Quem aceitar primeiro leva.`);
  } catch (error) {
    logger.warn({ err: error }, "ERP: falha ao avisar os motoboys");
  }
  return {
    httpStatus: 201,
    outcome: "CREATED",
    body: { duplicada: false, mensagem: "Entrega cadastrada e enviada para os motoboys.", entrega: await erpView(created.id) },
    deliveryId: created.id,
  };
}

export async function getFromErp(source: string, saleId: string): Promise<ErpResult> {
  const delivery = await findBySale(source, saleId);
  if (!delivery) throw new ErpError(404, "VENDA_NAO_ENCONTRADA", `Nenhuma entrega com a venda "${saleId}".`);
  return { httpStatus: 200, outcome: "OK", body: { entrega: await erpView(delivery.id) }, deliveryId: delivery.id };
}

function inActiveRoute(deliveryId: string) {
  return db
    .select({ id: deliveryRoutesTable.id })
    .from(deliveryRoutesTable)
    .where(and(sql`${deliveryId} = ANY(${deliveryRoutesTable.deliveryIds})`, inArray(deliveryRoutesTable.status, ["OFFERED", "ACCEPTED"])))
    .limit(1);
}

/** PATCH /entregas/{idVenda}: atualiza dados permitidos (endereço só enquanto está na fila). */
export async function updateFromErp(source: string, saleId: string, patch: ErpSalePatchInput): Promise<ErpResult> {
  const current = await findBySale(source, saleId);
  if (!current) throw new ErpError(404, "VENDA_NAO_ENCONTRADA", `Nenhuma entrega com a venda "${saleId}".`);
  if (CLOSED.has(current.status)) {
    throw new ErpError(409, "ENTREGA_ENCERRADA", `A entrega ${current.code} já foi encerrada (${statusText[current.status] ?? current.status}) e não pode mudar.`);
  }
  const [store] = await db.select().from(storesTable).where(eq(storesTable.id, current.storeId)).limit(1);
  if (patch.codigoFilial && normalizeStoreCode(patch.codigoFilial) !== normalizeStoreCode(store.erpCode ?? "")) {
    throw new ErpError(409, "FILIAL_NAO_ALTERAVEL", "Não dá para trocar a filial de uma entrega. Cancele a venda e envie de novo com a filial certa.");
  }
  const previous = (current.erpPayload ?? {}) as ErpSale;
  const merged = ErpSaleInput.safeParse({
    ...previous,
    dataVenda: patch.dataVenda !== undefined ? patch.dataVenda : previous.dataVenda,
    cliente: { ...previous.cliente, ...stripUndefined(patch.cliente) },
    endereco: patch.endereco ?? previous.endereco,
    pedido: { ...previous.pedido, ...stripUndefined(patch.pedido) },
  });
  if (!merged.success) {
    throw new ErpError(400, "DADOS_INVALIDOS", "Confira os campos enviados.", validationDetails(merged.error));
  }
  const sale = merged.data;
  const fields = deliveryFields(sale, store);
  const addressChanged = fields.destination !== current.destination;
  if (addressChanged && (!QUEUED.has(current.status) || current.courierId || (await inActiveRoute(current.id)).length)) {
    throw new ErpError(
      409,
      "ENDERECO_BLOQUEADO",
      "O endereço só pode mudar antes de um motoboy aceitar a entrega. Fale com a central ou cancele e envie de novo.",
    );
  }
  const coordinates = addressChanged ? await locate(sale, store) : null;
  const changes: Partial<typeof deliveriesTable.$inferInsert> = {};
  for (const [key, value] of Object.entries(fields) as [keyof typeof fields, unknown][]) {
    if (key === "destination" && !addressChanged) continue;
    if ((current as Record<string, unknown>)[key] !== value) (changes as Record<string, unknown>)[key] = value;
  }
  if (addressChanged) {
    changes.customerLatitude = coordinates?.customerLatitude ?? null;
    changes.customerLongitude = coordinates?.customerLongitude ?? null;
  }
  if (patch.dataVenda !== undefined) changes.erpSoldAt = sale.dataVenda ? new Date(sale.dataVenda) : null;

  const changed = Object.keys(changes).length > 0;
  await db
    .update(deliveriesTable)
    .set({ ...changes, erpPayload: sale, ...(changed ? { updatedAt: new Date() } : {}) })
    .where(eq(deliveriesTable.id, current.id));
  if (changed) {
    await insertEvent(current.id, "edited", addressChanged ? "Dados atualizados pelo ERP (endereço alterado)" : "Dados atualizados pelo ERP");
  }
  return {
    httpStatus: 200,
    outcome: "UPDATED",
    body: {
      alterada: changed,
      mensagem: changed ? "Entrega atualizada." : "Nada mudou: os dados enviados já estavam na entrega.",
      entrega: await erpView(current.id),
    },
    deliveryId: current.id,
  };
}

function stripUndefined<T extends object>(value: T | undefined): Partial<T> {
  return Object.fromEntries(Object.entries(value ?? {}).filter(([, item]) => item !== undefined)) as Partial<T>;
}

/** POST /entregas/{idVenda}/cancelar: cancela e libera o motoboy (se houver). Repetir não dá erro. */
export async function cancelFromErp(source: string, saleId: string, reason: string | null | undefined): Promise<ErpResult> {
  const result = await db.transaction(async (tx) => {
    const [delivery] = await tx
      .select()
      .from(deliveriesTable)
      .where(and(eq(deliveriesTable.erpSource, source), eq(deliveriesTable.erpSaleId, saleId)))
      .for("update");
    if (!delivery) throw new ErpError(404, "VENDA_NAO_ENCONTRADA", `Nenhuma entrega com a venda "${saleId}".`);
    if (delivery.status === "CANCELLED") return { delivery, already: true, courierId: null as string | null };
    if (CLOSED.has(delivery.status)) {
      throw new ErpError(409, "ENTREGA_ENCERRADA", `A entrega ${delivery.code} já foi encerrada (${statusText[delivery.status] ?? delivery.status}) e não pode ser cancelada.`);
    }
    const [route] = await tx
      .select({ id: deliveryRoutesTable.id })
      .from(deliveryRoutesTable)
      .where(and(sql`${delivery.id} = ANY(${deliveryRoutesTable.deliveryIds})`, inArray(deliveryRoutesTable.status, ["OFFERED", "ACCEPTED"])))
      .limit(1);
    if (route) {
      throw new ErpError(409, "ENTREGA_EM_ROTA", `A entrega ${delivery.code} está numa rota agrupada. A central precisa tirá-la da rota antes de cancelar.`);
    }
    await tx
      .update(deliveriesTable)
      .set({ status: "CANCELLED", updatedAt: new Date() })
      .where(eq(deliveriesTable.id, delivery.id));
    await tx
      .update(deliveryCancellationsTable)
      .set({ status: "CLOSED" })
      .where(
        and(
          eq(deliveryCancellationsTable.deliveryId, delivery.id),
          inArray(deliveryCancellationsTable.status, ["AWAITING_CENTRAL", "RETURNING_TO_STORE", "ROUTE_ABORTED"]),
        ),
      );
    if (delivery.courierId) {
      // Continua ocupado só se tiver outra entrega em andamento.
      const [otherActive] = await tx
        .select({ code: deliveriesTable.code })
        .from(deliveriesTable)
        .where(
          and(
            eq(deliveriesTable.courierId, delivery.courierId),
            inArray(deliveriesTable.status, ["ACCEPTED", "TO_STORE", "AT_STORE", "IN_TRANSIT"]),
            sql`${deliveriesTable.id} <> ${delivery.id}`,
          ),
        )
        .limit(1);
      await tx
        .update(couriersTable)
        .set(otherActive ? { status: "BUSY", currentDeliveryCode: otherActive.code } : { status: "AVAILABLE", currentDeliveryCode: null })
        .where(and(eq(couriersTable.id, delivery.courierId), eq(couriersTable.status, "BUSY")));
    }
    await tx.insert(deliveryEventsTable).values({
      id: randomUUID(),
      deliveryId: delivery.id,
      kind: "cancelled",
      label: reason ? `Cancelada pelo ERP · Motivo: ${reason}` : "Cancelada pelo ERP",
      actor: ERP_ACTOR,
    });
    return { delivery, already: false, courierId: delivery.courierId };
  });

  if (result.courierId) {
    try {
      await notifyCouriers([result.courierId], {
        title: "Entrega cancelada",
        body: `${result.delivery.code} foi cancelada pela loja. Não precisa entregar.`,
      });
    } catch (error) {
      logger.warn({ err: error }, "ERP: falha ao avisar o motoboy do cancelamento");
    }
  }
  return {
    httpStatus: 200,
    outcome: "CANCELLED",
    body: {
      jaEstavaCancelada: result.already,
      mensagem: result.already ? "A entrega já estava cancelada." : "Entrega cancelada.",
      entrega: await erpView(result.delivery.id),
    },
    deliveryId: result.delivery.id,
  };
}
