import { randomUUID } from "node:crypto";
import { clerkClient, getAuth } from "@clerk/express";
import { and, desc, eq, gte, ilike, inArray, lt, or, sql } from "drizzle-orm";
import { Router, type IRouter } from "express";
import {
  GetCourierEarningsQueryParams,
  GetCourierEarningsResponse,
  GetDeliveryAnalyticsQueryParams,
  GetDeliveryAnalyticsResponse,
  CreateDeliveryBody,
  CreateDeliveryResponse,
  DeleteAccessUserParams,
  DispatchDeliveryBody,
  DispatchDeliveryParams,
  DispatchDeliveryResponse,
  GetDashboardSummaryResponse,
  RequestDeliveryEvidenceUploadUrlBody,
  GetDeliveryParams,
  GetDeliveryResponse,
  GetMyProfileResponse,
  ListAccessUsersResponse,
  ListCouriersResponse,
  ListDeliveriesQueryParams,
  ListDeliveriesResponse,
  UpdateAccessUserBody,
  UpdateAccessUserParams,
  UpdateAccessUserResponse,
  UpdateDeliveryStatusBody,
  UpdateDeliveryStatusParams,
  UpdateDeliveryStatusResponse,
} from "@workspace/api-zod";
import {
  appUsersTable,
  couriersTable,
  db,
  deliveryEvidenceUploadsTable,
  deliveriesTable,
  deliveryEventsTable,
  deliveryRoutesTable,
  storesTable,
} from "@workspace/db";
import {
  requireAuthentication,
  requireRole,
  resolveAppUser,
  type AppRole,
  type AppUserProfile,
} from "../middlewares/accessControl";
import { ObjectStorageService } from "../lib/objectStorage";
import { verifyEvidenceUpload } from "../lib/deliveryEvidence";
import { notifyAvailableCouriers, notifyCouriers } from "../lib/webPush";

const router: IRouter = Router();

router.use(requireAuthentication);

function canAccessDelivery(profile: AppUserProfile, delivery: { storeId: string; courierId: string | null }) {
  if (profile.role === "ADMIN" || profile.role === "CENTRAL") return true;
  if (profile.role === "STORE_MANAGER" || profile.role === "STORE_STAFF") {
    return Boolean(profile.storeId && profile.storeId === delivery.storeId);
  }
  return profile.role === "COURIER" &&
    Boolean(profile.courierId && profile.courierId === delivery.courierId);
}

function startOfSaoPauloPeriod(period: "day" | "week" | "month") {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const getPart = (type: string) => Number(parts.find((part) => part.type === type)?.value);
  const localDate = new Date(Date.UTC(getPart("year"), getPart("month") - 1, getPart("day")));
  if (period === "month") localDate.setUTCDate(1);
  if (period === "week") {
    const daysSinceMonday = (localDate.getUTCDay() + 6) % 7;
    localDate.setUTCDate(localDate.getUTCDate() - daysSinceMonday);
  }

  const midnightUtcWall = Date.UTC(
    localDate.getUTCFullYear(),
    localDate.getUTCMonth(),
    localDate.getUTCDate(),
  );
  const offset = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Sao_Paulo",
    timeZoneName: "longOffset",
  })
    .formatToParts(new Date(midnightUtcWall))
    .find((part) => part.type === "timeZoneName")?.value;
  const parsedOffset = offset?.match(/^GMT([+-])(\d{2}):(\d{2})$/);
  const offsetMinutes = parsedOffset
    ? (parsedOffset[1] === "-" ? -1 : 1) *
      (Number(parsedOffset[2]) * 60 + Number(parsedOffset[3]))
    : -180;
  return new Date(midnightUtcWall - offsetMinutes * 60_000);
}

router.get("/me", async (req, res): Promise<void> => {
  const clerkUserId = getAuth(req).userId;
  if (!clerkUserId) {
    res.status(401).json({ error: "Autenticação necessária." });
    return;
  }
  const profile = await resolveAppUser(clerkUserId);
  if (!profile) {
    res.status(403).json({ error: "Não foi possível identificar o e-mail da conta." });
    return;
  }
  res.json(GetMyProfileResponse.parse(profile));
});

router.get("/access/users", requireRole("ADMIN"), async (_req, res): Promise<void> => {
  const users = await db.select().from(appUsersTable).orderBy(appUsersTable.email);
  res.json(ListAccessUsersResponse.parse(users));
});

router.patch(
  "/access/users/:userId",
  requireRole("ADMIN"),
  async (req, res): Promise<void> => {
    const params = DeleteAccessUserParams.safeParse(req.params);
    const body = UpdateAccessUserBody.safeParse(req.body);
    if (!params.success || !body.success) {
      res.status(400).json({ error: "Dados de acesso inválidos." });
      return;
    }

    const profile = res.locals.appUser as AppUserProfile;
    const [target] = await db
      .select()
      .from(appUsersTable)
      .where(eq(appUsersTable.id, params.data.userId))
      .limit(1);
    if (!target) {
      res.status(404).json({ error: "Conta não encontrada." });
      return;
    }
    if (
      target.clerkUserId === profile.clerkUserId &&
      body.data.role !== "ADMIN"
    ) {
      res.status(400).json({ error: "O administrador não pode remover o próprio acesso." });
      return;
    }

    const role = body.data.role as AppRole;
    if (target.role === "COURIER" && role !== "COURIER" && target.courierId) {
      const [activeDelivery] = await db
        .select({ id: deliveriesTable.id })
        .from(deliveriesTable)
        .where(
          and(
            eq(deliveriesTable.courierId, target.courierId),
            inArray(deliveriesTable.status, [
              "ACCEPTED",
              "TO_STORE",
              "AT_STORE",
              "IN_TRANSIT",
            ]),
          ),
        )
        .limit(1);
      const [activeRoute] = await db
        .select({ id: deliveryRoutesTable.id })
        .from(deliveryRoutesTable)
        .where(
          and(
            eq(deliveryRoutesTable.courierId, target.courierId),
            eq(deliveryRoutesTable.status, "ACCEPTED"),
          ),
        )
        .limit(1);
      if (activeDelivery || activeRoute) {
        res.status(409).json({
          error: "Conclua ou cancele as entregas e rotas do motoboy antes de alterar seu perfil.",
        });
        return;
      }
    }
    if (target.role === "ADMIN" && role !== "ADMIN") {
      const administrators = await db
        .select({ id: appUsersTable.id })
        .from(appUsersTable)
        .where(eq(appUsersTable.role, "ADMIN"));
      if (administrators.length <= 1) {
        res.status(409).json({ error: "Não é possível remover o último administrador." });
        return;
      }
    }
    const storeId = ["STORE_MANAGER", "STORE_STAFF"].includes(role)
      ? body.data.storeId ?? null
      : null;
    const courierId = role === "COURIER" ? body.data.courierId ?? null : null;
    if (role === "STORE_MANAGER" || role === "STORE_STAFF") {
      if (!storeId) {
        res.status(400).json({ error: "Selecione a unidade desta conta." });
        return;
      }
      const [store] = await db
        .select({ id: storesTable.id })
        .from(storesTable)
        .where(eq(storesTable.id, storeId))
        .limit(1);
      if (!store) {
        res.status(400).json({ error: "Unidade não encontrada." });
        return;
      }
    }
    if (role === "COURIER") {
      if (!courierId) {
        res.status(400).json({ error: "Vincule o motoboy a um cadastro." });
        return;
      }
      const [courier] = await db
        .select({ id: couriersTable.id })
        .from(couriersTable)
        .where(eq(couriersTable.id, courierId))
        .limit(1);
      if (!courier) {
        res.status(400).json({ error: "Cadastro de motoboy não encontrado." });
        return;
      }
    }

    const [updated] = await db
      .update(appUsersTable)
      .set({ role, storeId, courierId, updatedAt: new Date() })
      .where(eq(appUsersTable.id, target.id))
      .returning();
    res.json(UpdateAccessUserResponse.parse(updated));
  },
);

router.delete(
  "/access/users/:userId",
  requireRole("ADMIN"),
  async (req, res): Promise<void> => {
    const params = UpdateAccessUserParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: "Conta inválida." });
      return;
    }

    const profile = res.locals.appUser as AppUserProfile;
    const result = await db.transaction(async (tx) => {
      const [target] = await tx
        .select()
        .from(appUsersTable)
        .where(eq(appUsersTable.id, params.data.userId))
        .for("update")
        .limit(1);
      if (!target) return { error: "not_found" as const };
      if (target.clerkUserId && target.clerkUserId === profile.clerkUserId) {
        return { error: "self" as const };
      }

      if (target.role === "ADMIN") {
        const administrators = await tx
          .select({ id: appUsersTable.id })
          .from(appUsersTable)
          .where(eq(appUsersTable.role, "ADMIN"))
          .for("update");
        if (administrators.length <= 1) {
          return { error: "last_admin" as const };
        }
      }

      if (target.courierId) {
        const [activeDelivery] = await tx
          .select({ id: deliveriesTable.id })
          .from(deliveriesTable)
          .where(
            and(
              eq(deliveriesTable.courierId, target.courierId),
              inArray(deliveriesTable.status, [
                "ACCEPTED",
                "TO_STORE",
                "AT_STORE",
                "IN_TRANSIT",
              ]),
            ),
          )
          .limit(1);
        const [activeRoute] = await tx
          .select({ id: deliveryRoutesTable.id })
          .from(deliveryRoutesTable)
          .where(
            and(
              eq(deliveryRoutesTable.courierId, target.courierId),
              eq(deliveryRoutesTable.status, "ACCEPTED"),
            ),
          )
          .limit(1);
        if (activeDelivery || activeRoute) {
          return { error: "active_courier_work" as const };
        }
      }

      await tx
        .update(appUsersTable)
        .set({
          role: "PENDING",
          storeId: null,
          courierId: null,
          updatedAt: new Date(),
        })
        .where(eq(appUsersTable.id, target.id));
      return { target };
    });

    if ("error" in result) {
      if (result.error === "not_found") {
        res.status(404).json({ error: "Conta não encontrada." });
        return;
      }
      if (result.error === "self") {
        res.status(400).json({ error: "Não é possível excluir a própria conta de administrador." });
        return;
      }
      if (result.error === "last_admin") {
        res.status(409).json({ error: "Não é possível excluir o último administrador." });
        return;
      }
      res.status(409).json({
        error: "Conclua ou cancele as entregas e rotas deste motoboy antes de excluir a conta.",
      });
      return;
    }

    if (result.target.clerkUserId) {
      try {
        await clerkClient.users.deleteUser(result.target.clerkUserId);
      } catch (error) {
        const status =
          error && typeof error === "object" && "status" in error
            ? Number(error.status)
            : null;
        if (status !== 404) {
          req.log?.error(
            { err: error, accountId: result.target.id },
            "Failed to delete Clerk login after revoking application access",
          );
          res.status(502).json({
            error: "O acesso ao sistema foi bloqueado, mas não foi possível excluir o login. Tente novamente.",
          });
          return;
        }
      }
    }

    await db.delete(appUsersTable).where(eq(appUsersTable.id, result.target.id));
    res.status(204).end();
  },
);

router.get(
  "/courier/earnings",
  requireRole("COURIER"),
  async (req, res): Promise<void> => {
    const query = GetCourierEarningsQueryParams.safeParse(req.query);
    if (!query.success) {
      res.status(400).json({ error: query.error.message });
      return;
    }
    const profile = res.locals.appUser as AppUserProfile;
    if (!profile.courierId) {
      res.status(403).json({ error: "Esta conta não está vinculada a um motoboy." });
      return;
    }
    const period = query.data.period ?? "day";
    const rows = await db
      .select({
        id: deliveriesTable.id,
        deliveryAmountCents: deliveriesTable.deliveryAmountCents,
        completedAt: deliveryEventsTable.timestamp,
      })
      .from(deliveriesTable)
      .innerJoin(
        deliveryEventsTable,
        eq(deliveryEventsTable.deliveryId, deliveriesTable.id),
      )
      .where(
        and(
          eq(deliveriesTable.courierId, profile.courierId),
          eq(deliveriesTable.status, "COMPLETED"),
          eq(deliveryEventsTable.kind, "completed"),
          gte(deliveryEventsTable.timestamp, startOfSaoPauloPeriod(period)),
        ),
      );
    const uniqueRows = [...new Map(rows.map((row) => [row.id, row])).values()];
    const totalCents = uniqueRows.reduce(
      (total, row) => total + row.deliveryAmountCents,
      0,
    );
    res.json(
      GetCourierEarningsResponse.parse({
        period,
        completedDeliveries: uniqueRows.length,
        amountToReceive: Number((totalCents / 100).toFixed(2)),
      }),
    );
  },
);

const eventLabels: Record<string, string> = {
  REQUESTED: "Entrega solicitada",
  OFFERED: "Oferta enviada aos motoboys",
  ACCEPTED: "Entrega aceita",
  TO_STORE: "Deslocamento até a loja iniciado",
  AT_STORE: "Chegada à loja confirmada",
  IN_TRANSIT: "Retirada confirmada — em trânsito",
  COMPLETED: "Entrega concluída",
  CANCELLED: "Cancelado pela Central",
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
  const { deliveryAmountCents, evidencePath, ...deliveryData } = row.delivery;

  const events = await db
    .select()
    .from(deliveryEventsTable)
    .where(eq(deliveryEventsTable.deliveryId, deliveryId))
    .orderBy(deliveryEventsTable.timestamp);

  return {
    ...deliveryData,
    deliveryAmount: deliveryAmountCents / 100,
    evidenceAvailable: Boolean(evidencePath),
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

function saoPauloDate(value: Date) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(value);
  const get = (type: string) => parts.find((part) => part.type === type)?.value;
  return `${get("year")}-${get("month")}-${get("day")}`;
}

function saoPauloDayBoundary(value: string | Date) {
  const date = value instanceof Date ? value.toISOString().slice(0, 10) : value;
  return new Date(`${date}T03:00:00.000Z`);
}

router.get(
  "/reports/analytics",
  requireRole("ADMIN", "CENTRAL", "STORE_MANAGER", "STORE_STAFF"),
  async (req, res): Promise<void> => {
    const queryInput: Record<string, unknown> = { ...req.query };
    for (const field of ["from", "to"] as const) {
      const value = req.query[field];
      if (typeof value === "string") {
        queryInput[field] = new Date(`${value}T00:00:00.000Z`);
      }
    }
    const query = GetDeliveryAnalyticsQueryParams.safeParse(queryInput);
    if (!query.success) {
      res.status(400).json({ error: query.error.message });
      return;
    }
    const profile = res.locals.appUser as AppUserProfile;
    const conditions = [];
    let selectedStoreId = query.data.storeId;
    if (profile.role === "STORE_MANAGER" || profile.role === "STORE_STAFF") {
      if (selectedStoreId && selectedStoreId !== profile.storeId) {
        res.status(403).json({ error: "Esta conta só pode consultar relatórios da própria filial." });
        return;
      }
      selectedStoreId = profile.storeId ?? undefined;
      if (!selectedStoreId) {
        res.status(403).json({ error: "Esta conta não está vinculada a uma filial." });
        return;
      }
    }
    if (selectedStoreId) {
      conditions.push(eq(deliveriesTable.storeId, selectedStoreId));
    }
    if (query.data.courierId) {
      conditions.push(eq(deliveriesTable.courierId, query.data.courierId));
    }
    if (query.data.status) {
      conditions.push(eq(deliveriesTable.status, query.data.status));
    }
    if (query.data.from) {
      conditions.push(gte(
        deliveriesTable.createdAt,
        saoPauloDayBoundary(query.data.from),
      ));
    }
    if (query.data.to) {
      const until = saoPauloDayBoundary(query.data.to);
      until.setUTCDate(until.getUTCDate() + 1);
      conditions.push(lt(deliveriesTable.createdAt, until));
    }
    const rows = await db
      .select({
        delivery: deliveriesTable,
        storeName: storesTable.name,
        courierName: couriersTable.name,
      })
      .from(deliveriesTable)
      .innerJoin(storesTable, eq(deliveriesTable.storeId, storesTable.id))
      .leftJoin(couriersTable, eq(deliveriesTable.courierId, couriersTable.id))
      .where(conditions.length ? and(...conditions) : undefined)
      .orderBy(desc(deliveriesTable.createdAt));
    const ids = rows.map(({ delivery }) => delivery.id);
    const events = ids.length
      ? await db
          .select()
          .from(deliveryEventsTable)
          .where(inArray(deliveryEventsTable.deliveryId, ids))
          .orderBy(deliveryEventsTable.timestamp)
      : [];
    const eventsByDelivery = new Map<string, typeof events>();
    for (const event of events) {
      const list = eventsByDelivery.get(event.deliveryId) ?? [];
      list.push(event);
      eventsByDelivery.set(event.deliveryId, list);
    }
    const firstEvent = (deliveryId: string, kinds: string[]) =>
      eventsByDelivery
        .get(deliveryId)
        ?.find((event) => kinds.includes(event.kind))?.timestamp ?? null;
    const reportRows = rows.map(({ delivery, storeName, courierName }) => ({
      id: delivery.id,
      code: delivery.code,
      customerName: delivery.customerName,
      destination: delivery.destination,
      storeName,
      courierName,
      status: delivery.status,
      deliveryAmount: delivery.deliveryAmountCents / 100,
      createdAt: delivery.createdAt.toISOString(),
      storeArrivedAt: firstEvent(delivery.id, ["at_store", "store_arrived"])?.toISOString() ?? null,
      storeDepartedAt: firstEvent(delivery.id, ["in_transit"])?.toISOString() ?? null,
      completedAt: firstEvent(delivery.id, ["completed"])?.toISOString() ?? null,
      evidenceAvailable: Boolean(delivery.evidencePath),
    }));
    const completedRows = reportRows.filter((row) => row.completedAt);
    const minutes = (start: string | null, end: string | null) =>
      start && end
        ? (Date.parse(end) - Date.parse(start)) / 60_000
        : null;
    const averages = (values: Array<number | null>) => {
      const valid = values.filter((value): value is number => value != null && Number.isFinite(value) && value >= 0);
      return valid.length
        ? Number((valid.reduce((sum, value) => sum + value, 0) / valid.length).toFixed(1))
        : 0;
    };
    const dailyMap = new Map<string, { date: string; created: number; completed: number }>();
    const courierMap = new Map<string, {
      courierId: string;
      courierName: string;
      completedDeliveries: number;
      courierAmount: number;
      totalMinutes: number[];
    }>();
    for (const row of reportRows) {
      const createdDate = saoPauloDate(new Date(row.createdAt));
      const createdDay = dailyMap.get(createdDate) ?? {
        date: createdDate,
        created: 0,
        completed: 0,
      };
      createdDay.created += 1;
      dailyMap.set(createdDate, createdDay);
      if (row.completedAt) {
        const completedDate = saoPauloDate(new Date(row.completedAt));
        const completedDay = dailyMap.get(completedDate) ?? {
          date: completedDate,
          created: 0,
          completed: 0,
        };
        completedDay.completed += 1;
        dailyMap.set(completedDate, completedDay);
      }
    }
    for (const { delivery, courierName } of rows) {
      if (delivery.status !== "COMPLETED" || !delivery.courierId) continue;
      const completedAt = firstEvent(delivery.id, ["completed"]);
      const record = courierMap.get(delivery.courierId) ?? {
        courierId: delivery.courierId,
        courierName: courierName ?? "Motoboy",
        completedDeliveries: 0,
        courierAmount: 0,
        totalMinutes: [],
      };
      record.completedDeliveries += 1;
      record.courierAmount += delivery.deliveryAmountCents / 100;
      if (completedAt) {
        record.totalMinutes.push(
          (completedAt.getTime() - delivery.createdAt.getTime()) / 60_000,
        );
      }
      courierMap.set(delivery.courierId, record);
    }
    const averageTotalMinutes = averages(
      completedRows.map((row) => minutes(row.createdAt, row.completedAt)),
    );
    res.json(
      GetDeliveryAnalyticsResponse.parse({
        summary: {
          total: reportRows.length,
          completed: completedRows.length,
          cancelled: reportRows.filter((row) => row.status === "CANCELLED").length,
          averageTotalMinutes,
          averageStoreMinutes: averages(
            completedRows.map((row) =>
              minutes(row.storeArrivedAt, row.storeDepartedAt),
            ),
          ),
          averageDeliveryMinutes: averages(
            completedRows.map((row) =>
              minutes(row.storeDepartedAt, row.completedAt),
            ),
          ),
          courierAmount: completedRows.reduce(
            (sum, row) => sum + row.deliveryAmount,
            0,
          ),
        },
        daily: [...dailyMap.values()].sort((a, b) => a.date.localeCompare(b.date)),
        couriers: [...courierMap.values()]
          .map((courier) => ({
            courierId: courier.courierId,
            courierName: courier.courierName,
            completedDeliveries: courier.completedDeliveries,
            courierAmount: Number(courier.courierAmount.toFixed(2)),
            averageTotalMinutes: averages(courier.totalMinutes),
          }))
          .sort((a, b) => b.completedDeliveries - a.completedDeliveries),
        deliveries: reportRows,
      }),
    );
  },
);

router.get(
  "/dashboard/summary",
  requireRole("ADMIN", "CENTRAL"),
  async (_req, res): Promise<void> => {
  const deliveries = await db.select().from(deliveriesTable);
  const linkedCourierRows = await db
    .select({ courierId: appUsersTable.courierId })
    .from(appUsersTable)
    .where(eq(appUsersTable.role, "COURIER"));
  const linkedCourierIds = new Set(
    linkedCourierRows
      .map((row) => row.courierId)
      .filter((id): id is string => Boolean(id)),
  );
  const couriers = (await db.select().from(couriersTable)).filter((courier) =>
    linkedCourierIds.has(courier.id),
  );
  const events = await db.select().from(deliveryEventsTable);
  const now = Date.now();
  const activeStatuses = new Set([
    "REQUESTED",
    "AWAITING_COURIER",
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
      : null;
  const isOnline = (courier: (typeof couriers)[number]) =>
    courier.lastLocationAt != null &&
    now - courier.lastLocationAt.getTime() <= 120_000;
  const availableCouriers = couriers.filter(
    (courier) => courier.status !== "BUSY" && isOnline(courier),
  ).length;
  const busyCouriers = couriers.filter(
    (courier) => courier.status === "BUSY" && isOnline(courier),
  ).length;

  const parsed = GetDashboardSummaryResponse.parse({
    requested: active.length,
    awaitingCourier: deliveries.filter((item) =>
      ["REQUESTED", "AWAITING_COURIER"].includes(item.status),
    ).length,
    offered: deliveries.filter((item) => item.status === "OFFERED").length,
    accepted: deliveries.filter((item) =>
      ["ACCEPTED", "TO_STORE", "AT_STORE"].includes(item.status),
    ).length,
    inTransit: deliveries.filter((item) => item.status === "IN_TRANSIT").length,
    completed: deliveries.filter((item) => item.status === "COMPLETED").length,
    delayed: delayed.length,
    cancelled: deliveries.filter((item) => item.status === "CANCELLED").length,
    totalCouriers: couriers.length,
    availableCouriers,
    busyCouriers,
    offlineCouriers: couriers.length - availableCouriers - busyCouriers,
    averageAcceptanceMinutes: average(acceptanceTimes),
    averageTotalMinutes: average(completionTimes),
  });
  res.json(parsed);
  },
);

router.get(
  "/deliveries",
  requireRole("ADMIN", "CENTRAL", "STORE_MANAGER", "STORE_STAFF", "COURIER"),
  async (req, res): Promise<void> => {
  const profile = res.locals.appUser as AppUserProfile;
  const query = ListDeliveriesQueryParams.safeParse(req.query);
  if (!query.success) {
    res.status(400).json({ error: query.error.message });
    return;
  }

  const filters = [];
  if (profile.role === "STORE_MANAGER" || profile.role === "STORE_STAFF") {
    if (!profile.storeId) {
      res.status(403).json({ error: "Esta conta não está vinculada a uma unidade." });
      return;
    }
    filters.push(eq(deliveriesTable.storeId, profile.storeId));
  } else if (profile.role === "COURIER") {
    if (!profile.courierId) {
      res.status(403).json({ error: "Esta conta não está vinculada a um motoboy." });
      return;
    }
    filters.push(eq(deliveriesTable.courierId, profile.courierId));
  }
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
  },
);

router.post(
  "/deliveries",
  requireRole("ADMIN", "CENTRAL", "STORE_MANAGER", "STORE_STAFF"),
  async (req, res): Promise<void> => {
  const profile = res.locals.appUser as AppUserProfile;
  const body = CreateDeliveryBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: body.error.message });
    return;
  }
  if (
    (body.data.customerLatitude == null) !==
    (body.data.customerLongitude == null)
  ) {
    res.status(400).json({
      error: "Latitude e longitude do endereço precisam ser informadas juntas.",
    });
    return;
  }

  const storeId = profile.role === "STORE_MANAGER" || profile.role === "STORE_STAFF"
    ? profile.storeId
    : body.data.storeId;
  if (!storeId || (profile.storeId && profile.storeId !== storeId)) {
    res.status(403).json({ error: "A conta não pode registrar entregas para esta unidade." });
    return;
  }
  const [store] = await db
    .select()
    .from(storesTable)
    .where(and(eq(storesTable.id, storeId), eq(storesTable.active, true)))
    .limit(1);
  if (!store) {
    res.status(400).json({ error: "Loja não encontrada ou inativa." });
    return;
  }
  if (store.deliveryFeeCents <= 0) {
    res.status(409).json({
      error: "Configure a tarifa do motoboy nesta filial antes de registrar uma entrega.",
    });
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
      customerLatitude: body.data.customerLatitude ?? null,
      customerLongitude: body.data.customerLongitude ?? null,
      orderNumber: body.data.orderNumber.trim(),
      notes: body.data.notes?.trim() || null,
      storeId,
      status: "REQUESTED",
      priority: body.data.priority,
      deliveryAmountCents: store.deliveryFeeCents,
    })
    .returning();
  await addEvent(created.id, "REQUESTED", eventLabels.REQUESTED);
  const view = await deliveryView(created.id);
  res.status(201).json(CreateDeliveryResponse.parse(view));
  },
);

router.get(
  "/deliveries/:deliveryId",
  requireRole("ADMIN", "CENTRAL", "STORE_MANAGER", "STORE_STAFF", "COURIER"),
  async (req, res): Promise<void> => {
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
  const profile = res.locals.appUser as AppUserProfile;
  if (!canAccessDelivery(profile, delivery)) {
    res.status(403).json({ error: "Esta entrega não pertence à sua área de acesso." });
    return;
  }
  res.json(GetDeliveryResponse.parse(delivery));
  },
);

router.delete(
  "/deliveries/:deliveryId",
  requireRole("ADMIN"),
  async (req, res): Promise<void> => {
    const params = GetDeliveryParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: "Entrega inválida." });
      return;
    }

    let result:
      | { deleted: true }
      | { error: "not_found" | "active_grouped_route" };

    try {
      result = await db.transaction(async (tx) => {
        const [delivery] = await tx
          .select()
          .from(deliveriesTable)
          .where(eq(deliveriesTable.id, params.data.deliveryId))
          .for("update")
          .limit(1);
        if (!delivery) return { error: "not_found" as const };

        const linkedRoutes = await tx
          .select()
          .from(deliveryRoutesTable)
          .where(
            sql`${deliveryRoutesTable.deliveryIds} @> ARRAY[${delivery.id}]::text[]`,
          )
          .for("update");

        const activeStatuses = [
          "OFFERED",
          "ACCEPTED",
          "TO_STORE",
          "AT_STORE",
          "IN_TRANSIT",
        ];
        const otherActiveRouteDeliveryIds = [
          ...new Set(
            linkedRoutes
              .filter((route) => route.status === "ACCEPTED")
              .flatMap((route) =>
                route.deliveryIds.filter((id) => id !== delivery.id),
              ),
          ),
        ];
        if (otherActiveRouteDeliveryIds.length > 0) {
          const [activeRouteDelivery] = await tx
            .select({ id: deliveriesTable.id })
            .from(deliveriesTable)
            .where(
              and(
                inArray(deliveriesTable.id, otherActiveRouteDeliveryIds),
                inArray(deliveriesTable.status, activeStatuses),
              ),
            )
            .limit(1);
          if (activeRouteDelivery) {
            return { error: "active_grouped_route" as const };
          }
        }

        const evidenceUploads = await tx
          .select({ objectPath: deliveryEvidenceUploadsTable.objectPath })
          .from(deliveryEvidenceUploadsTable)
          .where(eq(deliveryEvidenceUploadsTable.deliveryId, delivery.id));
        const evidencePaths = new Set(
          [
            delivery.evidencePath,
            ...evidenceUploads.map((upload) => upload.objectPath),
          ].filter((path): path is string => Boolean(path)),
        );

        for (const route of linkedRoutes) {
          const remainingDeliveryIds = route.deliveryIds.filter(
            (id) => id !== delivery.id,
          );
          if (route.status === "OFFERED" && remainingDeliveryIds.length >= 2) {
            await tx
              .update(deliveryRoutesTable)
              .set({ deliveryIds: remainingDeliveryIds })
              .where(eq(deliveryRoutesTable.id, route.id));
            continue;
          }

          if (route.status === "OFFERED" && remainingDeliveryIds.length === 1) {
            const remainingDeliveryId = remainingDeliveryIds[0];
            const [remainingDelivery] = await tx
              .select({ id: deliveriesTable.id, status: deliveriesTable.status })
              .from(deliveriesTable)
              .where(eq(deliveriesTable.id, remainingDeliveryId))
              .for("update")
              .limit(1);
            if (remainingDelivery?.status === "OFFERED") {
              await tx
                .update(deliveriesTable)
                .set({ status: "REQUESTED", updatedAt: new Date() })
                .where(eq(deliveriesTable.id, remainingDeliveryId));
              await tx.insert(deliveryEventsTable).values({
                id: randomUUID(),
                deliveryId: remainingDeliveryId,
                kind: "route_offer_removed",
                label:
                  "Oferta de rota desfeita após exclusão de outra entrega",
                actor: "Administrador",
              });
            }
          }

          await tx
            .delete(deliveryRoutesTable)
            .where(eq(deliveryRoutesTable.id, route.id));
        }

        const storage = new ObjectStorageService();
        for (const objectPath of evidencePaths) {
          await storage.deleteObjectEntity(
            storage.normalizeObjectEntityPath(objectPath),
          );
        }

        if (delivery.courierId) {
          const [courier] = await tx
            .select({
              id: couriersTable.id,
              currentDeliveryCode: couriersTable.currentDeliveryCode,
            })
            .from(couriersTable)
            .where(eq(couriersTable.id, delivery.courierId))
            .for("update")
            .limit(1);
          if (courier?.currentDeliveryCode === delivery.code) {
            const [otherActiveDelivery] = await tx
              .select({ id: deliveriesTable.id })
              .from(deliveriesTable)
              .where(
                and(
                  eq(deliveriesTable.courierId, delivery.courierId),
                  inArray(deliveriesTable.status, activeStatuses),
                  sql`${deliveriesTable.id} <> ${delivery.id}`,
                ),
              )
              .limit(1);
            if (!otherActiveDelivery) {
              await tx
                .update(couriersTable)
                .set({ status: "AVAILABLE", currentDeliveryCode: null })
                .where(eq(couriersTable.id, delivery.courierId));
            }
          }
        }

        await tx
          .delete(deliveriesTable)
          .where(eq(deliveriesTable.id, delivery.id));
        return { deleted: true as const };
      });
    } catch (error) {
      req.log.error(
        { err: error, deliveryId: params.data.deliveryId },
        "Failed to permanently delete delivery and related data",
      );
      res.status(503).json({
        error: "Não foi possível concluir a exclusão definitiva. Atualize e tente novamente.",
      });
      return;
    }

    if ("error" in result) {
      if (result.error === "not_found") {
        res.status(404).json({ error: "Entrega não encontrada." });
        return;
      }
      res.status(409).json({
        error:
          "Esta entrega pertence a uma rota agrupada em andamento. Conclua ou encerre a rota antes de excluir definitivamente.",
      });
      return;
    }

    res.status(204).end();
  },
);

router.post(
  "/deliveries/:deliveryId/evidence/upload-url",
  requireRole("COURIER"),
  async (req, res): Promise<void> => {
    const params = GetDeliveryParams.safeParse(req.params);
    const body = RequestDeliveryEvidenceUploadUrlBody.safeParse(req.body);
    if (!params.success || !body.success) {
      res.status(400).json({ error: "Dados inválidos para a foto de comprovação." });
      return;
    }
    const profile = res.locals.appUser as AppUserProfile;
    if (!profile.courierId) {
      res.status(403).json({ error: "Esta conta não está vinculada a um motoboy." });
      return;
    }
    const [delivery] = await db
      .select()
      .from(deliveriesTable)
      .where(eq(deliveriesTable.id, params.data.deliveryId))
      .limit(1);
    if (!delivery || delivery.courierId !== profile.courierId) {
      res.status(404).json({ error: "Entrega não encontrada para esta conta." });
      return;
    }
    if (delivery.status !== "IN_TRANSIT" || delivery.evidencePath) {
      res.status(409).json({ error: "A foto só pode ser enviada ao finalizar uma entrega em trânsito." });
      return;
    }
    try {
      const storage = new ObjectStorageService();
      const uploadURL = await storage.getObjectEntityUploadURL();
      const objectPath = storage.normalizeObjectEntityPath(uploadURL);
      await db.insert(deliveryEvidenceUploadsTable).values({
        objectPath,
        deliveryId: delivery.id,
        courierId: profile.courierId,
      });
      res.json({ uploadURL, objectPath });
    } catch (error) {
      req.log.error({ err: error }, "Failed to prepare delivery evidence upload");
      res.status(503).json({ error: "Não foi possível preparar o envio da foto. Tente novamente." });
    }
  },
);

router.get(
  "/deliveries/:deliveryId/evidence",
  requireRole("ADMIN", "CENTRAL", "STORE_MANAGER", "STORE_STAFF", "COURIER"),
  async (req, res): Promise<void> => {
    const params = GetDeliveryParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: params.error.message });
      return;
    }
    const [delivery] = await db
      .select()
      .from(deliveriesTable)
      .where(eq(deliveriesTable.id, params.data.deliveryId))
      .limit(1);
    if (!delivery) {
      res.status(404).json({ error: "Entrega não encontrada." });
      return;
    }
    const profile = res.locals.appUser as AppUserProfile;
    if (!canAccessDelivery(profile, delivery)) {
      res.status(403).json({ error: "Esta entrega não pertence à sua área de acesso." });
      return;
    }
    if (!delivery.evidencePath) {
      res.status(404).json({ error: "Esta entrega ainda não tem foto de comprovação." });
      return;
    }
    try {
      const file = await new ObjectStorageService().getObjectEntityFile(
        delivery.evidencePath,
      );
      const [metadata] = await file.getMetadata();
      res.setHeader(
        "Content-Type",
        String(metadata.contentType ?? "application/octet-stream"),
      );
      res.setHeader("Cache-Control", "private, no-store");
      res.setHeader("X-Content-Type-Options", "nosniff");
      file.createReadStream().pipe(res);
    } catch (error) {
      req.log.error({ err: error }, "Failed to read private delivery evidence");
      res.status(404).json({ error: "A foto de comprovação não está disponível." });
    }
  },
);

router.post(
  "/deliveries/:deliveryId/dispatch",
  requireRole("ADMIN", "CENTRAL"),
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

    const profile = res.locals.appUser as AppUserProfile;
    const result = await db.transaction(async (tx) => {
      const [delivery] = await tx
        .select()
        .from(deliveriesTable)
        .where(eq(deliveriesTable.id, params.data.deliveryId))
        .for("update");
      if (!delivery) return { error: "not_found" as const };
      const activeRoutes = await tx
        .select({
          deliveryIds: deliveryRoutesTable.deliveryIds,
        })
        .from(deliveryRoutesTable)
        .where(
          inArray(deliveryRoutesTable.status, ["OFFERED", "ACCEPTED"]),
        );
      if (activeRoutes.some((route) => route.deliveryIds.includes(delivery.id))) {
        return { error: "route_locked" as const };
      }
      if (!["REQUESTED", "OFFERED"].includes(delivery.status))
        return { error: "not_dispatchable" as const };

      let courierId: string | null = null;
      if (body.data.mode === "single") {
        const linkedCourierRows = await tx
          .select({ courierId: appUsersTable.courierId })
          .from(appUsersTable)
          .where(eq(appUsersTable.role, "COURIER"));
        const linkedCourierIds = [
          ...new Set(
            linkedCourierRows
              .map((row) => row.courierId)
              .filter((id): id is string => Boolean(id)),
          ),
        ];
        if (!linkedCourierIds.length) return { error: "no_courier" as const };
        const [courier] = body.data.courierId
          ? await tx
              .select()
              .from(couriersTable)
              .where(
                and(
                  eq(couriersTable.id, body.data.courierId),
                  inArray(couriersTable.id, linkedCourierIds),
                  inArray(couriersTable.status, ["AVAILABLE", "OFFLINE"]),
                ),
              )
              .limit(1)
          : await tx
              .select()
              .from(couriersTable)
              .where(
                and(
                  eq(couriersTable.status, "AVAILABLE"),
                  inArray(couriersTable.id, linkedCourierIds),
                ),
              )
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
            : result.error === "route_locked"
              ? "Esta entrega já faz parte de uma rota agrupada."
            : "Esta entrega não pode ser redisparada no status atual.";
      res.status(status).json({ error: message });
      return;
    }
    const view = await deliveryView(result.deliveryId);
    if (view) {
      if (view.courierId) {
        await notifyCouriers([view.courierId], {
          title: "Nova entrega disponível",
          body: `A entrega ${view.code} foi enviada para você.`,
        });
      } else if (body.data.mode === "group") {
        await notifyAvailableCouriers({
          title: "Nova entrega disponível",
          body: `A entrega ${view.code} aguarda aceite.`,
        });
      }
    }
    res.json(DispatchDeliveryResponse.parse(view));
  },
);

router.patch(
  "/deliveries/:deliveryId/status",
  requireRole("ADMIN", "CENTRAL", "STORE_MANAGER", "STORE_STAFF", "COURIER"),
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

    const profile = res.locals.appUser as AppUserProfile;
    if (
      body.data.status === "CANCELLED" &&
      profile.role !== "ADMIN" &&
      profile.role !== "CENTRAL"
    ) {
      res.status(403).json({ error: "Somente a Central pode cancelar pedidos." });
      return;
    }
    if (body.data.status === "COMPLETED" && profile.role === "COURIER") {
      if (
        !profile.courierId ||
        !body.data.evidencePath ||
        !(await verifyEvidenceUpload(
          params.data.deliveryId,
          profile.courierId,
          body.data.evidencePath,
        ))
      ) {
        res.status(422).json({
          error: "Envie uma foto válida de comprovação antes de concluir a entrega.",
        });
        return;
      }
    }

    const result = await db.transaction(async (tx) => {
      const [delivery] = await tx
        .select()
        .from(deliveriesTable)
        .where(eq(deliveriesTable.id, params.data.deliveryId))
        .for("update");
      if (!delivery) return { error: "not_found" as const };

      if (!canAccessDelivery(profile, delivery)) {
        return { error: "forbidden" as const };
      }
      const activeRoutes = await tx
        .select({
          deliveryIds: deliveryRoutesTable.deliveryIds,
        })
        .from(deliveryRoutesTable)
        .where(
          inArray(deliveryRoutesTable.status, ["OFFERED", "ACCEPTED"]),
        );
      if (activeRoutes.some((route) => route.deliveryIds.includes(delivery.id))) {
        return { error: "route_locked" as const };
      }
      const nextStatus = body.data.status;
      if (
        (profile.role === "STORE_MANAGER" || profile.role === "STORE_STAFF") &&
        nextStatus !== "IN_TRANSIT"
      ) {
        return { error: "role_restricted" as const };
      }
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
        const linkedCourierRows = await tx
          .select({ courierId: appUsersTable.courierId })
          .from(appUsersTable)
          .where(eq(appUsersTable.role, "COURIER"));
        const linkedCourierIds = [
          ...new Set(
            linkedCourierRows
              .map((row) => row.courierId)
              .filter((id): id is string => Boolean(id)),
          ),
        ];
        const [available] = linkedCourierIds.length
          ? await tx
              .select()
              .from(couriersTable)
              .where(
                and(
                  eq(couriersTable.status, "AVAILABLE"),
                  inArray(couriersTable.id, linkedCourierIds),
                ),
              )
              .limit(1)
          : [];
        if (!available) return { error: "no_courier" as const };
        courierId = available.id;
      }
      if (nextStatus === "ACCEPTED" && courierId) {
        const [linkedCourier] = await tx
          .select({ id: appUsersTable.id })
          .from(appUsersTable)
          .where(
            and(
              eq(appUsersTable.role, "COURIER"),
              eq(appUsersTable.courierId, courierId),
            ),
          )
          .limit(1);
        if (!linkedCourier) return { error: "no_courier" as const };
        const [updatedCourier] = await tx
          .update(couriersTable)
          .set({ status: "BUSY" })
          .where(
            and(
              eq(couriersTable.id, courierId),
                inArray(couriersTable.status, ["AVAILABLE", "OFFLINE"]),
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
          ...(nextStatus === "COMPLETED" && body.data.evidencePath
            ? { evidencePath: body.data.evidencePath }
            : {}),
          updatedAt: new Date(),
        })
        .where(eq(deliveriesTable.id, delivery.id));
      if (nextStatus === "COMPLETED" && body.data.evidencePath) {
        await tx
          .delete(deliveryEvidenceUploadsTable)
          .where(
            and(
              eq(
                deliveryEvidenceUploadsTable.objectPath,
                body.data.evidencePath,
              ),
              eq(deliveryEvidenceUploadsTable.deliveryId, delivery.id),
              eq(
                deliveryEvidenceUploadsTable.courierId,
                courierId ?? "",
              ),
            ),
          );
      }

      if (["COMPLETED", "CANCELLED"].includes(nextStatus) && courierId) {
        await tx
          .update(couriersTable)
          .set({
            status: "AVAILABLE",
            currentDeliveryCode: null,
            currentLatitude: null,
            currentLongitude: null,
          })
          .where(eq(couriersTable.id, courierId));
      } else if (nextStatus === "ACCEPTED" && courierId) {
        await tx
          .update(couriersTable)
          .set({ currentDeliveryCode: delivery.code })
          .where(eq(couriersTable.id, courierId));
      }

      const note = body.data.note?.trim();
      const label =
        nextStatus === "CANCELLED"
          ? note
            ? `Cancelado pela Central · Motivo: ${note}`
            : eventLabels.CANCELLED
          : note || eventLabels[nextStatus];
      await tx.insert(deliveryEventsTable).values({
        id: randomUUID(),
        deliveryId: delivery.id,
        kind: nextStatus.toLowerCase(),
        label,
        actor:
          profile.role === "COURIER"
            ? "Motoboy"
            : profile.role === "STORE_MANAGER" || profile.role === "STORE_STAFF"
              ? "Equipe da unidade"
              : "Central de entregas",
      });
      return { deliveryId: delivery.id };
    });

    if ("error" in result) {
      const status = result.error === "not_found" ? 404 : 409;
      const message =
        result.error === "not_found"
          ? "Entrega não encontrada."
          : result.error === "forbidden"
            ? "Esta entrega não pertence à sua área de acesso."
            : result.error === "route_locked"
              ? "Esta entrega faz parte de uma rota agrupada e só pode ser atualizada pela sequência da rota."
            : result.error === "role_restricted"
              ? "Este perfil só pode confirmar a saída da unidade."
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

router.get(
  "/couriers",
  requireRole("ADMIN", "CENTRAL", "STORE_MANAGER", "STORE_STAFF"),
  async (req, res): Promise<void> => {
  const profile = res.locals.appUser as AppUserProfile;
  const linkedCourierRows = await db
    .select({ courierId: appUsersTable.courierId })
    .from(appUsersTable)
    .where(eq(appUsersTable.role, "COURIER"));
  const linkedCourierIds = new Set(
    linkedCourierRows
      .map((row) => row.courierId)
      .filter((id): id is string => Boolean(id)),
  );
  const includeUnlinked =
    profile.role === "ADMIN" && req.query.includeUnlinked === "true";
  let couriers;
  if (profile.role === "STORE_MANAGER" || profile.role === "STORE_STAFF") {
    if (!profile.storeId) {
      res.status(403).json({ error: "Esta conta não está vinculada a uma unidade." });
      return;
    }
    const assignedRows = await db
      .select({ courierId: deliveriesTable.courierId })
      .from(deliveriesTable)
      .where(
        and(
          eq(deliveriesTable.storeId, profile.storeId),
          inArray(deliveriesTable.status, [
            "ACCEPTED",
            "TO_STORE",
            "AT_STORE",
            "IN_TRANSIT",
          ]),
        ),
      );
    const courierIds = [
      ...new Set(
        assignedRows
          .map((row) => row.courierId)
            .filter(
              (courierId): courierId is string =>
                courierId !== null && linkedCourierIds.has(courierId),
            ),
      ),
    ];
    couriers = courierIds.length
      ? await db
          .select()
          .from(couriersTable)
          .where(inArray(couriersTable.id, courierIds))
          .orderBy(couriersTable.name)
      : [];
  } else {
    const rows = await db
      .select()
      .from(couriersTable)
      .orderBy(couriersTable.name);
    couriers = includeUnlinked
      ? rows
      : rows.filter((courier) => linkedCourierIds.has(courier.id));
  }
  res.json(
    ListCouriersResponse.parse(
      couriers.map((courier) => ({
        ...courier,
        currentLatitude: courier.currentLatitude ?? null,
        currentLongitude: courier.currentLongitude ?? null,
        currentAccuracyMeters: courier.currentAccuracyMeters ?? null,
        currentSpeedMetersPerSecond:
          courier.currentSpeedMetersPerSecond ?? null,
        locationMeasuredAt: courier.locationMeasuredAt?.toISOString() ?? null,
        lastLocationAt: courier.lastLocationAt?.toISOString() ?? null,
      })),
    ),
  );
  },
);

export default router;
