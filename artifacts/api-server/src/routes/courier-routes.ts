import { randomUUID } from "node:crypto";
import { and, asc, eq, inArray, or } from "drizzle-orm";
import { Router, type IRouter } from "express";
import {
  AcceptCourierRouteBody,
  AcceptCourierRouteParams,
  AcceptCourierRouteResponse,
  CompleteCourierRouteStopParams,
  CompleteCourierRouteStopResponse,
  CreateDeliveryRouteBody,
  CreateDeliveryRouteResponse,
  GetCourierDeliveryNavigationParams,
  GetCourierDeliveryNavigationResponse,
  ListCourierRoutesResponse,
  UpdateCourierLocationBody,
  UpdateCourierLocationResponse,
  type CourierDeliveryRoute,
} from "@workspace/api-zod";
import {
  couriersTable,
  db,
  deliveriesTable,
  deliveryEventsTable,
  deliveryRouteStopsTable,
  deliveryRoutesTable,
  storesTable,
} from "@workspace/db";
import {
  requireAuthentication,
  requireRole,
  type AppUserProfile,
} from "../middlewares/accessControl";
import {
  MapboxApiError,
  mapboxDirections,
  mapboxGeocodeAddress,
  mapboxOptimizeShipments,
  type MapboxOptimizationSolution,
} from "../lib/mapbox";

const router: IRouter = Router();
router.use(requireAuthentication);

type DeliveryRow = {
  delivery: typeof deliveriesTable.$inferSelect;
  storeName: string;
  storeAddress: string;
  storeCity: string;
  storeLatitude: number | null;
  storeLongitude: number | null;
};

type Coordinate = { latitude: number; longitude: number };

function extractRouteGeometry(coordinates: unknown): Coordinate[] | null {
  const points: Coordinate[] = [];
  const visit = (value: unknown) => {
    if (!Array.isArray(value)) return;
    if (
      value.length >= 2 &&
      typeof value[0] === "number" &&
      typeof value[1] === "number"
    ) {
      const [longitude, latitude] = value;
      if (
        Number.isFinite(latitude) &&
        Number.isFinite(longitude) &&
        latitude >= -90 &&
        latitude <= 90 &&
        longitude >= -180 &&
        longitude <= 180
      ) {
        points.push({ latitude, longitude });
      }
      return;
    }
    for (const nested of value) visit(nested);
  };
  visit(coordinates);
  return points.length >= 2 ? points : null;
}

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

async function routeView(
  route: typeof deliveryRoutesTable.$inferSelect,
): Promise<CourierDeliveryRoute> {
  const [deliveryRows, stopRows] = await Promise.all([
    routeDeliveries(route.deliveryIds),
    route.status === "OFFERED"
      ? Promise.resolve([])
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
      destination: delivery.destination,
      storeName: row.storeName,
      deliveryAmount: deliveryAmountCents / 100,
      status: delivery.status,
    }];
  });

  const stops = stopRows.map(({ stop, delivery, storeName }) => ({
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
    return await mapboxGeocodeAddress(
      `${address}, ${city}, Minas Gerais, Brasil`,
    );
  } catch (error) {
    if (error instanceof MapboxApiError) {
      throw new RoutePlanningError(error.message, error.status);
    }
    throw error;
  }
}

async function optimizeRoute(
  rows: DeliveryRow[],
  start: Coordinate,
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
    const [pickup, customer] = await Promise.all([
      storedCoordinate(row.storeLatitude, row.storeLongitude) ??
        getGeocode(row.storeAddress, row.storeCity),
      storedCoordinate(
        row.delivery.customerLatitude,
        row.delivery.customerLongitude,
      ) ?? getGeocode(row.delivery.destination, row.storeCity),
    ]);
    pickupByDelivery.set(row.delivery.id, pickup);
    customerByDelivery.set(row.delivery.id, customer);
  }));

  const locations = new Map<string, { name: string; coordinates: [number, number] }>();
  const addLocation = (name: string, coordinate: Coordinate) => {
    if (!locations.has(name)) {
      locations.set(name, {
        name,
        coordinates: [coordinate.longitude, coordinate.latitude],
      });
    }
  };
  addLocation("courier-start", start);

  const pickupLocationByDelivery = new Map<string, string>();
  const dropoffLocationByDelivery = new Map<string, string>();
  const pickupLocationByStore = new Map<string, string>();
  for (const row of rows) {
    const pickupLocation =
      pickupLocationByStore.get(row.delivery.storeId) ??
      `store-${row.delivery.storeId}`;
    pickupLocationByStore.set(row.delivery.storeId, pickupLocation);
    pickupLocationByDelivery.set(row.delivery.id, pickupLocation);
    dropoffLocationByDelivery.set(row.delivery.id, `dropoff-${row.delivery.id}`);
    addLocation(pickupLocation, pickupByDelivery.get(row.delivery.id)!);
    addLocation(
      `dropoff-${row.delivery.id}`,
      customerByDelivery.get(row.delivery.id)!,
    );
  }

  let solution: MapboxOptimizationSolution;
  try {
    solution = await mapboxOptimizeShipments({
      locations: [...locations.values()],
      shipments: rows.map((row) => ({
        name: row.delivery.id,
        from: pickupLocationByDelivery.get(row.delivery.id)!,
        to: dropoffLocationByDelivery.get(row.delivery.id)!,
        pickup_duration: 120,
        dropoff_duration: 90,
      })),
    });
  } catch (error) {
    if (error instanceof MapboxApiError) {
      throw new RoutePlanningError(error.message, error.status);
    }
    throw error;
  }
  if (solution.dropped?.shipments?.length) {
    throw new RoutePlanningError(
      "O Mapbox não conseguiu incluir todas as entregas. Confira os endereços e tente novamente.",
      422,
    );
  }

  const optimizedRoute =
    solution.routes?.find((route) => route.vehicle === "courier") ??
    solution.routes?.[0];
  if (!optimizedRoute) {
    throw new RoutePlanningError(
      "O Mapbox não retornou uma rota para estas entregas.",
      502,
    );
  }

  const rowByDelivery = new Map(rows.map((row) => [row.delivery.id, row]));
  const stops: Array<{
    deliveryId: string;
    kind: "pickup" | "delivery";
    address: string;
    latitude: number;
    longitude: number;
  }> = [];
  for (const optimizedStop of optimizedRoute.stops ?? []) {
    const isPickup = optimizedStop.type === "pickup";
    const isDropoff = optimizedStop.type === "dropoff";
    if (!isPickup && !isDropoff) continue;
    const shipmentIds = (isPickup
      ? optimizedStop.pickups
      : optimizedStop.dropoffs) as unknown;
    if (!Array.isArray(shipmentIds)) continue;

    for (const shipmentId of shipmentIds) {
      if (typeof shipmentId !== "string") continue;
      const row = rowByDelivery.get(shipmentId);
      if (!row) continue;
      const coordinate = isPickup
        ? pickupByDelivery.get(shipmentId)
        : customerByDelivery.get(shipmentId);
      if (!coordinate) continue;
      stops.push({
        deliveryId: shipmentId,
        kind: isPickup ? "pickup" : "delivery",
        address: isPickup
          ? `${row.storeAddress}, ${row.storeCity}`
          : row.delivery.destination,
        latitude: coordinate.latitude,
        longitude: coordinate.longitude,
      });
    }
  }

  if (stops.length !== rows.length * 2) {
    throw new RoutePlanningError(
      "A rota calculada não incluiu todas as retiradas e entregas. A oferta continua disponível.",
      502,
    );
  }
  const directionCoordinates: Coordinate[] = [
    start,
    ...stops.map(({ latitude, longitude }) => ({ latitude, longitude })),
  ];
  const endingStop = optimizedRoute.stops?.find(
    (stop) => stop.type === "end" || stop.type === "arrive",
  );
  const endingLocation = endingStop?.location
    ? locations.get(endingStop.location)?.coordinates
    : undefined;
  if (endingLocation) {
    directionCoordinates.push({
      longitude: endingLocation[0],
      latitude: endingLocation[1],
    });
  }

  let directions;
  try {
    directions = await mapboxDirections(directionCoordinates);
  } catch (error) {
    if (error instanceof MapboxApiError) {
      throw new RoutePlanningError(error.message, error.status);
    }
    throw error;
  }
  const routeGeometry = extractRouteGeometry(directions.geometry?.coordinates);
  if (!routeGeometry) {
    throw new RoutePlanningError(
      "O Mapbox não retornou o traçado viário desta rota.",
      502,
    );
  }
  return {
    stops,
    routeGeometry,
    distanceMeters:
      typeof directions.distance === "number"
        ? Math.round(directions.distance)
        : null,
    durationSeconds:
      typeof directions.duration === "number"
        ? Math.round(directions.duration + rows.length * 210)
        : null,
  };
}

router.post(
  "/delivery-routes",
  requireRole("ADMIN", "CENTRAL"),
  async (req, res): Promise<void> => {
    const body = CreateDeliveryRouteBody.safeParse(req.body);
    if (!body.success || new Set(body.data.deliveryIds).size !== body.data.deliveryIds.length) {
      res.status(400).json({ error: "Selecione de 2 a 10 entregas diferentes." });
      return;
    }

    const profile = res.locals.appUser as AppUserProfile;
    const deliveryIds = body.data.deliveryIds;
    const result = await db.transaction(async (tx) => {
      const rows = [];
      for (const deliveryId of [...deliveryIds].sort()) {
        const [delivery] = await tx
          .select()
          .from(deliveriesTable)
          .where(eq(deliveriesTable.id, deliveryId))
          .for("update");
        if (!delivery) return { error: "not_found" as const };
        if (delivery.status !== "REQUESTED") {
          return { error: "not_requested" as const };
        }
        rows.push(delivery);
      }

      const routeId = randomUUID();
      await tx.insert(deliveryRoutesTable).values({
        id: routeId,
        deliveryIds,
        status: "OFFERED",
        createdBy: profile.id,
      });
      for (const delivery of rows) {
        await tx
          .update(deliveriesTable)
          .set({ status: "OFFERED", updatedAt: new Date() })
          .where(eq(deliveriesTable.id, delivery.id));
        await tx.insert(deliveryEventsTable).values({
          id: randomUUID(),
          deliveryId: delivery.id,
          kind: "offered",
          label: "Entrega incluída em uma oferta de rota agrupada",
          actor: "Central de entregas",
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
    res.status(201).json(CreateDeliveryRouteResponse.parse(await routeView(route)));
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

    const routes = await db
      .select()
      .from(deliveryRoutesTable)
      .where(
        or(
          eq(deliveryRoutesTable.status, "OFFERED"),
          and(
            eq(deliveryRoutesTable.courierId, profile.courierId),
            eq(deliveryRoutesTable.status, "ACCEPTED"),
          ),
        ),
      )
      .orderBy(asc(deliveryRoutesTable.createdAt));
    const result = await Promise.all(routes.map(routeView));
    res.json(ListCourierRoutesResponse.parse(result));
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
    if (!["ACCEPTED", "TO_STORE", "AT_STORE", "IN_TRANSIT"].includes(row.delivery.status)) {
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

    const targetsStore = ["ACCEPTED", "TO_STORE"].includes(row.delivery.status);
    const targetAddress = targetsStore
      ? `${row.storeAddress}, ${row.storeCity}`
      : row.delivery.destination;
    const targetLabel = targetsStore ? "Unidade de retirada" : "Entrega ao cliente";

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
      const directions = await mapboxDirections([
        {
          latitude: courier.currentLatitude,
          longitude: courier.currentLongitude,
        },
        targetPosition,
      ]);
      const routeGeometry = extractRouteGeometry(directions.geometry?.coordinates);
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
            typeof directions.distance === "number"
              ? Math.round(directions.distance)
              : null,
          durationSeconds:
            typeof directions.duration === "number"
              ? Math.round(directions.duration)
              : null,
          routeGeometry,
          lastLocationAt: courier.lastLocationAt.toISOString(),
        }),
      );
    } catch (error) {
      const routeError =
        error instanceof RoutePlanningError
          ? error
          : error instanceof MapboxApiError
            ? new RoutePlanningError(error.message, error.status)
          : new RoutePlanningError("Não foi possível calcular a rota agora.", 502);
      res.status(routeError.status).json({ error: routeError.message });
    }
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
    const [route] = await db
      .select()
      .from(deliveryRoutesTable)
      .where(eq(deliveryRoutesTable.id, params.data.routeId))
      .limit(1);
    if (!route || route.status !== "OFFERED") {
      res.status(409).json({ error: "Esta rota não está mais disponível." });
      return;
    }

    const rows = await routeDeliveries(route.deliveryIds);
    if (rows.length !== route.deliveryIds.length) {
      res.status(409).json({ error: "Uma entrega da rota não está mais disponível." });
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
      if (!lockedRoute || lockedRoute.status !== "OFFERED") {
        return { error: "route_taken" as const };
      }
      const [courier] = await tx
        .select()
        .from(couriersTable)
        .where(eq(couriersTable.id, profile.courierId!))
        .for("update");
      if (!courier || !["AVAILABLE", "OFFLINE"].includes(courier.status)) {
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
    res.json(AcceptCourierRouteResponse.parse(await routeView(updatedRoute)));
  },
);

router.post(
  "/courier/routes/:routeId/stops/:stopId/complete",
  requireRole("COURIER"),
  async (req, res): Promise<void> => {
    const params = CompleteCourierRouteStopParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: "Parada inválida." });
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
      if (!nextStop || nextStop.id !== params.data.stopId) {
        return { error: "wrong_stop_order" as const };
      }

      const [delivery] = await tx
        .select()
        .from(deliveriesTable)
        .where(eq(deliveriesTable.id, nextStop.deliveryId))
        .for("update");
      if (!delivery || delivery.courierId !== profile.courierId) {
        return { error: "delivery_not_owned" as const };
      }

      const nextDeliveryStatus =
        nextStop.kind === "pickup" ? "IN_TRANSIT" : "COMPLETED";
      const expectedStatus =
        nextStop.kind === "pickup" ? "ACCEPTED" : "IN_TRANSIT";
      if (delivery.status !== expectedStatus) {
        return { error: "delivery_status_changed" as const };
      }

      const now = new Date();
      await tx
        .update(deliveryRouteStopsTable)
        .set({ status: "DONE", completedAt: now })
        .where(eq(deliveryRouteStopsTable.id, nextStop.id));
      await tx
        .update(deliveriesTable)
        .set({ status: nextDeliveryStatus, updatedAt: now })
        .where(eq(deliveriesTable.id, delivery.id));
      await tx.insert(deliveryEventsTable).values({
        id: randomUUID(),
        deliveryId: delivery.id,
        kind: nextDeliveryStatus.toLowerCase(),
        label:
          nextStop.kind === "pickup"
            ? "Retirada confirmada na rota"
            : "Entrega concluída na rota",
        actor: "Motoboy",
        timestamp: now,
      });

      const routeComplete = stops.every(
        (stop) => stop.id === nextStop.id || stop.status === "DONE",
      );
      if (routeComplete) {
        await tx
          .update(deliveryRoutesTable)
          .set({ status: "COMPLETED" })
          .where(eq(deliveryRoutesTable.id, route.id));
        await tx
          .update(couriersTable)
          .set({
            status: "AVAILABLE",
            currentDeliveryCode: null,
            currentLatitude: null,
            currentLongitude: null,
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
      CompleteCourierRouteStopResponse.parse(await routeView(updatedRoute)),
    );
  },
);

export default router;
