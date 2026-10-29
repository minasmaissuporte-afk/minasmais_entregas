import { randomUUID } from "node:crypto";
import { and, desc, eq, ilike, or } from "drizzle-orm";
import { Router, type IRouter } from "express";
import {
  CreateDeliveryBody,
  CreateDeliveryResponse,
  DispatchDeliveryBody,
  DispatchDeliveryParams,
  DispatchDeliveryResponse,
  GetDashboardSummaryResponse,
  GetDeliveryParams,
  GetDeliveryResponse,
  ListCouriersResponse,
  ListDeliveriesQueryParams,
  ListDeliveriesResponse,
  ListStoresResponse,
  UpdateDeliveryStatusBody,
  UpdateDeliveryStatusParams,
  UpdateDeliveryStatusResponse,
} from "@workspace/api-zod";
import {
  couriersTable,
  db,
  deliveriesTable,
  deliveryEventsTable,
  storesTable,
} from "@workspace/db";

const router: IRouter = Router();

const eventLabels: Record<string, string> = {
  REQUESTED: "Entrega solicitada",
  OFFERED: "Oferta enviada aos motoboys",
  ACCEPTED: "Entrega aceita",
  TO_STORE: "Deslocamento até a loja iniciado",
  AT_STORE: "Chegada à loja confirmada",
  IN_TRANSIT: "Retirada confirmada — em trânsito",
  COMPLETED: "Entrega concluída",
  CANCELLED: "Entrega cancelada",
};

async function deliveryView(deliveryId: string) {
  const [row] = await db
    .select({
      delivery: deliveriesTable,
      storeName: storesTable.name,
      courierName: couriersTable.name,
      courierInitials: couriersTable.initials,
    })
    .from(deliveriesTable)
    .innerJoin(storesTable, eq(deliveriesTable.storeId, storesTable.id))
    .leftJoin(couriersTable, eq(deliveriesTable.courierId, couriersTable.id))
    .where(eq(deliveriesTable.id, deliveryId))
    .limit(1);

  if (!row) return null;

  const events = await db
    .select()
    .from(deliveryEventsTable)
    .where(eq(deliveryEventsTable.deliveryId, deliveryId))
    .orderBy(deliveryEventsTable.timestamp);

  return {
    ...row.delivery,
    storeName: row.storeName,
    courierName: row.courierName,
    courierInitials: row.courierInitials,
    events,
  };
}

async function addEvent(
  deliveryId: string,
  kind: string,
  label: string,
  actor: string | null = "Central de entregas",
) {
  await db.insert(deliveryEventsTable).values({
    id: randomUUID(),
    deliveryId,
    kind: kind.toLowerCase(),
    label,
    actor,
  });
}

router.get("/dashboard/summary", async (_req, res): Promise<void> => {
  const deliveries = await db.select().from(deliveriesTable);
  const couriers = await db.select().from(couriersTable);
  const events = await db.select().from(deliveryEventsTable);
  const now = Date.now();
  const activeStatuses = new Set([
    "REQUESTED",
    "OFFERED",
    "ACCEPTED",
    "TO_STORE",
    "AT_STORE",
    "IN_TRANSIT",
  ]);
  const active = deliveries.filter((item) => activeStatuses.has(item.status));
  const delayed = active.filter((item) => {
    if (item.estimatedMinutes == null) return false;
    return (
      now >
      item.createdAt.getTime() + item.estimatedMinutes * 60 * 1000
    );
  });

  const eventsByDelivery = new Map<string, typeof events>();
  for (const event of events) {
    const deliveryEvents = eventsByDelivery.get(event.deliveryId) ?? [];
    deliveryEvents.push(event);
    eventsByDelivery.set(event.deliveryId, deliveryEvents);
  }
  const acceptanceTimes: number[] = [];
  const completionTimes: number[] = [];
  for (const delivery of deliveries) {
    const deliveryEvents = eventsByDelivery.get(delivery.id) ?? [];
    const offeredAt = deliveryEvents.find((event) => event.kind === "offered")
      ?.timestamp;
    const acceptedAt = deliveryEvents.find((event) => event.kind === "accepted")
      ?.timestamp;
    const completedAt = deliveryEvents.find((event) => event.kind === "completed")
      ?.timestamp;
    if (offeredAt && acceptedAt) {
      acceptanceTimes.push(
        (acceptedAt.getTime() - offeredAt.getTime()) / 60_000,
      );
    }
    if (completedAt) {
      completionTimes.push(
        (completedAt.getTime() - delivery.createdAt.getTime()) / 60_000,
      );
    }
  }
  const average = (values: number[]) =>
    values.length
      ? Number(
          (values.reduce((total, value) => total + value, 0) / values.length)
            .toFixed(1),
        )
      : 0;

  const parsed = GetDashboardSummaryResponse.parse({
    requested: active.length,
    awaitingCourier: deliveries.filter((item) => item.status === "REQUESTED")
      .length,
    offered: deliveries.filter((item) => item.status === "OFFERED").length,
    accepted: deliveries.filter((item) =>
      ["ACCEPTED", "TO_STORE", "AT_STORE"].includes(item.status),
    ).length,
    inTransit: deliveries.filter((item) => item.status === "IN_TRANSIT").length,
    completed: deliveries.filter((item) => item.status === "COMPLETED").length,
    delayed: delayed.length,
    cancelled: deliveries.filter((item) => item.status === "CANCELLED").length,
    availableCouriers: couriers.filter((item) => item.status === "AVAILABLE")
      .length,
    busyCouriers: couriers.filter((item) => item.status === "BUSY").length,
    averageAcceptanceMinutes: average(acceptanceTimes),
    averageTotalMinutes: average(completionTimes),
  });
  res.json(parsed);
});

router.get("/deliveries", async (req, res): Promise<void> => {
  const query = ListDeliveriesQueryParams.safeParse(req.query);
  if (!query.success) {
    res.status(400).json({ error: query.error.message });
    return;
  }

  const filters = [];
  if (query.data.status) filters.push(eq(deliveriesTable.status, query.data.status));
  if (query.data.storeId)
    filters.push(eq(deliveriesTable.storeId, query.data.storeId));
  if (query.data.search) {
    const term = `%${query.data.search}%`;
    filters.push(
      or(
        ilike(deliveriesTable.code, term),
        ilike(deliveriesTable.orderNumber, term),
        ilike(deliveriesTable.customerName, term),
        ilike(deliveriesTable.destination, term),
      ),
    );
  }

  const baseQuery = db
    .select({ id: deliveriesTable.id })
    .from(deliveriesTable)
    .orderBy(desc(deliveriesTable.createdAt));
  const selected = await (filters.length
    ? baseQuery.where(and(...filters))
    : baseQuery);
  const deliveries = await Promise.all(
    selected.map((item) => deliveryView(item.id)),
  );
  res.json(ListDeliveriesResponse.parse(deliveries.filter(Boolean)));
});

router.post("/deliveries", async (req, res): Promise<void> => {
  const body = CreateDeliveryBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: body.error.message });
    return;
  }

  const [store] = await db
    .select()
    .from(storesTable)
    .where(and(eq(storesTable.id, body.data.storeId), eq(storesTable.active, true)))
    .limit(1);
  if (!store) {
    res.status(400).json({ error: "Loja não encontrada ou inativa." });
    return;
  }

  const id = randomUUID();
  const code = `MM-${randomUUID().slice(0, 6).toUpperCase()}`;
  const [created] = await db
    .insert(deliveriesTable)
    .values({
      id,
      code,
      customerName: body.data.customerName.trim(),
      customerPhone: body.data.customerPhone?.trim() || null,
      destination: body.data.destination.trim(),
      orderNumber: body.data.orderNumber.trim(),
      notes: body.data.notes?.trim() || null,
      storeId: body.data.storeId,
      status: "REQUESTED",
      priority: body.data.priority,
    })
    .returning();
  await addEvent(created.id, "REQUESTED", eventLabels.REQUESTED);
  const view = await deliveryView(created.id);
  res.status(201).json(CreateDeliveryResponse.parse(view));
});

router.get("/deliveries/:deliveryId", async (req, res): Promise<void> => {
  const params = GetDeliveryParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const delivery = await deliveryView(params.data.deliveryId);
  if (!delivery) {
    res.status(404).json({ error: "Entrega não encontrada." });
    return;
  }
  res.json(GetDeliveryResponse.parse(delivery));
});

router.post(
  "/deliveries/:deliveryId/dispatch",
  async (req, res): Promise<void> => {
    const params = DispatchDeliveryParams.safeParse(req.params);
    const body = DispatchDeliveryBody.safeParse(req.body);
    if (!params.success || !body.success) {
      res.status(400).json({
        error: !params.success
          ? params.error.message
          : !body.success
            ? body.error.message
            : "Dados inválidos.",
      });
      return;
    }

    const result = await db.transaction(async (tx) => {
      const [delivery] = await tx
        .select()
        .from(deliveriesTable)
        .where(eq(deliveriesTable.id, params.data.deliveryId))
        .for("update");
      if (!delivery) return { error: "not_found" as const };
      if (!["REQUESTED", "OFFERED"].includes(delivery.status))
        return { error: "not_dispatchable" as const };

      let courierId: string | null = null;
      if (body.data.mode === "single") {
        const [courier] = body.data.courierId
          ? await tx
              .select()
              .from(couriersTable)
              .where(
                and(
                  eq(couriersTable.id, body.data.courierId),
                  eq(couriersTable.status, "AVAILABLE"),
                ),
              )
              .limit(1)
          : await tx
              .select()
              .from(couriersTable)
              .where(eq(couriersTable.status, "AVAILABLE"))
              .limit(1);
        if (!courier) return { error: "no_courier" as const };
        courierId = courier.id;
      }

      await tx
        .update(deliveriesTable)
        .set({
          courierId,
          status: "OFFERED",
          updatedAt: new Date(),
        })
        .where(eq(deliveriesTable.id, delivery.id));
      await tx.insert(deliveryEventsTable).values({
        id: randomUUID(),
        deliveryId: delivery.id,
        kind: "offered",
        label:
          body.data.mode === "group"
            ? "Oferta enviada ao grupo de motoboys elegíveis"
            : `Oferta enviada${courierId ? " a um motoboy disponível" : ""}`,
        actor: "Central de entregas",
      });
      return { deliveryId: delivery.id };
    });

    if ("error" in result) {
      const status = result.error === "not_found" ? 404 : 409;
      const message =
        result.error === "not_found"
          ? "Entrega não encontrada."
          : result.error === "no_courier"
            ? "Não há motoboy disponível para receber a oferta."
            : "Esta entrega não pode ser redisparada no status atual.";
      res.status(status).json({ error: message });
      return;
    }
    const view = await deliveryView(result.deliveryId);
    res.json(DispatchDeliveryResponse.parse(view));
  },
);

router.patch(
  "/deliveries/:deliveryId/status",
  async (req, res): Promise<void> => {
    const params = UpdateDeliveryStatusParams.safeParse(req.params);
    const body = UpdateDeliveryStatusBody.safeParse(req.body);
    if (!params.success || !body.success) {
      res.status(400).json({
        error: !params.success
          ? params.error.message
          : !body.success
            ? body.error.message
            : "Dados inválidos.",
      });
      return;
    }

    const result = await db.transaction(async (tx) => {
      const [delivery] = await tx
        .select()
        .from(deliveriesTable)
        .where(eq(deliveriesTable.id, params.data.deliveryId))
        .for("update");
      if (!delivery) return { error: "not_found" as const };

      const nextStatus = body.data.status;
      const allowed: Record<string, string[]> = {
        REQUESTED: ["CANCELLED"],
        OFFERED: ["ACCEPTED", "CANCELLED"],
        ACCEPTED: ["TO_STORE", "AT_STORE", "CANCELLED"],
        TO_STORE: ["AT_STORE", "CANCELLED"],
        AT_STORE: ["IN_TRANSIT", "CANCELLED"],
        IN_TRANSIT: ["COMPLETED", "CANCELLED"],
      };
      if (!allowed[delivery.status]?.includes(nextStatus))
        return { error: "invalid_transition" as const };

      let courierId = delivery.courierId;
      if (nextStatus === "ACCEPTED" && !courierId) {
        const [available] = await tx
          .select()
          .from(couriersTable)
          .where(eq(couriersTable.status, "AVAILABLE"))
          .limit(1);
        if (!available) return { error: "no_courier" as const };
        courierId = available.id;
      }
      if (nextStatus === "ACCEPTED" && courierId) {
        const [updatedCourier] = await tx
          .update(couriersTable)
          .set({ status: "BUSY" })
          .where(
            and(
              eq(couriersTable.id, courierId),
              eq(couriersTable.status, "AVAILABLE"),
            ),
          )
          .returning();
        if (!updatedCourier) return { error: "courier_taken" as const };
      }

      await tx
        .update(deliveriesTable)
        .set({
          status: nextStatus,
          courierId,
          updatedAt: new Date(),
        })
        .where(eq(deliveriesTable.id, delivery.id));

      if (["COMPLETED", "CANCELLED"].includes(nextStatus) && courierId) {
        await tx
          .update(couriersTable)
          .set({ status: "AVAILABLE", currentDeliveryCode: null })
          .where(eq(couriersTable.id, courierId));
      } else if (nextStatus === "ACCEPTED" && courierId) {
        await tx
          .update(couriersTable)
          .set({ currentDeliveryCode: delivery.code })
          .where(eq(couriersTable.id, courierId));
      }

      const label = body.data.note?.trim() || eventLabels[nextStatus];
      await tx.insert(deliveryEventsTable).values({
        id: randomUUID(),
        deliveryId: delivery.id,
        kind: nextStatus.toLowerCase(),
        label,
        actor: nextStatus === "ACCEPTED" ? "Motoboy" : "Central de entregas",
      });
      return { deliveryId: delivery.id };
    });

    if ("error" in result) {
      const status = result.error === "not_found" ? 404 : 409;
      const message =
        result.error === "not_found"
          ? "Entrega não encontrada."
          : result.error === "no_courier"
            ? "Nenhum motoboy disponível pode aceitar esta oferta."
            : result.error === "courier_taken"
              ? "Este motoboy já está em outra entrega."
              : "Transição de status não permitida.";
      res.status(status).json({ error: message });
      return;
    }

    const view = await deliveryView(result.deliveryId);
    res.json(UpdateDeliveryStatusResponse.parse(view));
  },
);

router.get("/stores", async (_req, res): Promise<void> => {
  const stores = await db
    .select()
    .from(storesTable)
    .orderBy(storesTable.name);
  res.json(ListStoresResponse.parse(stores));
});

router.get("/couriers", async (_req, res): Promise<void> => {
  const couriers = await db
    .select()
    .from(couriersTable)
    .orderBy(couriersTable.name);
  res.json(
    ListCouriersResponse.parse(
      couriers.map((courier) => ({
        ...courier,
        lastLocationAt: courier.lastLocationAt?.toISOString() ?? null,
      })),
    ),
  );
});

export default router;
