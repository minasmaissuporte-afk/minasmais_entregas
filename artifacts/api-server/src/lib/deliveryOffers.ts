import { randomUUID } from "node:crypto";
import { sql, type SQL } from "drizzle-orm";
import {
  couriersTable,
  db,
  deliveriesTable,
  deliveryEventsTable,
  deliveryCancellationsTable,
  storesTable,
} from "@workspace/db";
import { eq, and, inArray } from "drizzle-orm";
import { notifyAvailableCouriers } from "./webPush";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/** Entrega fora de qualquer rota agrupada ativa. */
export const notInActiveRoute = sql`NOT EXISTS (
  SELECT 1 FROM delivery_routes r
  WHERE r.status IN ('OFFERED', 'ACCEPTED') AND ${deliveriesTable.id} = ANY(r.delivery_ids)
)`;

/**
 * Oferta aberta a todos os motoboys da cidade da filial: status OFFERED, sem motoboy,
 * fora de rota agrupada e não dispensada por este motoboy. Motoboy sem cidade vê todas.
 */
export function openOfferFor(courierId: string, city: string | null): SQL {
  return sql`(
    ${deliveriesTable.status} = 'OFFERED'
    AND ${deliveriesTable.courierId} IS NULL
    AND ${notInActiveRoute}
    AND NOT EXISTS (
      SELECT 1 FROM delivery_offer_declines d
      WHERE d.delivery_id = ${deliveriesTable.id} AND d.courier_id = ${courierId}
    )
    ${city
      ? sql`AND ${deliveriesTable.storeId} IN (
          SELECT s.id FROM stores s WHERE lower(trim(s.city)) = lower(trim(${city}))
        )`
      : sql``}
  )`;
}

export async function courierCity(courierId: string): Promise<string | null> {
  const [row] = await db
    .select({ city: couriersTable.city })
    .from(couriersTable)
    .where(eq(couriersTable.id, courierId))
    .limit(1);
  return row?.city?.trim() || null;
}

export function sameCity(a: string | null | undefined, b: string | null | undefined) {
  if (!a || !b) return true;
  return a.trim().toLocaleLowerCase("pt-BR") === b.trim().toLocaleLowerCase("pt-BR");
}

/**
 * Coloca a entrega na fila de todos os motoboys da cidade (quem aceitar primeiro leva).
 * Libera o motoboy anterior se ele não tiver outra entrega ativa e encerra ocorrências abertas.
 */
export async function offerToCity(
  tx: Tx,
  delivery: { id: string; courierId: string | null },
  label: string,
  actor: string,
) {
  await tx
    .update(deliveriesTable)
    .set({ status: "OFFERED", courierId: null, updatedAt: new Date() })
    .where(eq(deliveriesTable.id, delivery.id));
  await tx.execute(sql`DELETE FROM delivery_offer_declines WHERE delivery_id = ${delivery.id}`);
  await tx
    .update(deliveryCancellationsTable)
    .set({ status: "REENQUEUED" })
    .where(
      and(
        eq(deliveryCancellationsTable.deliveryId, delivery.id),
        inArray(deliveryCancellationsTable.status, ["AWAITING_CENTRAL", "RETURNING_TO_STORE", "ROUTE_ABORTED"]),
      ),
    );
  if (delivery.courierId) {
    const [stillBusy] = await tx
      .select({ id: deliveriesTable.id })
      .from(deliveriesTable)
      .where(
        and(
          eq(deliveriesTable.courierId, delivery.courierId),
          inArray(deliveriesTable.status, ["ACCEPTED", "TO_STORE", "AT_STORE", "IN_TRANSIT", "RETURNING_TO_STORE"]),
        ),
      )
      .limit(1);
    if (!stillBusy) {
      await tx
        .update(couriersTable)
        .set({ status: "AVAILABLE", currentDeliveryCode: null })
        .where(and(eq(couriersTable.id, delivery.courierId), eq(couriersTable.status, "BUSY")));
    }
  }
  await tx.insert(deliveryEventsTable).values({
    id: randomUUID(),
    deliveryId: delivery.id,
    kind: "offered",
    label,
    actor,
  });
}

/** Push para os motoboys da cidade da filial da entrega. */
export async function notifyCityCouriers(deliveryId: string, title: string, body: string) {
  const [row] = await db
    .select({ city: storesTable.city })
    .from(deliveriesTable)
    .innerJoin(storesTable, eq(deliveriesTable.storeId, storesTable.id))
    .where(eq(deliveriesTable.id, deliveryId))
    .limit(1);
  await notifyAvailableCouriers({ title, body }, row?.city ?? null);
}
