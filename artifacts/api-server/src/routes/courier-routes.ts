import { randomUUID } from "node:crypto";
import { and, asc, eq, inArray, isNull, notInArray, or, sql } from "drizzle-orm";
import { Router, type IRouter } from "express";
import {
  AcceptCourierRouteBody,
  AcceptCourierRouteParams,
  AcceptCourierRouteResponse,
  CompleteCourierRouteStopBody,
  CompleteCourierRouteStopParams,
  CompleteCourierRouteStopResponse,
  CreateCourierDeliveryCancellationBody,
  CreateCourierDeliveryCancellationParams,
  CreateCourierDeliveryCancellationResponse,
  CreateDeliveryRouteBody,
  CreateDeliveryRouteResponse,
  RemoveDeliveryFromRouteBody,
  RemoveDeliveryFromRouteResponse,
  DeclineCourierDeliveryParams,
  DeclineCourierRouteParams,
  GetCourierRoutePreviewParams,
  GetCourierRoutePreviewResponse,
  GetCourierDeliveryNavigationParams,
  GetCourierDeliveryNavigationResponse,
  ListActiveRoutesResponse,
  GetCourierPlanResponse,
  ListCourierRoutesResponse,
  RecordCourierStopArrivalParams,
  RecordCourierStopArrivalResponse,
  UpdateCourierLocationBody,
  UpdateCourierLocationResponse,
  UpdateCourierAvailabilityBody,
  UpdateCourierAvailabilityResponse,
  type CourierDeliveryRoute,
} from "@workspace/api-zod";
import {
  appUsersTable,
  couriersTable,
  db,
  deliveriesTable,
  deliveryEvidenceUploadsTable,
  deliveryCancellationsTable,
  deliveryCancellationReasonsTable,
  deliveryEventsTable,
  deliveryRouteStopsTable,
  deliveryRoutesTable,
  courierRouteOfferDeclinesTable,
  storesTable,
} from "@workspace/db";
import {
  requireAuthentication,
  requireRole,
  type AppUserProfile,
} from "../middlewares/accessControl";
import {
  MapsApiError,
  computeDrivingRoute,
  geocodeAddress as googleGeocodeAddress,
  optimizeShipments,
  type OptimizedVisit,
} from "../lib/googleMaps";
import { verifyEvidenceUpload } from "../lib/deliveryEvidence";
import { notifyCentralUsers, notifyCouriers } from "../lib/webPush";
import { courierCity, notInActiveRoute, notifyCityCouriers, offerToCity, sameCity } from "../lib/deliveryOffers";

/**
 * Rota oferecida a todos (sem motoboy escolhido) só vale para os motoboys da cidade das filiais
 * das entregas, como as entregas avulsas. Motoboy sem cidade cadastrada continua vendo todas.
 */
import { getCourierDisplayName, getCourierFirstName } from "../lib/courierName";

/** Rota aberta a todos só aparece para motoboys da cidade das filiais dela. */
function openRouteInCity(city: string | null) {
  if (!city) return sql`true`;
  return sql`(${deliveryRoutesTable.courierId} IS NOT NULL OR NOT EXISTS (
    SELECT 1 FROM ${deliveriesTable} d JOIN ${storesTable} s ON s.id = d.store_id
    WHERE d.id = ANY(${deliveryRoutesTable.deliveryIds})
      AND lower(trim(coalesce(s.city, ''))) <> lower(trim(${city}))
  ))`;
}

const router: IRouter = Router();
router.use(requireAuthentication);

const linkedCourierEmail = sql<string | null>`(
  SELECT ${appUsersTable.email}
  FROM ${appUsersTable}
  WHERE ${appUsersTable.courierId} = ${couriersTable.id}
    AND ${appUsersTable.role} = 'COURIER'
  ORDER BY ${appUsersTable.updatedAt} DESC
  LIMIT 1
)`;

type DeliveryRow = {
  delivery: typeof deliveriesTable.$inferSelect;
  storeName: string;
  storeAddress: string;
  storeCity: string;
  storeLatitude: number | null;
  storeLongitude: number | null;
};

type RouteStopRow = {
  stop: typeof deliveryRouteStopsTable.$inferSelect;
  delivery: typeof deliveriesTable.$inferSelect;
  storeName: string;
};

type Coordinate = { latitude: number; longitude: number };

class RoutePlanningError extends Error {
  constructor(
    message: string,
    readonly status = 502,
  ) {
    super(message);
  }
}

async function routeDeliveries(deliveryIds: string[]): Promise<DeliveryRow[]> {
  if (!deliveryIds.length) return [];
  return db
    .select({
      delivery: deliveriesTable,
      storeName: storesTable.name,
      storeAddress: storesTable.address,
      storeCity: storesTable.city,
      storeLatitude: storesTable.latitude,
      storeLongitude: storesTable.longitude,
    })
    .from(deliveriesTable)
    .innerJoin(storesTable, eq(deliveriesTable.storeId, storesTable.id))
    .where(inArray(deliveriesTable.id, deliveryIds));
}

type RouteStopRecord = typeof deliveryRouteStopsTable.$inferSelect;

/**
 * A retirada `first` e as retiradas PENDENTES logo em seguida no mesmo ponto (mesma loja).
 * Para o motoboy é uma parada só: uma chegada e uma confirmação de saída para todos os pedidos.
 */
function samePlacePickupGroup(stops: RouteStopRecord[], first: RouteStopRecord): RouteStopRecord[] {
  const group = [first];
  for (const stop of stops.slice(stops.indexOf(first) + 1)) {
    const samePlace =
      Math.abs(stop.latitude - first.latitude) < 0.00002 &&
      Math.abs(stop.longitude - first.longitude) < 0.00002;
    if (stop.status !== "PENDING" || stop.kind !== "pickup" || !samePlace) break;
    group.push(stop);
  }
  return group;
}

/** O app do motoboy não recebe valores em R$ (ele vê só a quantidade de entregas). */
function withoutAmounts(view: CourierDeliveryRoute): CourierDeliveryRoute {
  return {
    ...view,
    amountToReceive: 0,
    deliveries: view.deliveries.map((delivery) => ({ ...delivery, deliveryAmount: 0 })),
    stops: view.stops.map((stop) => ({ ...stop, deliveryAmount: 0 })),
  };
}

async function courierRouteView(route: typeof deliveryRoutesTable.$inferSelect) {
  return withoutAmounts(await routeView(route));
}

async function routeView(
  route: typeof deliveryRoutesTable.$inferSelect,
): Promise<CourierDeliveryRoute> {
  const [deliveryRows, stopRows] = await Promise.all([
    routeDeliveries(route.deliveryIds),
    route.status === "OFFERED"
      ? Promise.resolve([] as RouteStopRow[])
      : db
          .select({
            stop: deliveryRouteStopsTable,
            delivery: deliveriesTable,
            storeName: storesTable.name,
          })
          .from(deliveryRouteStopsTable)
          .innerJoin(
            deliveriesTable,
            eq(deliveryRouteStopsTable.deliveryId, deliveriesTable.id),
          )
          .innerJoin(storesTable, eq(deliveriesTable.storeId, storesTable.id))
          .where(eq(deliveryRouteStopsTable.routeId, route.id))
          .orderBy(asc(deliveryRouteStopsTable.sequence)),
  ]);

  const deliveryById = new Map(
    deliveryRows.map((row) => [row.delivery.id, row]),
  );
  const deliveries = route.deliveryIds.flatMap((id) => {
    const row = deliveryById.get(id);
    if (!row) return [];
    const { deliveryAmountCents, ...delivery } = row.delivery;
    return [{
      id: delivery.id,
      code: delivery.code,
      customerName: delivery.customerName,
      customerPhone: delivery.customerPhone,
      requiresPrescription: delivery.requiresPrescription,
      paymentMethod: delivery.paymentMethod,
      changeFor: delivery.changeForCents == null ? null : delivery.changeForCents / 100,
      bringCardMachine: delivery.bringCardMachine,
      destination: delivery.destination,
      notes: delivery.notes,
      storeName: row.storeName,
      storeAddress: row.storeAddress,
      storeCity: row.storeCity,
      storeLatitude: row.storeLatitude,
      storeLongitude: row.storeLongitude,
      customerLatitude: delivery.customerLatitude,
      customerLongitude: delivery.customerLongitude,
      deliveryAmount: deliveryAmountCents / 100,
      status: delivery.status,
    }];
  });

  const stops = stopRows
    .filter(({ stop }) => stop.status !== "CANCELLED")
    .map(({ stop, delivery, storeName }) => ({
    id: stop.id,
    sequence: stop.sequence,
    deliveryId: stop.deliveryId,
    kind: stop.kind,
    address: stop.address,
    latitude: stop.latitude,
    longitude: stop.longitude,
    status: stop.status,
    code: delivery.code,
    customerName: delivery.customerName,
    storeName,
    deliveryAmount: delivery.deliveryAmountCents / 100,
    }));

  return CreateDeliveryRouteResponse.parse({
    id: route.id,
    status: route.status,
    courierId: route.courierId,
    deliveryCount: route.deliveryIds.length,
    amountToReceive: Number(
      (
        deliveryRows.reduce(
          (total, row) => total + row.delivery.deliveryAmountCents,
          0,
        ) / 100
      ).toFixed(2),
    ),
    distanceKm:
      route.distanceMeters == null
        ? null
        : Number((route.distanceMeters / 1000).toFixed(1)),
    estimatedMinutes:
      route.durationSeconds == null
        ? null
        : Math.ceil(route.durationSeconds / 60),
    lockedAt: route.lockedAt?.toISOString() ?? null,
    deliveries,
    stops,
    routeGeometry: route.routeGeometry ?? null,
  });
}

function storedCoordinate(
  latitude: number | null | undefined,
  longitude: number | null | undefined,
): Coordinate | null {
  if (
    typeof latitude !== "number" ||
    typeof longitude !== "number" ||
    !Number.isFinite(latitude) ||
    !Number.isFinite(longitude) ||
    latitude < -90 ||
    latitude > 90 ||
    longitude < -180 ||
    longitude > 180
  ) {
    return null;
  }
  return { latitude, longitude };
}

async function geocodeAddress(address: string, city: string): Promise<Coordinate> {
  try {
    return await googleGeocodeAddress(
      `${address}, ${city}, Minas Gerais, Brasil`,
    );
  } catch (error) {
    if (error instanceof MapsApiError) {
      throw new RoutePlanningError(error.message, error.status);
    }
    throw error;
  }
}

async function optimizeRoute(
  rows: DeliveryRow[],
  start: Coordinate,
  alreadyPickedUpDeliveryIds: ReadonlySet<string> = new Set(),
): Promise<{
  stops: Array<{
    deliveryId: string;
    kind: "pickup" | "delivery";
    address: string;
    latitude: number;
    longitude: number;
  }>;
  routeGeometry: Coordinate[] | null;
  distanceMeters: number | null;
  durationSeconds: number | null;
}> {
  const pickupByDelivery = new Map<string, Coordinate>();
  const customerByDelivery = new Map<string, Coordinate>();
  const geocodeCache = new Map<string, Promise<Coordinate>>();
  const getGeocode = (address: string, city: string) => {
    const cacheKey = `${address.trim().toLowerCase()}|${city.trim().toLowerCase()}`;
    let pending = geocodeCache.get(cacheKey);
    if (!pending) {
      pending = geocodeAddress(address, city);
      geocodeCache.set(cacheKey, pending);
    }
    return pending;
  };
  await Promise.all(rows.map(async (row) => {
    const alreadyPickedUp = alreadyPickedUpDeliveryIds.has(row.delivery.id);
    const [pickup, customer] = await Promise.all([
      alreadyPickedUp
        ? start
        : storedCoordinate(row.storeLatitude, row.storeLongitude) ??
        getGeocode(row.storeAddress, row.storeCity),
      storedCoordinate(
        row.delivery.customerLatitude,
        row.delivery.customerLongitude,
      ) ?? getGeocode(row.delivery.destination, row.storeCity),
    ]);
    pickupByDelivery.set(row.delivery.id, pickup);
    customerByDelivery.set(row.delivery.id, customer);
  }));

  let visits: OptimizedVisit[];
  try {
    visits = await optimizeShipments({
      start,
      shipments: rows.map((row) => {
        const alreadyPickedUp = alreadyPickedUpDeliveryIds.has(row.delivery.id);
        return {
          id: row.delivery.id,
          pickup: alreadyPickedUp ? null : pickupByDelivery.get(row.delivery.id)!,
          delivery: customerByDelivery.get(row.delivery.id)!,
          pickupDurationSeconds: 120,
          deliveryDurationSeconds: 90,
        };
      }),
    });
  } catch (error) {
    if (error instanceof MapsApiError) {
      throw new RoutePlanningError(error.message, error.status);
    }
    throw error;
  }

  const rowByDelivery = new Map(rows.map((row) => [row.delivery.id, row]));
  const stops: Array<{
    deliveryId: string;
    kind: "pickup" | "delivery";
    address: string;
    latitude: number;
    longitude: number;
  }> = [];
  for (const visit of visits) {
    const isPickup = visit.kind === "pickup";
    if (isPickup && alreadyPickedUpDeliveryIds.has(visit.shipmentId)) continue;
    const row = rowByDelivery.get(visit.shipmentId);
    if (!row) continue;
    const coordinate = isPickup
      ? pickupByDelivery.get(visit.shipmentId)
      : customerByDelivery.get(visit.shipmentId);
    if (!coordinate) continue;
    stops.push({
      deliveryId: visit.shipmentId,
      kind: visit.kind,
      address: isPickup
        ? `${row.storeAddress}, ${row.storeCity}`
        : row.delivery.destination,
      latitude: coordinate.latitude,
      longitude: coordinate.longitude,
    });
  }

  const expectedStops =
    rows.length * 2 -
    rows.filter((row) => alreadyPickedUpDeliveryIds.has(row.delivery.id)).length;
  if (stops.length !== expectedStops) {
    throw new RoutePlanningError(
      "A rota calculada não incluiu todas as retiradas e entregas. A oferta continua disponível.",
      502,
    );
  }
  // A rota é aberta: começa na posição do motoboy e termina na última entrega.
  const directionCoordinates: Coordinate[] = [
    start,
    ...stops.map(({ latitude, longitude }) => ({ latitude, longitude })),
  ];

  let directions;
  try {
    directions = await computeDrivingRoute(directionCoordinates);
  } catch (error) {
    if (error instanceof MapsApiError) {
      throw new RoutePlanningError(error.message, error.status);
    }
    throw error;
  }
  if (directions.geometry.length < 2) {
    throw new RoutePlanningError(
      "O Google Maps não retornou o traçado viário desta rota.",
      502,
    );
  }
  return {
    stops,
    routeGeometry: directions.geometry,
    distanceMeters:
      directions.distanceMeters !== null
        ? Math.round(directions.distanceMeters)
        : null,
    durationSeconds:
      directions.durationSeconds !== null
        ? Math.round(directions.durationSeconds + rows.length * 210)
        : null,
  };
}

router.post(
  "/delivery-routes",
  requireRole("ADMIN", "CENTRAL", "STORE_MANAGER"),
  async (req, res): Promise<void> => {
    const body = CreateDeliveryRouteBody.safeParse(req.body);
    if (!body.success || new Set(body.data.deliveryIds).size !== body.data.deliveryIds.length) {
      res.status(400).json({ error: "Selecione de 2 a 10 entregas diferentes." });
      return;
    }

    const profile = res.locals.appUser as AppUserProfile;
    const deliveryIds = body.data.deliveryIds;
    const targetCourierId = body.data.courierId ?? null;
    if (profile.role === "STORE_MANAGER" && !profile.storeId) {
      res.status(403).json({ error: "Esta conta não está vinculada a uma filial." });
      return;
    }
    let targetCourierName: string | null = null;
    if (targetCourierId) {
      const [target] = await db
        .select({ id: couriersTable.id, name: couriersTable.name, status: couriersTable.status })
        .from(couriersTable)
        .where(eq(couriersTable.id, targetCourierId))
        .limit(1);
      if (!target) {
        res.status(400).json({ error: "Motoboy não encontrado." });
        return;
      }
      if (target.status !== "AVAILABLE") {
        res.status(409).json({
          error: target.status === "BUSY"
            ? `${target.name} está em outra entrega agora. Escolha outro motoboy ou ofereça a todos.`
            : `${target.name} está offline. Escolha um motoboy disponível ou ofereça a todos.`,
        });
        return;
      }
      targetCourierName = target.name;
    }
    const result = await db.transaction(async (tx) => {
      const rows = [];
      for (const deliveryId of [...deliveryIds].sort()) {
        const [delivery] = await tx
          .select()
          .from(deliveriesTable)
          .where(eq(deliveriesTable.id, deliveryId))
          .for("update");
        if (!delivery) return { error: "not_found" as const };
        // Gerente só monta rota com entregas da própria filial.
        if (profile.role === "STORE_MANAGER" && delivery.storeId !== profile.storeId) {
          return { error: "not_found" as const };
        }
        const waitingInQueue =
          delivery.status === "REQUESTED" ||
          delivery.status === "AWAITING_COURIER" ||
          (delivery.status === "OFFERED" && !delivery.courierId);
        if (!waitingInQueue) {
          return { error: "not_requested" as const };
        }
        const [inRoute] = await tx
          .select({ id: deliveryRoutesTable.id })
          .from(deliveryRoutesTable)
          .where(
            and(
              inArray(deliveryRoutesTable.status, ["OFFERED", "ACCEPTED"]),
              sql`${delivery.id} = ANY(${deliveryRoutesTable.deliveryIds})`,
            ),
          )
          .limit(1);
        if (inRoute) return { error: "not_requested" as const };
        rows.push(delivery);
      }

      const routeId = randomUUID();
      await tx.insert(deliveryRoutesTable).values({
        id: routeId,
        deliveryIds,
        status: "OFFERED",
        // Com motoboy escolhido, só ele vê e pode aceitar a oferta.
        courierId: targetCourierId,
        createdBy: profile.id,
      });
      for (const delivery of rows) {
        await tx
          .update(deliveriesTable)
          .set({ status: "OFFERED", courierId: null, updatedAt: new Date() })
          .where(eq(deliveriesTable.id, delivery.id));
        await tx.insert(deliveryEventsTable).values({
          id: randomUUID(),
          deliveryId: delivery.id,
          kind: "offered",
          label: targetCourierName
            ? `Entrega incluída em uma rota oferecida a ${targetCourierName}`
            : "Entrega incluída em uma oferta de rota agrupada",
          actor: profile.role === "STORE_MANAGER" ? "Gerente da filial" : "Central de entregas",
        });
      }
      return { routeId };
    });

    if ("error" in result) {
      const notFound = result.error === "not_found";
      res.status(notFound ? 404 : 409).json({
        error: notFound
          ? "Uma das entregas selecionadas não foi encontrada."
          : "Uma ou mais entregas já foram despachadas. Atualize a fila e tente novamente.",
      });
      return;
    }

    const [route] = await db
      .select()
      .from(deliveryRoutesTable)
      .where(eq(deliveryRoutesTable.id, result.routeId))
      .limit(1);
    if (!route) {
      res.status(500).json({ error: "Não foi possível carregar a rota criada." });
      return;
    }
    if (targetCourierId) {
      await notifyCouriers([targetCourierId], {
        title: "Rota para você",
        body: `${route.deliveryIds.length} entregas aguardam o seu aceite.`,
      });
    } else {
      await notifyCityCouriers(
        route.deliveryIds[0],
        "Nova rota disponível",
        `${route.deliveryIds.length} entregas aguardam aceite.`,
      );
    }
    res.status(201).json(CreateDeliveryRouteResponse.parse(await routeView(route)));
  },
);

/**
 * Trajeto de cada entrega avulsa em andamento, como o motoboy vê no app:
 * indo para a loja = motoboy → loja → cliente; já retirou = motoboy → cliente.
 * Calculado pelo Google e guardado em memória; só recalcula quando o motoboy anda
 * uns 150 m ou a etapa muda (sem chamar o Google a cada atualização do painel).
 */
const individualRouteCache = new Map<string, Array<{ latitude: number; longitude: number }>>();

async function individualRouteGeometry(row: {
  id: string;
  status: string;
  storeLatitude: number | null;
  storeLongitude: number | null;
  customerLatitude: number | null;
  customerLongitude: number | null;
  courierLatitude: number | null;
  courierLongitude: number | null;
}) {
  if (row.customerLatitude == null || row.customerLongitude == null) return null;
  const customer = { latitude: row.customerLatitude, longitude: row.customerLongitude };
  const store = row.storeLatitude != null && row.storeLongitude != null
    ? { latitude: row.storeLatitude, longitude: row.storeLongitude }
    : null;
  const courier = row.courierLatitude != null && row.courierLongitude != null
    ? { latitude: row.courierLatitude, longitude: row.courierLongitude }
    : null;
  const pickedUp = row.status === "IN_TRANSIT";
  const points = [
    ...(courier ? [courier] : []),
    ...(!pickedUp && store ? [store] : []),
    customer,
  ];
  if (points.length < 2) return null;
  // ~150 m de grade na posição do motoboy.
  const grid = (value: number) => (Math.round(value * 700) / 700).toFixed(4);
  const key = `${row.id}:${pickedUp ? "cliente" : "loja"}:${courier ? `${grid(courier.latitude)},${grid(courier.longitude)}` : "sem-gps"}`;
  const cached = individualRouteCache.get(key);
  if (cached) return cached;
  try {
    const directions = await computeDrivingRoute(points);
    if (directions.geometry.length < 2) return null;
    if (individualRouteCache.size > 500) individualRouteCache.clear();
    individualRouteCache.set(key, directions.geometry);
    return directions.geometry;
  } catch {
    return null;
  }
}

router.get(
  "/operations/active-routes",
  // Gerente acompanha o trajeto dos motoboys com entregas da filial dele.
  requireRole("ADMIN", "CENTRAL", "STORE_MANAGER"),
  async (_req, res): Promise<void> => {
    const profile = res.locals.appUser as AppUserProfile;
    const managerStore = profile.role === "STORE_MANAGER" ? profile.storeId ?? "__none__" : null;
    const routes = await db
      .select({
        id: deliveryRoutesTable.id,
        courierId: deliveryRoutesTable.courierId,
        routeGeometry: deliveryRoutesTable.routeGeometry,
        deliveryIds: deliveryRoutesTable.deliveryIds,
        courierName: couriersTable.name,
        courierEmail: linkedCourierEmail,
      })
      .from(deliveryRoutesTable)
      .innerJoin(
        couriersTable,
        eq(deliveryRoutesTable.courierId, couriersTable.id),
      )
      .where(eq(deliveryRoutesTable.status, "ACCEPTED"));
    const routedIds = new Set(routes.flatMap((route) => route.deliveryIds));
    let visibleRoutes = routes;
    if (managerStore) {
      const routeStores = routedIds.size
        ? await db
            .select({ id: deliveriesTable.id, storeId: deliveriesTable.storeId })
            .from(deliveriesTable)
            .where(inArray(deliveriesTable.id, [...routedIds]))
        : [];
      const storeOf = new Map(routeStores.map((row) => [row.id, row.storeId]));
      visibleRoutes = routes.filter((route) => route.deliveryIds.some((id) => storeOf.get(id) === managerStore));
    }

    // Entregas avulsas em andamento (fora de rota agrupada): trajeto loja → cliente.
    const individual = await db
      .select({
        id: deliveriesTable.id,
        status: deliveriesTable.status,
        courierId: deliveriesTable.courierId,
        storeId: deliveriesTable.storeId,
        courierLatitude: couriersTable.currentLatitude,
        courierLongitude: couriersTable.currentLongitude,
        customerLatitude: deliveriesTable.customerLatitude,
        customerLongitude: deliveriesTable.customerLongitude,
        storeLatitude: storesTable.latitude,
        storeLongitude: storesTable.longitude,
        courierName: couriersTable.name,
        courierEmail: linkedCourierEmail,
      })
      .from(deliveriesTable)
      .innerJoin(storesTable, eq(deliveriesTable.storeId, storesTable.id))
      .innerJoin(couriersTable, eq(deliveriesTable.courierId, couriersTable.id))
      .where(
        and(
          inArray(deliveriesTable.status, ["ACCEPTED", "TO_STORE", "AT_STORE", "IN_TRANSIT"]),
          managerStore ? eq(deliveriesTable.storeId, managerStore) : undefined,
        ),
      );
    const pending = individual.filter((row) => !routedIds.has(row.id));
    const countByCourier = new Map<string, number>();
    for (const row of pending) countByCourier.set(row.courierId!, (countByCourier.get(row.courierId!) ?? 0) + 1);
    const planned = new Set<string>();
    const planRoutes = (
      await Promise.all(
        [...countByCourier.entries()]
          // Gerente vê só as entregas da filial dele: linha por entrega (a rota completa pode ter outras lojas).
          .filter(([, count]) => count >= 2 && !managerStore)
          .map(async ([courierId]) => {
            const computed = await computeCourierPlan(courierId).catch(() => null);
            if (!computed?.plan.routeGeometry) return [];
            for (const row of computed.rows) planned.add(row.delivery.id);
            const sample = pending.find((row) => row.courierId === courierId)!;
            return [{
              id: `plano-${courierId}`,
              courierId,
              courierFirstName: getCourierFirstName(sample.courierName, sample.courierEmail),
              routeGeometry: computed.plan.routeGeometry,
            }];
          }),
      )
    ).flat();
    const individualRoutes = (
      await Promise.all(
        pending
          .filter((row) => !planned.has(row.id))
          .map(async (row) => {
            const geometry = await individualRouteGeometry(row);
            return geometry
              ? [{
                  id: `delivery-${row.id}`,
                  courierId: row.courierId!,
                  courierFirstName: getCourierFirstName(row.courierName, row.courierEmail),
                  routeGeometry: geometry,
                }]
              : [];
          }),
      )
    ).flat();

    res.json(
      ListActiveRoutesResponse.parse([
        ...visibleRoutes.flatMap((route) =>
          route.routeGeometry
            ? [{
                id: route.id,
                courierId: route.courierId!,
                courierFirstName: getCourierFirstName(
                  route.courierName,
                  route.courierEmail,
                ),
                routeGeometry: route.routeGeometry,
              }]
            : [],
        ),
        ...planRoutes,
        ...individualRoutes,
      ]),
    );
  },
);

/** Quem pode mexer numa rota: Central/admin, ou o gerente se todas as entregas forem da filial dele. */
async function canManageRoute(profile: AppUserProfile, deliveryIds: string[]) {
  if (profile.role === "ADMIN" || profile.role === "CENTRAL") return true;
  if (profile.role !== "STORE_MANAGER" || !profile.storeId || !deliveryIds.length) return false;
  const rows = await db
    .select({ storeId: deliveriesTable.storeId })
    .from(deliveriesTable)
    .where(inArray(deliveriesTable.id, deliveryIds));
  return rows.length === deliveryIds.length && rows.every((row) => row.storeId === profile.storeId);
}

function actorFor(profile: AppUserProfile) {
  return profile.role === "STORE_MANAGER" ? "Gerente da filial" : "Central de entregas";
}

router.post(
  "/delivery-routes/:routeId/ungroup",
  requireRole("ADMIN", "CENTRAL", "STORE_MANAGER"),
  async (req, res): Promise<void> => {
    const routeId = String(req.params.routeId ?? "");
    const profile = res.locals.appUser as AppUserProfile;
    const [route] = await db
      .select()
      .from(deliveryRoutesTable)
      .where(eq(deliveryRoutesTable.id, routeId))
      .limit(1);
    if (!route || !(await canManageRoute(profile, route.deliveryIds))) {
      res.status(404).json({ error: "Rota não encontrada." });
      return;
    }
    if (route.status !== "OFFERED") {
      res.status(409).json({
        error: route.status === "ACCEPTED"
          ? "O motoboy já aceitou esta rota. Tire as entregas uma a uma com \"Tirar da rota\"."
          : "Esta rota não está mais ativa.",
      });
      return;
    }
    const done = await db.transaction(async (tx) => {
      const [locked] = await tx
        .select({ status: deliveryRoutesTable.status })
        .from(deliveryRoutesTable)
        .where(eq(deliveryRoutesTable.id, route.id))
        .for("update");
      if (locked?.status !== "OFFERED") return false;
      await tx.update(deliveryRoutesTable).set({ status: "CANCELLED" }).where(eq(deliveryRoutesTable.id, route.id));
      for (const deliveryId of route.deliveryIds) {
        const [current] = await tx
          .select({ status: deliveriesTable.status })
          .from(deliveriesTable)
          .where(eq(deliveriesTable.id, deliveryId))
          .limit(1);
        if (current?.status === "OFFERED") {
          await offerToCity(tx, { id: deliveryId, courierId: null }, "Rota desfeita: voltou para a fila dos motoboys", actorFor(profile));
        }
      }
      return true;
    });
    if (!done) {
      res.status(409).json({ error: "A rota mudou enquanto era desfeita. Atualize e tente de novo." });
      return;
    }
    if (route.deliveryIds[0]) {
      await notifyCityCouriers(route.deliveryIds[0], "Entregas na fila", `${route.deliveryIds.length} entregas voltaram para a fila. Quem aceitar primeiro leva.`);
    }
    if (route.courierId) {
      await notifyCouriers([route.courierId], { title: "Rota cancelada", body: "A rota que tinha sido oferecida a você foi desfeita." });
    }
    res.sendStatus(204);
  },
);

router.post(
  "/delivery-routes/:routeId/remove-delivery",
  requireRole("ADMIN", "CENTRAL", "STORE_MANAGER"),
  async (req, res): Promise<void> => {
    const routeId = String(req.params.routeId ?? "");
    const body = RemoveDeliveryFromRouteBody.safeParse(req.body);
    if (!body.success) {
      res.status(400).json({ error: "Escolha a entrega que vai sair da rota." });
      return;
    }
    const profile = res.locals.appUser as AppUserProfile;
    const { deliveryId } = body.data;
    const cancel = body.data.cancel === true;
    const reason = body.data.reason?.trim() || null;
    const [route] = await db
      .select()
      .from(deliveryRoutesTable)
      .where(eq(deliveryRoutesTable.id, routeId))
      .limit(1);
    if (!route || !route.deliveryIds.includes(deliveryId) || !(await canManageRoute(profile, [deliveryId]))) {
      res.status(404).json({ error: "Esta entrega não está nesta rota." });
      return;
    }
    if (!["OFFERED", "ACCEPTED"].includes(route.status)) {
      res.status(409).json({ error: "Esta rota não está mais ativa." });
      return;
    }

    const remainingIds = route.deliveryIds.filter((id) => id !== deliveryId);
    // Rota já aceita: redesenha o caminho das paradas que sobraram (a ordem continua a mesma).
    let geometry: { routeGeometry: { latitude: number; longitude: number }[] | null; distanceMeters: number | null; durationSeconds: number | null } | null = null;
    let courierStart: { latitude: number; longitude: number } | null = null;
    if (route.status === "ACCEPTED" && route.courierId) {
      const [courierRow] = await db
        .select({ latitude: couriersTable.currentLatitude, longitude: couriersTable.currentLongitude })
        .from(couriersTable)
        .where(eq(couriersTable.id, route.courierId))
        .limit(1);
      if (courierRow?.latitude != null && courierRow.longitude != null) {
        courierStart = { latitude: courierRow.latitude, longitude: courierRow.longitude };
      }
      const pendingStops = (
        await db
          .select()
          .from(deliveryRouteStopsTable)
          .where(and(eq(deliveryRouteStopsTable.routeId, route.id), eq(deliveryRouteStopsTable.status, "PENDING")))
          .orderBy(asc(deliveryRouteStopsTable.sequence))
      ).filter((stop) => stop.deliveryId !== deliveryId);
      const points = [
        ...(courierStart ? [courierStart] : []),
        ...pendingStops.map((stop) => ({ latitude: stop.latitude, longitude: stop.longitude })),
      ];
      if (points.length >= 2) {
        try {
          const directions = await computeDrivingRoute(points);
          geometry = {
            routeGeometry: directions.geometry,
            distanceMeters: directions.distanceMeters,
            durationSeconds: directions.durationSeconds,
          };
        } catch (error) {
          req.log.warn({ err: error }, "Could not redraw the route after removing a delivery");
        }
      }
    }

    const result = await db.transaction(async (tx) => {
      const [locked] = await tx
        .select()
        .from(deliveryRoutesTable)
        .where(eq(deliveryRoutesTable.id, route.id))
        .for("update");
      if (!locked || locked.status !== route.status || !locked.deliveryIds.includes(deliveryId)) {
        return { error: "changed" as const };
      }
      const [delivery] = await tx
        .select()
        .from(deliveriesTable)
        .where(eq(deliveriesTable.id, deliveryId))
        .for("update");
      if (!delivery) return { error: "changed" as const };
      // Produto já está com o motoboy: precisa voltar para a loja (ocorrência no app do motoboy).
      if (delivery.status === "IN_TRANSIT") return { error: "picked_up" as const };
      if (["COMPLETED", "CANCELLED", "NOT_DELIVERED", "RETURNING_TO_STORE", "PRODUCT_RETURNED"].includes(delivery.status)) {
        return { error: "closed" as const };
      }

      const now = new Date();
      const routeStillHasWork = remainingIds.length > 0;
      const nextRouteStatus = routeStillHasWork
        ? locked.status
        : locked.status === "ACCEPTED"
          ? "COMPLETED"
          : "CANCELLED";
      await tx
        .update(deliveryRoutesTable)
        .set({
          deliveryIds: remainingIds,
          status: nextRouteStatus,
          ...(locked.status === "ACCEPTED" && geometry ? geometry : {}),
        })
        .where(eq(deliveryRoutesTable.id, locked.id));
      if (locked.status === "ACCEPTED") {
        await tx
          .update(deliveryRouteStopsTable)
          .set({ status: "CANCELLED" })
          .where(
            and(
              eq(deliveryRouteStopsTable.routeId, locked.id),
              eq(deliveryRouteStopsTable.deliveryId, deliveryId),
              eq(deliveryRouteStopsTable.status, "PENDING"),
            ),
          );
      }
      await tx
        .update(deliveriesTable)
        .set({ status: cancel ? "CANCELLED" : "REQUESTED", courierId: null, updatedAt: now })
        .where(eq(deliveriesTable.id, deliveryId));
      if (!cancel) {
        await offerToCity(tx, { id: deliveryId, courierId: null }, "Voltou para a fila dos motoboys", actorFor(profile));
      }
      await tx.insert(deliveryEventsTable).values({
        id: randomUUID(),
        deliveryId,
        kind: cancel ? "cancelled" : "route_removed",
        label: cancel
          ? `Retirada da rota e cancelada${reason ? `: ${reason}` : " (cliente desistiu)"}`
          : "Retirada da rota: a entrega voltou para a fila",
        actor: actorFor(profile),
        timestamp: now,
      });

      if (locked.status === "ACCEPTED" && locked.courierId) {
        if (routeStillHasWork) {
          // Próxima parada pendente vira a entrega atual do motoboy.
          const [nextStop] = await tx
            .select({ deliveryId: deliveryRouteStopsTable.deliveryId })
            .from(deliveryRouteStopsTable)
            .where(and(eq(deliveryRouteStopsTable.routeId, locked.id), eq(deliveryRouteStopsTable.status, "PENDING")))
            .orderBy(asc(deliveryRouteStopsTable.sequence))
            .limit(1);
          const [next] = nextStop
            ? await tx.select({ code: deliveriesTable.code }).from(deliveriesTable).where(eq(deliveriesTable.id, nextStop.deliveryId)).limit(1)
            : [];
          await tx
            .update(couriersTable)
            .set({ currentDeliveryCode: next?.code ?? null })
            .where(eq(couriersTable.id, locked.courierId));
        } else {
          await tx
            .update(couriersTable)
            .set({ status: "AVAILABLE", currentDeliveryCode: null })
            .where(eq(couriersTable.id, locked.courierId));
        }
      }
      return { routeStatus: nextRouteStatus, remaining: remainingIds.length, code: delivery.code };
    });

    if ("error" in result) {
      res.status(409).json({
        error: result.error === "picked_up"
          ? "O motoboy já retirou esta entrega na loja. Peça para ele registrar \"Não consigo entregar\" e devolver o produto na filial."
          : result.error === "closed"
            ? "Esta entrega já foi encerrada."
            : "A rota mudou agora há pouco. Atualize e tente de novo.",
      });
      return;
    }
    if (route.courierId) {
      await notifyCouriers([route.courierId], {
        title: "Rota alterada",
        body: result.remaining
          ? `A entrega ${result.code} saiu da sua rota. Siga para a próxima parada.`
          : `A entrega ${result.code} saiu da sua rota. Não há mais paradas.`,
      });
    }
    res.json(RemoveDeliveryFromRouteResponse.parse({ routeStatus: result.routeStatus, remainingDeliveries: result.remaining }));
  },
);

router.get(
  "/courier/routes",
  requireRole("COURIER"),
  async (_req, res): Promise<void> => {
    const profile = res.locals.appUser as AppUserProfile;
    if (!profile.courierId) {
      res.status(403).json({ error: "Esta conta não está vinculada a um motoboy." });
      return;
    }

    const [courier] = await db
      .select({ status: couriersTable.status })
      .from(couriersTable)
      .where(eq(couriersTable.id, profile.courierId))
      .limit(1);
    if (!courier) {
      res.status(403).json({ error: "Esta conta não está vinculada a um motoboy." });
      return;
    }

    const declinedRows = await db
      .select({ routeId: courierRouteOfferDeclinesTable.routeId })
      .from(courierRouteOfferDeclinesTable)
      .where(eq(courierRouteOfferDeclinesTable.courierId, profile.courierId));
    const declinedRouteIds = declinedRows.map((row) => row.routeId);
    const offeredToMe = and(
      eq(deliveryRoutesTable.status, "OFFERED"),
      or(isNull(deliveryRoutesTable.courierId), eq(deliveryRoutesTable.courierId, profile.courierId)),
      openRouteInCity(await courierCity(profile.courierId)),
    );
    const availableOffers = declinedRouteIds.length
      ? and(offeredToMe, notInArray(deliveryRoutesTable.id, declinedRouteIds))
      : offeredToMe;

    const routes = await db
      .select()
      .from(deliveryRoutesTable)
      .where(
        courier.status === "AVAILABLE"
          ? or(
              availableOffers,
              and(
                eq(deliveryRoutesTable.courierId, profile.courierId),
                eq(deliveryRoutesTable.status, "ACCEPTED"),
              ),
            )
          : and(
            eq(deliveryRoutesTable.courierId, profile.courierId),
            eq(deliveryRoutesTable.status, "ACCEPTED"),
          ),
      )
      .orderBy(asc(deliveryRoutesTable.createdAt));
    const result = await Promise.all(routes.map(courierRouteView));
    res.json(ListCourierRoutesResponse.parse(result));
  },
);

router.get(
  "/courier/routes/:routeId/preview",
  requireRole("COURIER"),
  async (req, res): Promise<void> => {
    const params = GetCourierRoutePreviewParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: "Rota inválida." });
      return;
    }
    const profile = res.locals.appUser as AppUserProfile;
    if (!profile.courierId) {
      res.status(403).json({ error: "Esta conta não está vinculada a um motoboy." });
      return;
    }
    const [courier] = await db
      .select({
        status: couriersTable.status,
        currentLatitude: couriersTable.currentLatitude,
        currentLongitude: couriersTable.currentLongitude,
        lastLocationAt: couriersTable.lastLocationAt,
      })
      .from(couriersTable)
      .where(eq(couriersTable.id, profile.courierId))
      .limit(1);
    if (!courier || courier.status !== "AVAILABLE") {
      res.status(403).json({ error: "Fique online para visualizar a oferta." });
      return;
    }
    const [route] = await db
      .select()
      .from(deliveryRoutesTable)
      .where(
        and(
          eq(deliveryRoutesTable.id, params.data.routeId),
          eq(deliveryRoutesTable.status, "OFFERED"),
          or(isNull(deliveryRoutesTable.courierId), eq(deliveryRoutesTable.courierId, profile.courierId)),
        ),
      )
      .limit(1);
    if (!route) {
      res.status(404).json({ error: "Esta oferta não está mais disponível." });
      return;
    }
    const [declined] = await db
      .select({ id: courierRouteOfferDeclinesTable.id })
      .from(courierRouteOfferDeclinesTable)
      .where(
        and(
          eq(courierRouteOfferDeclinesTable.routeId, route.id),
          eq(courierRouteOfferDeclinesTable.courierId, profile.courierId),
        ),
      )
      .limit(1);
    if (declined) {
      res.status(404).json({ error: "Esta oferta já foi recusada." });
      return;
    }
    const rows = await routeDeliveries(route.deliveryIds);
    if (rows.length !== route.deliveryIds.length || !rows.length) {
      res.status(409).json({ error: "Uma entrega da oferta não está mais disponível." });
      return;
    }
    if (!route.courierId) {
      const city = await courierCity(profile.courierId);
      if (rows.some((row) => !sameCity(city, row.storeCity))) {
        res.status(403).json({ error: "Esta rota é de uma filial de outra cidade." });
        return;
      }
    }

    const gpsIsFresh =
      courier.lastLocationAt != null &&
      Date.now() - courier.lastLocationAt.getTime() <= 120_000;
    let start = gpsIsFresh
      ? storedCoordinate(courier.currentLatitude, courier.currentLongitude)
      : null;
    try {
      start ??=
        storedCoordinate(rows[0].storeLatitude, rows[0].storeLongitude) ??
        (await geocodeAddress(rows[0].storeAddress, rows[0].storeCity));
      const plan = await optimizeRoute(rows, start);
      res.json(
        GetCourierRoutePreviewResponse.parse({
          startPosition: start,
          stops: plan.stops,
          routeGeometry: plan.routeGeometry,
          distanceKm:
            plan.distanceMeters == null
              ? null
              : Number((plan.distanceMeters / 1000).toFixed(1)),
          estimatedMinutes:
            plan.durationSeconds == null
              ? null
              : Math.ceil(plan.durationSeconds / 60),
        }),
      );
    } catch (error) {
      if (error instanceof RoutePlanningError) {
        res.status(error.status).json({ error: error.message });
        return;
      }
      throw error;
    }
  },
);

router.patch(
  "/courier/availability",
  requireRole("COURIER"),
  async (req, res): Promise<void> => {
    const body = UpdateCourierAvailabilityBody.safeParse(req.body);
    if (!body.success) {
      res.status(400).json({ error: "Informe se deseja ficar online ou offline." });
      return;
    }

    const profile = res.locals.appUser as AppUserProfile;
    if (!profile.courierId) {
      res.status(403).json({ error: "Esta conta não está vinculada a um motoboy." });
      return;
    }

    const result = await db.transaction(async (tx) => {
      const [courier] = await tx
        .select()
        .from(couriersTable)
        .where(eq(couriersTable.id, profile.courierId!))
        .for("update");
      if (!courier) return { error: "not_found" as const };

      if (!body.data.online) {
        const [activeDelivery] = await tx
          .select({ id: deliveriesTable.id })
          .from(deliveriesTable)
          .where(
            and(
              eq(deliveriesTable.courierId, profile.courierId!),
              inArray(deliveriesTable.status, [
                "ACCEPTED",
                "TO_STORE",
                "AT_STORE",
                "IN_TRANSIT",
                "RETURNING_TO_STORE",
              ]),
            ),
          )
          .limit(1);
        const [activeRoute] = await tx
          .select({ id: deliveryRoutesTable.id })
          .from(deliveryRoutesTable)
          .where(
            and(
              eq(deliveryRoutesTable.courierId, profile.courierId!),
              eq(deliveryRoutesTable.status, "ACCEPTED"),
            ),
          )
          .limit(1);
        if (activeDelivery || activeRoute) return { error: "active_work" as const };
      }

      const status =
        body.data.online
          ? courier.status === "OFFLINE" ? "AVAILABLE" : courier.status
          : "OFFLINE";
      await tx
        .update(couriersTable)
        .set({ status })
        .where(eq(couriersTable.id, courier.id));
      return { status };
    });

    if ("error" in result) {
      if (result.error === "not_found") {
        res.status(403).json({ error: "Esta conta não está vinculada a um motoboy." });
        return;
      }
      res.status(409).json({
        error: "Conclua ou cancele sua entrega ativa antes de ficar offline.",
      });
      return;
    }
    res.json(
      UpdateCourierAvailabilityResponse.parse({
        online: result.status !== "OFFLINE",
        status: result.status,
      }),
    );
  },
);

router.post(
  "/courier/deliveries/:deliveryId/decline",
  requireRole("COURIER"),
  async (req, res): Promise<void> => {
    const params = DeclineCourierDeliveryParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: "Entrega inválida." });
      return;
    }
    const profile = res.locals.appUser as AppUserProfile;
    if (!profile.courierId) {
      res.status(403).json({ error: "Esta conta não está vinculada a um motoboy." });
      return;
    }

    const result = await db.transaction(async (tx) => {
      const [delivery] = await tx
        .select()
        .from(deliveriesTable)
        .where(eq(deliveriesTable.id, params.data.deliveryId))
        .for("update");
      if (!delivery || delivery.status !== "OFFERED") {
        return { error: "not_offered" as const };
      }
      // Oferta aberta a todos: só some para este motoboy; os outros continuam vendo.
      if (!delivery.courierId) {
        await tx.execute(sql`
          INSERT INTO delivery_offer_declines (id, delivery_id, courier_id)
          VALUES (${randomUUID()}, ${delivery.id}, ${profile.courierId})
          ON CONFLICT DO NOTHING`);
        return { ok: true as const, broadcast: true };
      }
      if (delivery.courierId !== profile.courierId) {
        return { error: "not_offered" as const };
      }
      // Oferta direcionada recusada: vai para a fila de todos os motoboys da cidade.
      await offerToCity(
        tx,
        { id: delivery.id, courierId: null },
        `${getCourierDisplayName(profile.name, profile.email)} recusou; voltou para a fila dos motoboys`,
        getCourierDisplayName(profile.name, profile.email),
      );
      return { ok: true as const, broadcast: false };
    });

    if ("error" in result) {
      res.status(409).json({ error: "Esta entrega não está mais disponível para recusa." });
      return;
    }
    if (!result.broadcast) {
      await notifyCityCouriers(params.data.deliveryId, "Nova entrega disponível", "Uma entrega voltou para a fila. Quem aceitar primeiro leva.");
    }
    res.sendStatus(204);
  },
);

router.post(
  "/courier/routes/:routeId/decline",
  requireRole("COURIER"),
  async (req, res): Promise<void> => {
    const params = DeclineCourierRouteParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: "Rota inválida." });
      return;
    }
    const profile = res.locals.appUser as AppUserProfile;
    if (!profile.courierId) {
      res.status(403).json({ error: "Esta conta não está vinculada a um motoboy." });
      return;
    }
    const [courier] = await db
      .select({ status: couriersTable.status })
      .from(couriersTable)
      .where(eq(couriersTable.id, profile.courierId))
      .limit(1);
    const [route] = await db
      .select({ id: deliveryRoutesTable.id, status: deliveryRoutesTable.status, courierId: deliveryRoutesTable.courierId, deliveryIds: deliveryRoutesTable.deliveryIds })
      .from(deliveryRoutesTable)
      .where(eq(deliveryRoutesTable.id, params.data.routeId))
      .limit(1);
    if (courier?.status !== "AVAILABLE" || route?.status !== "OFFERED" || (route.courierId && route.courierId !== profile.courierId)) {
      res.status(409).json({ error: "Esta rota não está mais disponível para recusa." });
      return;
    }
    if (route.courierId === profile.courierId) {
      // A rota era só para este motoboy: as entregas voltam para a fila como novas.
      const returned = await db.transaction(async (tx) => {
        const [locked] = await tx
          .select({ status: deliveryRoutesTable.status })
          .from(deliveryRoutesTable)
          .where(eq(deliveryRoutesTable.id, route.id))
          .for("update");
        if (locked?.status !== "OFFERED") return false;
        await tx
          .update(deliveryRoutesTable)
          .set({ status: "DECLINED" })
          .where(eq(deliveryRoutesTable.id, route.id));
        const [courierRow] = await tx
          .select({ name: couriersTable.name })
          .from(couriersTable)
          .where(eq(couriersTable.id, profile.courierId!))
          .limit(1);
        for (const deliveryId of route.deliveryIds) {
          const [current] = await tx
            .select({ status: deliveriesTable.status })
            .from(deliveriesTable)
            .where(eq(deliveriesTable.id, deliveryId))
            .limit(1);
          if (current?.status === "OFFERED") {
            await offerToCity(
              tx,
              { id: deliveryId, courierId: null },
              `${courierRow?.name ?? "O motoboy"} recusou a rota; voltou para a fila dos motoboys`,
              courierRow?.name ?? "Motoboy",
            );
          }
        }
        return true;
      });
      if (!returned) {
        res.status(409).json({ error: "Esta rota não está mais disponível para recusa." });
        return;
      }
      await notifyCentralUsers({
        title: "Rota recusada",
        body: `${route.deliveryIds.length} entregas voltaram para a fila dos motoboys.`,
        url: "/entregas",
      });
      if (route.deliveryIds[0]) {
        await notifyCityCouriers(route.deliveryIds[0], "Entregas na fila", `${route.deliveryIds.length} entregas aguardam um motoboy. Quem aceitar primeiro leva.`);
      }
      res.sendStatus(204);
      return;
    }
    await db
      .insert(courierRouteOfferDeclinesTable)
      .values({
        id: randomUUID(),
        routeId: route.id,
        courierId: profile.courierId,
      })
      .onConflictDoNothing();
    res.sendStatus(204);
  },
);

router.post(
  "/courier/location",
  requireRole("COURIER"),
  async (req, res): Promise<void> => {
    const body = UpdateCourierLocationBody.safeParse(req.body);
    if (!body.success) {
      res.status(400).json({ error: "Informe uma localização GPS válida." });
      return;
    }

    const profile = res.locals.appUser as AppUserProfile;
    if (!profile.courierId) {
      res.status(403).json({ error: "Esta conta não está vinculada a um motoboy." });
      return;
    }

    const [courier] = await db
      .select()
      .from(couriersTable)
      .where(eq(couriersTable.id, profile.courierId))
      .limit(1);
    if (!courier) {
      res.status(404).json({ error: "Motoboy não encontrado." });
      return;
    }

    const now = new Date();
    const [updated] = await db
      .update(couriersTable)
      .set({
        currentLatitude: body.data.latitude,
        currentLongitude: body.data.longitude,
        currentAccuracyMeters: body.data.accuracyMeters ?? null,
        currentSpeedMetersPerSecond:
          body.data.speedMetersPerSecond ?? null,
        locationMeasuredAt: new Date(body.data.measuredAt),
        lastLocationAt: now,
      })
      .where(eq(couriersTable.id, profile.courierId))
      .returning();
    if (!updated) {
      res.status(404).json({ error: "Motoboy não encontrado." });
      return;
    }

    res.json(
      UpdateCourierLocationResponse.parse({
        latitude: updated.currentLatitude,
        longitude: updated.currentLongitude,
        accuracyMeters: updated.currentAccuracyMeters,
        speedMetersPerSecond: updated.currentSpeedMetersPerSecond,
        measuredAt: updated.locationMeasuredAt?.toISOString(),
        lastLocationAt: updated.lastLocationAt?.toISOString(),
      }),
    );
  },
);

router.get(
  "/courier/deliveries/:deliveryId/navigation",
  requireRole("COURIER"),
  async (req, res): Promise<void> => {
    const params = GetCourierDeliveryNavigationParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: "Entrega inválida." });
      return;
    }

    const profile = res.locals.appUser as AppUserProfile;
    if (!profile.courierId) {
      res.status(403).json({ error: "Esta conta não está vinculada a um motoboy." });
      return;
    }

    const [row] = await routeDeliveries([params.data.deliveryId]);
    if (!row) {
      res.status(404).json({ error: "Entrega não encontrada." });
      return;
    }
    if (row.delivery.courierId !== profile.courierId) {
      res.status(403).json({ error: "Esta entrega não pertence à sua conta." });
      return;
    }
    if (!["ACCEPTED", "TO_STORE", "AT_STORE", "IN_TRANSIT", "RETURNING_TO_STORE"].includes(row.delivery.status)) {
      res.status(409).json({ error: "O mapa da rota fica disponível durante um atendimento ativo." });
      return;
    }

    const [courier] = await db
      .select()
      .from(couriersTable)
      .where(eq(couriersTable.id, profile.courierId))
      .limit(1);
    if (
      !courier ||
      courier.status !== "BUSY" ||
      courier.currentLatitude == null ||
      courier.currentLongitude == null ||
      !courier.lastLocationAt ||
      Date.now() - courier.lastLocationAt.getTime() > 120_000
    ) {
      res.status(409).json({
        error: "Aguardando uma posição GPS real e atual. Permita a localização e mantenha o PWA aberto.",
      });
      return;
    }

    const targetsStore = ["ACCEPTED", "TO_STORE", "RETURNING_TO_STORE"].includes(row.delivery.status);
    const targetAddress = targetsStore
      ? `${row.storeAddress}, ${row.storeCity}`
      : row.delivery.destination;
    const targetLabel =
      row.delivery.status === "RETURNING_TO_STORE"
        ? "Devolução na filial"
        : targetsStore
          ? "Unidade de retirada"
          : "Entrega ao cliente";

    try {
      const storedTarget = targetsStore
        ? storedCoordinate(row.storeLatitude, row.storeLongitude)
        : storedCoordinate(
            row.delivery.customerLatitude,
            row.delivery.customerLongitude,
          );
      const targetPosition =
        storedTarget ??
        (await geocodeAddress(
          targetsStore ? row.storeAddress : row.delivery.destination,
          row.storeCity,
        ));
      const directions = await computeDrivingRoute([
        {
          latitude: courier.currentLatitude,
          longitude: courier.currentLongitude,
        },
        targetPosition,
      ]);
      const routeGeometry =
        directions.geometry.length >= 2 ? directions.geometry : null;
      if (!routeGeometry) {
        throw new RoutePlanningError("Não foi possível traçar a rota para este endereço.", 422);
      }

      res.json(
        GetCourierDeliveryNavigationResponse.parse({
          currentPosition: {
            latitude: courier.currentLatitude,
            longitude: courier.currentLongitude,
          },
          targetPosition,
          targetLabel,
          targetAddress,
          distanceMeters:
            directions.distanceMeters !== null
              ? Math.round(directions.distanceMeters)
              : null,
          durationSeconds:
            directions.durationSeconds !== null
              ? Math.round(directions.durationSeconds)
              : null,
          routeGeometry,
          lastLocationAt: courier.lastLocationAt.toISOString(),
        }),
      );
    } catch (error) {
      const routeError =
        error instanceof RoutePlanningError
          ? error
          : error instanceof MapsApiError
            ? new RoutePlanningError(error.message, error.status)
          : new RoutePlanningError("Não foi possível calcular a rota agora.", 502);
      res.status(routeError.status).json({ error: routeError.message });
    }
  },
);

router.post(
  "/courier/deliveries/:deliveryId/unable",
  requireRole("COURIER"),
  async (req, res): Promise<void> => {
    const params = CreateCourierDeliveryCancellationParams.safeParse(req.params);
    const body = CreateCourierDeliveryCancellationBody.safeParse(req.body);
    if (!params.success || !body.success) {
      res.status(400).json({ error: "Informe o motivo para não concluir a entrega." });
      return;
    }

    const profile = res.locals.appUser as AppUserProfile;
    if (!profile.courierId) {
      res.status(403).json({ error: "Esta conta não está vinculada a um motoboy." });
      return;
    }

    const [reason] = await db
      .select()
      .from(deliveryCancellationReasonsTable)
      .where(
        and(
          eq(deliveryCancellationReasonsTable.label, body.data.reason),
          eq(deliveryCancellationReasonsTable.active, true),
        ),
      )
      .limit(1);
    if (!reason) {
      res.status(400).json({ error: "Selecione um motivo ativo para a ocorrência." });
      return;
    }

    const [courier] = await db
      .select()
      .from(couriersTable)
      .where(eq(couriersTable.id, profile.courierId))
      .limit(1);
    const [targetRow] = await routeDeliveries([params.data.deliveryId]);
    if (!courier || !targetRow) {
      res.status(404).json({ error: "Motoboy ou entrega não encontrado." });
      return;
    }
    if (targetRow.delivery.courierId !== courier.id) {
      res.status(403).json({ error: "Esta entrega não pertence à sua conta." });
      return;
    }
    if (
      !["ACCEPTED", "TO_STORE", "AT_STORE", "IN_TRANSIT"].includes(
        targetRow.delivery.status,
      )
    ) {
      res.status(409).json({ error: "Esta entrega não está em andamento." });
      return;
    }

    const isAccident = reason.id === "MOTORCYCLE_ISSUE";
    const [activeRoute] = await db
      .select()
      .from(deliveryRoutesTable)
      .where(
        and(
          eq(deliveryRoutesTable.courierId, courier.id),
          eq(deliveryRoutesTable.status, "ACCEPTED"),
        ),
      )
      .limit(1);
    const belongsToRoute = Boolean(
      activeRoute?.deliveryIds.includes(targetRow.delivery.id),
    );
    if (activeRoute && !belongsToRoute) {
      res.status(409).json({ error: "Atualize a rota ativa antes de enviar a ocorrência." });
      return;
    }

    let routeStopsSnapshot: (typeof deliveryRouteStopsTable.$inferSelect)[] = [];
    let pendingDeliveryIds: string[] = [];
    let remainingRows: DeliveryRow[] = [];
    let pickedUpIds = new Set<string>();
    let recalculated:
      | Awaited<ReturnType<typeof optimizeRoute>>
      | null = null;

    if (belongsToRoute && activeRoute) {
      routeStopsSnapshot = await db
        .select()
        .from(deliveryRouteStopsTable)
        .where(eq(deliveryRouteStopsTable.routeId, activeRoute.id))
        .orderBy(asc(deliveryRouteStopsTable.sequence));
      pendingDeliveryIds = [
        ...new Set(
          routeStopsSnapshot
            .filter((stop) => stop.status === "PENDING")
            .map((stop) => stop.deliveryId),
        ),
      ];
      if (!pendingDeliveryIds.includes(targetRow.delivery.id)) {
        res.status(409).json({ error: "Esta entrega não tem parada pendente na rota ativa." });
        return;
      }

      if (!isAccident) {
        if (
          courier.currentLatitude == null ||
          courier.currentLongitude == null ||
          !courier.lastLocationAt ||
          Date.now() - courier.lastLocationAt.getTime() > 120_000
        ) {
          res.status(409).json({
            error: "Aguarde uma posição GPS atual para recalcular as paradas restantes.",
          });
          return;
        }
        const remainingIds = activeRoute.deliveryIds.filter(
          (deliveryId) => deliveryId !== targetRow.delivery.id,
        );
        remainingRows = (await routeDeliveries(remainingIds)).filter((row) =>
          ["ACCEPTED", "IN_TRANSIT"].includes(row.delivery.status),
        );
        pickedUpIds = new Set(
          remainingRows
            .filter((row) => row.delivery.status === "IN_TRANSIT")
            .map((row) => row.delivery.id),
        );
        try {
          recalculated = remainingRows.length
            ? await optimizeRoute(remainingRows, {
                latitude: courier.currentLatitude,
                longitude: courier.currentLongitude,
              }, pickedUpIds)
            : {
                stops: [],
                routeGeometry: null,
                distanceMeters: null,
                durationSeconds: null,
              };
        } catch (error) {
          const routeError =
            error instanceof RoutePlanningError
              ? error
              : new RoutePlanningError("Não foi possível recalcular a rota restante.");
          res.status(routeError.status).json({ error: routeError.message });
          return;
        }
      }
    } else if (isAccident) {
      pendingDeliveryIds = [targetRow.delivery.id];
    }

    const now = new Date();
    const actor = getCourierDisplayName(courier.name, profile.email);
    const result = await db.transaction(async (tx) => {
      if (belongsToRoute && activeRoute) {
        const [lockedRoute] = await tx
          .select()
          .from(deliveryRoutesTable)
          .where(eq(deliveryRoutesTable.id, activeRoute.id))
          .for("update");
        if (
          !lockedRoute ||
          lockedRoute.status !== "ACCEPTED" ||
          lockedRoute.courierId !== courier.id ||
          lockedRoute.deliveryIds.join("|") !== activeRoute.deliveryIds.join("|")
        ) {
          return { error: "route_changed" as const };
        }
        const currentStops = await tx
          .select()
          .from(deliveryRouteStopsTable)
          .where(eq(deliveryRouteStopsTable.routeId, lockedRoute.id))
          .orderBy(asc(deliveryRouteStopsTable.sequence))
          .for("update");
        const currentPendingIds = currentStops
          .filter((stop) => stop.status === "PENDING")
          .map((stop) => stop.id);
        const originalPendingIds = routeStopsSnapshot
          .filter((stop) => stop.status === "PENDING")
          .map((stop) => stop.id);
        if (currentPendingIds.join("|") !== originalPendingIds.join("|")) {
          return { error: "route_changed" as const };
        }

        const pendingIds = [
          ...new Set(
            currentStops
              .filter((stop) => stop.status === "PENDING")
              .map((stop) => stop.deliveryId),
          ),
        ];
        const deliveries = await tx
          .select()
          .from(deliveriesTable)
          .where(inArray(deliveriesTable.id, pendingIds))
          .for("update");
        const activeDeliveries = deliveries.filter((delivery) =>
          ["ACCEPTED", "IN_TRANSIT"].includes(delivery.status),
        );
        if (!activeDeliveries.some((delivery) => delivery.id === targetRow.delivery.id)) {
          return { error: "delivery_changed" as const };
        }

        if (isAccident) {
          for (const delivery of activeDeliveries) {
            await tx
              .update(deliveriesTable)
              .set({
                status: "AWAITING_COURIER",
                courierId: null,
                updatedAt: now,
              })
              .where(eq(deliveriesTable.id, delivery.id));
            await tx.insert(deliveryCancellationsTable).values({
              id: randomUUID(),
              deliveryId: delivery.id,
              courierId: courier.id,
              routeId: lockedRoute.id,
              reason: reason.label,
              observation:
                delivery.id === targetRow.delivery.id
                  ? body.data.observation ?? null
                  : `Rota interrompida por pane/acidente reportada na entrega ${targetRow.delivery.code}.`,
              status: "ROUTE_ABORTED",
              priority: true,
              requestedAt: now,
            });
            await tx.insert(deliveryEventsTable).values({
              id: randomUUID(),
              deliveryId: delivery.id,
              kind: "courier_route_aborted",
              label: `Rota interrompida: ${reason.label}`,
              actor,
              timestamp: now,
            });
          }
          const minimumStopSequence = Math.min(
            0,
            ...currentStops.map((stop) => stop.sequence),
          );
          for (const [index, stop] of currentStops
            .filter((item) => item.status === "PENDING")
            .entries()) {
            await tx
              .update(deliveryRouteStopsTable)
              .set({
                status: "CANCELLED",
                sequence: minimumStopSequence - index - 1,
              })
              .where(eq(deliveryRouteStopsTable.id, stop.id));
          }
          await tx
            .update(deliveryRoutesTable)
            .set({ status: "CANCELLED" })
            .where(eq(deliveryRoutesTable.id, lockedRoute.id));
          await tx
            .update(couriersTable)
            .set({
              status: "OFFLINE",
              currentDeliveryCode: null,
            })
            .where(eq(couriersTable.id, courier.id));
          return {
            routeContinues: false,
            priority: true,
            status: "AWAITING_COURIER",
            affectedDeliveries: activeDeliveries.length,
          };
        }

        const [targetDelivery] = await tx
          .select()
          .from(deliveriesTable)
          .where(eq(deliveriesTable.id, targetRow.delivery.id))
          .for("update");
        if (
          !targetDelivery ||
          !["ACCEPTED", "IN_TRANSIT"].includes(targetDelivery.status)
        ) {
          return { error: "delivery_changed" as const };
        }
        // A entrega sai da lista do motoboy e volta para a loja decidir (reenviar ou cancelar).
        // Não existe mais a etapa "levar o produto de volta à filial" no app do motoboy.
        const wasPickedUp = targetDelivery.status === "IN_TRANSIT";
        await tx
          .update(deliveriesTable)
          .set({ status: "AWAITING_COURIER", courierId: null, updatedAt: now })
          .where(eq(deliveriesTable.id, targetDelivery.id));
        await tx.insert(deliveryCancellationsTable).values({
          id: randomUUID(),
          deliveryId: targetDelivery.id,
          courierId: courier.id,
          routeId: lockedRoute.id,
          reason: reason.label,
          observation: body.data.observation ?? null,
          status: "AWAITING_CENTRAL",
          priority: false,
          routeContinues: Boolean(recalculated?.stops.length),
          requestedAt: now,
        });
        await tx.insert(deliveryEventsTable).values({
          id: randomUUID(),
          deliveryId: targetDelivery.id,
          kind: "courier_unable_to_deliver",
          label: `Motoboy não conseguiu entregar${wasPickedUp ? " (o produto volta para a loja)" : ""}: ${reason.label}${body.data.observation ? ` (${body.data.observation})` : ""}`,
          actor,
          timestamp: now,
        });

        const minimumStopSequence = Math.min(
          0,
          ...currentStops.map((stop) => stop.sequence),
        );
        for (const [index, stop] of currentStops
          .filter((item) => item.status === "PENDING")
          .entries()) {
          await tx
            .update(deliveryRouteStopsTable)
            .set({
              status: "CANCELLED",
              sequence: minimumStopSequence - index - 1,
            })
            .where(eq(deliveryRouteStopsTable.id, stop.id));
        }
        if (recalculated?.stops.length) {
          await tx.insert(deliveryRouteStopsTable).values(
            recalculated.stops.map((stop, index) => ({
              id: randomUUID(),
              routeId: lockedRoute.id,
              deliveryId: stop.deliveryId,
              sequence:
                Math.max(
                  0,
                  ...currentStops
                    .filter((item) => item.status === "DONE")
                    .map((item) => item.sequence),
                ) +
                index +
                1,
              kind: stop.kind,
              address: stop.address,
              latitude: stop.latitude,
              longitude: stop.longitude,
              status: "PENDING",
            })),
          );
        }
        const nextCode = remainingRows[0]?.delivery.code;
        await tx
          .update(deliveryRoutesTable)
          .set({
            deliveryIds: lockedRoute.deliveryIds.filter(
              (deliveryId) => deliveryId !== targetDelivery.id,
            ),
            status: recalculated?.stops.length ? "ACCEPTED" : "COMPLETED",
            startLatitude: courier.currentLatitude,
            startLongitude: courier.currentLongitude,
            routeGeometry: recalculated?.routeGeometry ?? null,
            distanceMeters: recalculated?.distanceMeters ?? null,
            durationSeconds: recalculated?.durationSeconds ?? null,
          })
          .where(eq(deliveryRoutesTable.id, lockedRoute.id));
        await tx
          .update(couriersTable)
          .set(
            recalculated?.stops.length
              ? { status: "BUSY", currentDeliveryCode: nextCode ?? null }
              : { status: "AVAILABLE", currentDeliveryCode: null },
          )
          .where(eq(couriersTable.id, courier.id));
        return {
          routeContinues: Boolean(recalculated?.stops.length),
          priority: false,
          status: "AWAITING_COURIER",
          affectedDeliveries: 1,
        };
      }

      const [delivery] = await tx
        .select()
        .from(deliveriesTable)
        .where(eq(deliveriesTable.id, targetRow.delivery.id))
        .for("update");
      if (
        !delivery ||
        delivery.courierId !== courier.id ||
        !["ACCEPTED", "TO_STORE", "AT_STORE", "IN_TRANSIT"].includes(
          delivery.status,
        )
      ) {
        return { error: "delivery_changed" as const };
      }

      const routeAborted = isAccident;
      // Já tinha retirado: o produto volta para a loja, mas a entrega sai da lista do motoboy.
      const wasPickedUp = delivery.status === "IN_TRANSIT";
      const nextStatus = "AWAITING_COURIER";
      const cancellationStatus = routeAborted ? "ROUTE_ABORTED" : "AWAITING_CENTRAL";
      await tx
        .update(deliveriesTable)
        .set({
          status: nextStatus,
          courierId: null,
          updatedAt: now,
        })
        .where(eq(deliveriesTable.id, delivery.id));
      await tx.insert(deliveryCancellationsTable).values({
        id: randomUUID(),
        deliveryId: delivery.id,
        courierId: courier.id,
        routeId: null,
        reason: reason.label,
        observation: body.data.observation ?? null,
        status: cancellationStatus,
        priority: routeAborted,
        requestedAt: now,
      });
      await tx.insert(deliveryEventsTable).values({
        id: randomUUID(),
        deliveryId: delivery.id,
        kind: routeAborted ? "courier_route_aborted" : "courier_unable_to_deliver",
        label: `${routeAborted ? "Pane/acidente" : `Motoboy não conseguiu entregar${wasPickedUp ? " (o produto volta para a loja)" : ""}`}: ${reason.label}${body.data.observation ? ` (${body.data.observation})` : ""}`,
        actor,
        timestamp: now,
      });
      const [otherActive] = routeAborted
        ? []
        : await tx
            .select({ code: deliveriesTable.code })
            .from(deliveriesTable)
            .where(
              and(
                eq(deliveriesTable.courierId, courier.id),
                inArray(deliveriesTable.status, ["ACCEPTED", "TO_STORE", "AT_STORE", "IN_TRANSIT"]),
                sql`${deliveriesTable.id} <> ${delivery.id}`,
              ),
            )
            .limit(1);
      await tx
        .update(couriersTable)
        .set({
          status: routeAborted ? "OFFLINE" : otherActive ? "BUSY" : "AVAILABLE",
          currentDeliveryCode: otherActive?.code ?? null,
        })
        .where(eq(couriersTable.id, courier.id));
      return {
        routeContinues: false,
        priority: routeAborted,
        status: nextStatus,
        affectedDeliveries: 1,
      };
    });

    if ("error" in result) {
      res.status(409).json({
        error:
          result.error === "route_changed"
            ? "A rota mudou enquanto era recalculada. Atualize e tente novamente."
            : "O status da entrega mudou. Atualize a tela e tente novamente.",
      });
      return;
    }

    await notifyCentralUsers({
      title: result.priority
        ? "URGENTE: rota interrompida"
        : "Ocorrência de entrega",
      body: `${getCourierDisplayName(courier.name, profile.email)} · pedido ${targetRow.delivery.code} · ${targetRow.delivery.customerName} · ${reason.label}${result.routeContinues ? " — rota continua com os pedidos restantes." : ""}`,
      url: "/",
    });
    res.json(
      CreateCourierDeliveryCancellationResponse.parse({
        deliveryId: targetRow.delivery.id,
        status: result.status,
        routeContinues: result.routeContinues,
        priority: result.priority,
        affectedDeliveries: result.affectedDeliveries,
      }),
    );
  },
);

router.post(
  "/courier/routes/:routeId/accept",
  requireRole("COURIER"),
  async (req, res): Promise<void> => {
    const params = AcceptCourierRouteParams.safeParse(req.params);
    const body = AcceptCourierRouteBody.safeParse(req.body);
    if (!params.success || !body.success) {
      res.status(400).json({ error: "Informe uma localização válida para aceitar a rota." });
      return;
    }

    const profile = res.locals.appUser as AppUserProfile;
    if (!profile.courierId) {
      res.status(403).json({ error: "Esta conta não está vinculada a um motoboy." });
      return;
    }
    const [declined] = await db
      .select({ id: courierRouteOfferDeclinesTable.id })
      .from(courierRouteOfferDeclinesTable)
      .where(
        and(
          eq(courierRouteOfferDeclinesTable.routeId, params.data.routeId),
          eq(courierRouteOfferDeclinesTable.courierId, profile.courierId),
        ),
      )
      .limit(1);
    if (declined) {
      res.status(409).json({ error: "Você já recusou esta oferta." });
      return;
    }
    const [route] = await db
      .select()
      .from(deliveryRoutesTable)
      .where(eq(deliveryRoutesTable.id, params.data.routeId))
      .limit(1);
    if (!route || route.status !== "OFFERED" || (route.courierId && route.courierId !== profile.courierId)) {
      res.status(409).json({ error: "Esta rota não está mais disponível." });
      return;
    }

    const rows = await routeDeliveries(route.deliveryIds);
    if (rows.length !== route.deliveryIds.length) {
      res.status(409).json({ error: "Uma entrega da rota não está mais disponível." });
      return;
    }
    if (!route.courierId) {
      const city = await courierCity(profile.courierId);
      if (rows.some((row) => !sameCity(city, row.storeCity))) {
        res.status(403).json({ error: "Esta rota é de uma filial de outra cidade." });
        return;
      }
    }

    // Checa antes de consultar o Google Maps: evita gastar uma otimização (e mostrar erro de mapa)
    // quando o motoboy já está ocupado. A transação abaixo confere de novo, com lock.
    const [currentCourier] = await db
      .select({ status: couriersTable.status })
      .from(couriersTable)
      .where(eq(couriersTable.id, profile.courierId))
      .limit(1);
    if (!currentCourier || currentCourier.status !== "AVAILABLE") {
      res.status(409).json({ error: "Você já está em uma rota ativa." });
      return;
    }

    let plan: Awaited<ReturnType<typeof optimizeRoute>>;
    try {
      plan = await optimizeRoute(rows, body.data);
    } catch (error) {
      if (error instanceof RoutePlanningError) {
        res.status(error.status).json({ error: error.message });
        return;
      }
      throw error;
    }

    const accepted = await db.transaction(async (tx) => {
      const [lockedRoute] = await tx
        .select()
        .from(deliveryRoutesTable)
        .where(eq(deliveryRoutesTable.id, route.id))
        .for("update");
      if (!lockedRoute || lockedRoute.status !== "OFFERED" || (lockedRoute.courierId && lockedRoute.courierId !== profile.courierId)) {
        return { error: "route_taken" as const };
      }
      const [courier] = await tx
        .select()
        .from(couriersTable)
        .where(eq(couriersTable.id, profile.courierId!))
        .for("update");
      if (!courier || courier.status !== "AVAILABLE") {
        return { error: "courier_busy" as const };
      }

      const deliveryRows = [];
      for (const deliveryId of [...lockedRoute.deliveryIds].sort()) {
        const [delivery] = await tx
          .select()
          .from(deliveriesTable)
          .where(eq(deliveriesTable.id, deliveryId))
          .for("update");
        if (!delivery || delivery.status !== "OFFERED") {
          return { error: "delivery_changed" as const };
        }
        deliveryRows.push(delivery);
      }

      const now = new Date();
      await tx
        .update(deliveryRoutesTable)
        .set({
          status: "ACCEPTED",
          courierId: courier.id,
          startLatitude: body.data.latitude,
          startLongitude: body.data.longitude,
          routeGeometry: plan.routeGeometry,
          distanceMeters: plan.distanceMeters,
          durationSeconds: plan.durationSeconds,
          lockedAt: now,
        })
        .where(eq(deliveryRoutesTable.id, lockedRoute.id));
      await tx.insert(deliveryRouteStopsTable).values(
        plan.stops.map((stop, index) => ({
          id: randomUUID(),
          routeId: lockedRoute.id,
          deliveryId: stop.deliveryId,
          sequence: index + 1,
          kind: stop.kind,
          address: stop.address,
          latitude: stop.latitude,
          longitude: stop.longitude,
        })),
      );
      for (const delivery of deliveryRows) {
        await tx
          .update(deliveriesTable)
          .set({
            status: "ACCEPTED",
            courierId: courier.id,
            updatedAt: now,
          })
          .where(eq(deliveriesTable.id, delivery.id));
        await tx.insert(deliveryEventsTable).values({
          id: randomUUID(),
          deliveryId: delivery.id,
          kind: "accepted",
          label: "Rota otimizada e aceita pelo motoboy",
          actor: "Motoboy",
        });
      }
      await tx
        .update(couriersTable)
        .set({
          status: "BUSY",
          currentDeliveryCode: deliveryRows[0]?.code ?? null,
          currentLatitude: body.data.latitude,
          currentLongitude: body.data.longitude,
          lastLocationAt: now,
        })
        .where(eq(couriersTable.id, courier.id));
      return { routeId: lockedRoute.id };
    });

    if ("error" in accepted) {
      const message =
        accepted.error === "route_taken"
          ? "Outro motoboy aceitou esta rota primeiro."
          : accepted.error === "courier_busy"
            ? "Você já está em uma rota ativa."
            : "Uma das entregas foi alterada. Atualize as ofertas e tente novamente.";
      res.status(409).json({ error: message });
      return;
    }

    const [updatedRoute] = await db
      .select()
      .from(deliveryRoutesTable)
      .where(eq(deliveryRoutesTable.id, accepted.routeId))
      .limit(1);
    if (!updatedRoute) {
      res.status(500).json({ error: "A rota foi aceita, mas não pôde ser carregada." });
      return;
    }
    res.json(AcceptCourierRouteResponse.parse(await courierRouteView(updatedRoute)));
  },
);

router.post(
  "/courier/routes/:routeId/stops/:stopId/arrive",
  requireRole("COURIER"),
  async (req, res): Promise<void> => {
    const params = RecordCourierStopArrivalParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: params.error.message });
      return;
    }
    const profile = res.locals.appUser as AppUserProfile;
    if (!profile.courierId) {
      res.status(403).json({ error: "Esta conta não está vinculada a um motoboy." });
      return;
    }
    const result = await db.transaction(async (tx) => {
      const [route] = await tx
        .select()
        .from(deliveryRoutesTable)
        .where(eq(deliveryRoutesTable.id, params.data.routeId))
        .for("update");
      if (
        !route ||
        route.status !== "ACCEPTED" ||
        route.courierId !== profile.courierId
      ) {
        return { error: "route_not_owned" as const };
      }
      const stops = await tx
        .select()
        .from(deliveryRouteStopsTable)
        .where(eq(deliveryRouteStopsTable.routeId, route.id))
        .orderBy(asc(deliveryRouteStopsTable.sequence))
        .for("update");
      const nextStop = stops.find((stop) => stop.status === "PENDING");
      if (!nextStop || nextStop.id !== params.data.stopId || nextStop.kind !== "pickup") {
        return { error: "wrong_stop" as const };
      }
      // Uma chegada vale para todos os pedidos retirados em seguida na mesma loja.
      for (const pickup of samePlacePickupGroup(stops, nextStop)) {
        const [arrival] = await tx
          .select({ id: deliveryEventsTable.id })
          .from(deliveryEventsTable)
          .where(
            and(
              eq(deliveryEventsTable.deliveryId, pickup.deliveryId),
              eq(deliveryEventsTable.kind, "store_arrived"),
            ),
          )
          .limit(1);
        if (!arrival) {
          await tx.insert(deliveryEventsTable).values({
            id: randomUUID(),
            deliveryId: pickup.deliveryId,
            kind: "store_arrived",
            label: "Motoboy chegou à loja",
            actor: "Motoboy",
          });
        }
      }
      return { routeId: route.id };
    });
    if ("error" in result) {
      res.status(result.error === "route_not_owned" ? 403 : 409).json({
        error:
          result.error === "route_not_owned"
            ? "Esta rota não pertence à sua conta ou já foi encerrada."
            : "Registre a chegada somente na próxima parada de loja da rota.",
      });
      return;
    }
    const [route] = await db
      .select()
      .from(deliveryRoutesTable)
      .where(eq(deliveryRoutesTable.id, result.routeId))
      .limit(1);
    if (!route) {
      res.status(404).json({ error: "Rota não encontrada." });
      return;
    }
    res.json(RecordCourierStopArrivalResponse.parse(await courierRouteView(route)));
  },
);

router.post(
  "/courier/routes/:routeId/stops/:stopId/complete",
  requireRole("COURIER"),
  async (req, res): Promise<void> => {
    const params = CompleteCourierRouteStopParams.safeParse(req.params);
    const body = CompleteCourierRouteStopBody.safeParse(req.body ?? {});
    if (!params.success || !body.success) {
      res.status(400).json({ error: "Parada inválida." });
      return;
    }
    const profile = res.locals.appUser as AppUserProfile;
    if (!profile.courierId) {
      res.status(403).json({ error: "Esta conta não está vinculada a um motoboy." });
      return;
    }

    const [targetStop] = await db
      .select()
      .from(deliveryRouteStopsTable)
      .where(
        and(
          eq(deliveryRouteStopsTable.routeId, params.data.routeId),
          eq(deliveryRouteStopsTable.id, params.data.stopId),
        ),
      )
      .limit(1);
    if (targetStop?.kind === "delivery") {
      if (
        !body.data.evidencePath ||
        !(await verifyEvidenceUpload(
          targetStop.deliveryId,
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
      const [route] = await tx
        .select()
        .from(deliveryRoutesTable)
        .where(eq(deliveryRoutesTable.id, params.data.routeId))
        .for("update");
      if (
        !route ||
        route.status !== "ACCEPTED" ||
        route.courierId !== profile.courierId
      ) {
        return { error: "route_not_owned" as const };
      }
      const stops = await tx
        .select()
        .from(deliveryRouteStopsTable)
        .where(eq(deliveryRouteStopsTable.routeId, route.id))
        .orderBy(asc(deliveryRouteStopsTable.sequence))
        .for("update");
      const nextStop = stops.find((stop) => stop.status === "PENDING");
      if (!nextStop || nextStop.id !== params.data.stopId) {
        return { error: "wrong_stop_order" as const };
      }

      // Retiradas seguidas na mesma loja são confirmadas juntas (uma única parada para o motoboy).
      const targets = nextStop.kind === "pickup" ? samePlacePickupGroup(stops, nextStop) : [nextStop];
      const nextDeliveryStatus =
        nextStop.kind === "pickup" ? "IN_TRANSIT" : "COMPLETED";
      const expectedStatus =
        nextStop.kind === "pickup" ? "ACCEPTED" : "IN_TRANSIT";
      const targetDeliveries = [];
      for (const target of targets) {
        const [delivery] = await tx
          .select()
          .from(deliveriesTable)
          .where(eq(deliveriesTable.id, target.deliveryId))
          .for("update");
        if (!delivery || delivery.courierId !== profile.courierId) {
          return { error: "delivery_not_owned" as const };
        }
        if (delivery.status !== expectedStatus) {
          return { error: "delivery_status_changed" as const };
        }
        if (target.kind === "pickup") {
          const [arrival] = await tx
            .select({ id: deliveryEventsTable.id })
            .from(deliveryEventsTable)
            .where(
              and(
                eq(deliveryEventsTable.deliveryId, delivery.id),
                eq(deliveryEventsTable.kind, "store_arrived"),
              ),
            )
            .limit(1);
          // Chegada e retirada viraram um passo só: sem "cheguei" antes, a retirada registra as duas.
          if (!arrival) {
            await tx.insert(deliveryEventsTable).values({
              id: randomUUID(),
              deliveryId: delivery.id,
              kind: "store_arrived",
              label: "Chegada à loja",
              actor: "Motoboy",
            });
          }
        } else if (!body.data.evidencePath) {
          return { error: "evidence_missing" as const };
        } else if (delivery.requiresPrescription && !body.data.prescriptionCollected) {
          return { error: "prescription_required" as const };
        }
        targetDeliveries.push({ stop: target, delivery });
      }

      const now = new Date();
      for (const { stop, delivery } of targetDeliveries) {
        await tx
          .update(deliveryRouteStopsTable)
          .set({ status: "DONE", completedAt: now })
          .where(eq(deliveryRouteStopsTable.id, stop.id));
        await tx
          .update(deliveriesTable)
          .set({
            status: nextDeliveryStatus,
            ...(stop.kind === "delivery" && body.data.evidencePath
              ? { evidencePath: body.data.evidencePath }
              : {}),
            ...(stop.kind === "delivery" && delivery.requiresPrescription
              ? { prescriptionCollectedAt: now }
              : {}),
            updatedAt: now,
          })
          .where(eq(deliveriesTable.id, delivery.id));
        if (stop.kind === "delivery" && body.data.evidencePath) {
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
                  profile.courierId!,
                ),
              ),
            );
        }
        await tx.insert(deliveryEventsTable).values({
          id: randomUUID(),
          deliveryId: delivery.id,
          kind: nextDeliveryStatus.toLowerCase(),
          label:
            stop.kind === "pickup"
              ? "Saída da loja confirmada na rota"
              : "Entrega concluída com foto de comprovação",
          actor: "Motoboy",
          timestamp: now,
        });
      }

      const targetIds = new Set(targets.map((target) => target.id));
      const routeComplete = stops.every(
        (stop) => targetIds.has(stop.id) || stop.status === "DONE",
      );
      if (routeComplete) {
        await tx
          .update(deliveryRoutesTable)
          .set({ status: "COMPLETED" })
          .where(eq(deliveryRoutesTable.id, route.id));
        const returnDeliveries = await tx
          .select({ id: deliveriesTable.id })
          .from(deliveriesTable)
          .where(
            and(
              eq(deliveriesTable.courierId, profile.courierId!),
              eq(deliveriesTable.status, "RETURNING_TO_STORE"),
            ),
          );
        const hasReturnToStore = returnDeliveries.length > 0;
        await tx
          .update(couriersTable)
          .set({
            status: hasReturnToStore ? "BUSY" : "AVAILABLE",
            currentDeliveryCode: hasReturnToStore ? "Devolução na filial" : null,
            ...(hasReturnToStore
              ? {}
              : { currentLatitude: null, currentLongitude: null }),
          })
          .where(eq(couriersTable.id, profile.courierId!));
      }
      return { routeId: route.id };
    });

    if ("error" in result) {
      const status = result.error === "route_not_owned" ? 403 : 409;
      const message =
        result.error === "route_not_owned"
          ? "Esta rota não pertence à sua conta ou já foi encerrada."
          : result.error === "wrong_stop_order"
            ? "Siga a sequência travada da rota e conclua a próxima parada."
              : result.error === "evidence_missing"
                ? "Envie a foto de comprovação antes de concluir a entrega."
              : result.error === "prescription_required"
                ? "Esta entrega tem receita: confirme que recolheu a receita do cliente antes de concluir."
            : result.error === "delivery_not_owned"
              ? "A entrega não está vinculada a esta rota."
              : "O status da entrega mudou. Atualize a rota antes de continuar.";
      res.status(status).json({ error: message });
      return;
    }

    const [updatedRoute] = await db
      .select()
      .from(deliveryRoutesTable)
      .where(eq(deliveryRoutesTable.id, result.routeId))
      .limit(1);
    if (!updatedRoute) {
      res.status(500).json({ error: "Não foi possível atualizar a rota." });
      return;
    }
    res.json(
      CompleteCourierRouteStopResponse.parse(await courierRouteView(updatedRoute)),
    );
  },
);

/** Ordem sugerida guardada por motoboy (só recalcula quando as entregas, etapas ou a posição mudam). */
const courierPlanCache = new Map<string, { key: string; plan: Awaited<ReturnType<typeof optimizeRoute>> }>();

/** Ordem sugerida das entregas avulsas de um motoboy (usada pelo app e pelo mapa do painel). */
async function computeCourierPlan(courierId: string) {
    const [courier] = await db.select().from(couriersTable).where(eq(couriersTable.id, courierId)).limit(1);
    const active = await db
      .select({ id: deliveriesTable.id })
      .from(deliveriesTable)
      .where(
        and(
          eq(deliveriesTable.courierId, courierId),
          inArray(deliveriesTable.status, ["ACCEPTED", "TO_STORE", "AT_STORE", "IN_TRANSIT"]),
          notInActiveRoute,
        ),
      );
    if (active.length < 2 || !courier) return null;
    const rows = await routeDeliveries(active.map((row) => row.id));
    const pickedUp = new Set(rows.filter((row) => row.delivery.status === "IN_TRANSIT").map((row) => row.delivery.id));
    const start =
      storedCoordinate(courier.currentLatitude, courier.currentLongitude) ??
      storedCoordinate(rows[0]?.storeLatitude, rows[0]?.storeLongitude);
    if (!start) return null;
    const grid = (value: number) => (Math.round(value * 700) / 700).toFixed(4);
    const key = [
      ...rows.map((row) => `${row.delivery.id}:${pickedUp.has(row.delivery.id) ? "r" : "a"}`).sort(),
      `${grid(start.latitude)},${grid(start.longitude)}`,
    ].join("|");
    let plan = courierPlanCache.get(courierId)?.key === key ? courierPlanCache.get(courierId)!.plan : null;
    if (!plan) {
      try {
        plan = await optimizeRoute(rows, start, pickedUp);
      } catch {
        // Sem a otimização do Google: retiradas pendentes primeiro, depois as entregas.
        const stops: Array<{ deliveryId: string; kind: "pickup" | "delivery"; address: string; latitude: number; longitude: number }> = [];
        for (const row of rows) {
          const store = storedCoordinate(row.storeLatitude, row.storeLongitude);
          if (!pickedUp.has(row.delivery.id) && store) {
            stops.push({ deliveryId: row.delivery.id, kind: "pickup", address: `${row.storeAddress}, ${row.storeCity}`, ...store });
          }
        }
        for (const row of rows) {
          const customer = storedCoordinate(row.delivery.customerLatitude, row.delivery.customerLongitude);
          if (customer) stops.push({ deliveryId: row.delivery.id, kind: "delivery", address: row.delivery.destination, ...customer });
        }
        let geometry: Coordinate[] | null = null;
        let distanceMeters: number | null = null;
        let durationSeconds: number | null = null;
        try {
          const directions = await computeDrivingRoute([start, ...stops.map(({ latitude, longitude }) => ({ latitude, longitude }))]);
          geometry = directions.geometry.length >= 2 ? directions.geometry : null;
          distanceMeters = directions.distanceMeters !== null ? Math.round(directions.distanceMeters) : null;
          durationSeconds = directions.durationSeconds !== null ? Math.round(directions.durationSeconds) : null;
        } catch {
          // Sem traçado: o mapa mostra só os pontos na ordem.
        }
        plan = { stops, routeGeometry: geometry, distanceMeters, durationSeconds };
      }
      courierPlanCache.set(courierId, { key, plan });
    }
    return { rows, plan };
}

router.get(
  "/courier/plan",
  requireRole("COURIER"),
  async (_req, res): Promise<void> => {
    const profile = res.locals.appUser as AppUserProfile;
    if (!profile.courierId) {
      res.json(GetCourierPlanResponse.parse({ plan: null }));
      return;
    }
    const computed = await computeCourierPlan(profile.courierId);
    if (!computed) {
      res.json(GetCourierPlanResponse.parse({ plan: null }));
      return;
    }
    const { rows, plan } = computed;
    const rowById = new Map(rows.map((row) => [row.delivery.id, row]));
    res.json(
      GetCourierPlanResponse.parse({
        plan: {
          id: `plano-${profile.courierId}`,
          status: "ACCEPTED",
          courierId: profile.courierId,
          deliveryCount: rows.length,
          amountToReceive: 0,
          distanceKm: plan.distanceMeters == null ? null : Number((plan.distanceMeters / 1000).toFixed(1)),
          estimatedMinutes: plan.durationSeconds == null ? null : Math.ceil(plan.durationSeconds / 60),
          lockedAt: null,
          deliveries: rows.map((row) => ({
            id: row.delivery.id,
            code: row.delivery.code,
            customerName: row.delivery.customerName,
            customerPhone: row.delivery.customerPhone,
            requiresPrescription: row.delivery.requiresPrescription,
            paymentMethod: row.delivery.paymentMethod,
            changeFor: row.delivery.changeForCents == null ? null : row.delivery.changeForCents / 100,
            bringCardMachine: row.delivery.bringCardMachine,
            destination: row.delivery.destination,
            notes: row.delivery.notes,
            storeName: row.storeName,
            storeAddress: row.storeAddress,
            storeCity: row.storeCity,
            storeLatitude: row.storeLatitude,
            storeLongitude: row.storeLongitude,
            customerLatitude: row.delivery.customerLatitude,
            customerLongitude: row.delivery.customerLongitude,
            deliveryAmount: 0,
            status: row.delivery.status,
          })),
          stops: plan.stops.map((stop, index) => {
            const row = rowById.get(stop.deliveryId)!;
            return {
              id: `plano-${stop.deliveryId}-${stop.kind}`,
              sequence: index + 1,
              deliveryId: stop.deliveryId,
              kind: stop.kind,
              address: stop.address,
              latitude: stop.latitude,
              longitude: stop.longitude,
              status: "PENDING",
              code: row.delivery.code,
              customerName: row.delivery.customerName,
              storeName: row.storeName,
              deliveryAmount: 0,
            };
          }),
          routeGeometry: plan.routeGeometry,
        },
      }),
    );
  },
);

export default router;
