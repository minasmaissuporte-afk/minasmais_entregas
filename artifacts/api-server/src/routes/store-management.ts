import { randomUUID } from "node:crypto";
import { eq, inArray, sql } from "drizzle-orm";
import { Router, type IRouter } from "express";
import {
  AutocompleteAddressesQueryParams,
  AutocompleteAddressesResponse,
  CleanupDemoDataBody,
  CleanupDemoDataResponse,
  CreateStoreBody,
  CreateStoreResponse,
  DeleteStoreParams,
  ListStoresResponse,
  UpdateStoreBody,
  UpdateStoreParams,
  UpdateStoreResponse,
} from "@workspace/api-zod";
import {
  appUsersTable,
  couriersTable,
  db,
  deliveriesTable,
  deliveryRoutesTable,
  storesTable,
} from "@workspace/db";
import {
  requireAuthentication,
  requireRole,
  type AppUserProfile,
} from "../middlewares/accessControl";

const router: IRouter = Router();
router.use(requireAuthentication);

const demoDeliveryIds = [
  "delivery-2413",
  "delivery-2414",
  "delivery-2415",
  "delivery-2416",
  "delivery-2417",
  "delivery-2418",
  "delivery-2419",
];
const demoCourierIds = [
  "courier-ana",
  "courier-bruno",
  "courier-camila",
  "courier-diego",
  "courier-joao",
];
const demoStoreIds = ["store-centro", "store-contagem", "store-savassi"];

async function storeRecords(storeId?: string) {
  const rows = storeId
    ? await db
        .select()
        .from(storesTable)
        .where(eq(storesTable.id, storeId))
        .orderBy(storesTable.name)
    : await db.select().from(storesTable).orderBy(storesTable.name);
  const counts = await db
    .select({
      storeId: deliveriesTable.storeId,
      count: sql<number>`count(*)::int`,
    })
    .from(deliveriesTable)
    .groupBy(deliveriesTable.storeId);
  const deliveryCounts = new Map(
    counts.map((row) => [row.storeId, Number(row.count)]),
  );

  return rows.map((store) => ({
    ...store,
    deliveryCount: deliveryCounts.get(store.id) ?? 0,
  }));
}

function storeValues(input: ReturnType<typeof CreateStoreBody.parse>) {
  const trimmed = (value?: string) => value?.trim() || null;
  const stateCode = input.stateCode.trim().toUpperCase();
  return {
    name: input.name.trim(),
    address: input.address.trim(),
    street: input.street.trim(),
    number: trimmed(input.number),
    complement: trimmed(input.complement),
    neighborhood: trimmed(input.neighborhood),
    city: input.city.trim(),
    stateCode,
    postalCode: trimmed(input.postalCode),
    phone: trimmed(input.phone),
    managerName: input.managerName.trim(),
    managerPhone: trimmed(input.managerPhone),
    assistantManagerName: trimmed(input.assistantManagerName),
    assistantManagerPhone: trimmed(input.assistantManagerPhone),
    latitude: input.latitude,
    longitude: input.longitude,
  };
}

router.get(
  "/stores",
  requireRole("ADMIN", "CENTRAL", "STORE_MANAGER", "STORE_STAFF"),
  async (_req, res): Promise<void> => {
    const profile = res.locals.appUser as AppUserProfile;
    if (
      (profile.role === "STORE_MANAGER" || profile.role === "STORE_STAFF") &&
      !profile.storeId
    ) {
      res.status(403).json({ error: "Esta conta não está vinculada a uma unidade." });
      return;
    }

    const stores = await storeRecords(
      profile.role === "STORE_MANAGER" || profile.role === "STORE_STAFF"
        ? profile.storeId!
        : undefined,
    );
    res.json(ListStoresResponse.parse(stores));
  },
);

router.post(
  "/stores",
  requireRole("ADMIN"),
  async (req, res): Promise<void> => {
    const body = CreateStoreBody.safeParse(req.body);
    if (!body.success) {
      res.status(400).json({ error: body.error.message });
      return;
    }

    const id = randomUUID();
    const [created] = await db
      .insert(storesTable)
      .values({
        id,
        code: `FIL-${id.slice(0, 8).toUpperCase()}`,
        active: true,
        ...storeValues(body.data),
      })
      .returning({ id: storesTable.id });
    const [record] = await storeRecords(created.id);
    res.status(201).json(CreateStoreResponse.parse(record));
  },
);

router.put(
  "/stores/:storeId",
  requireRole("ADMIN"),
  async (req, res): Promise<void> => {
    const params = UpdateStoreParams.safeParse(req.params);
    const body = UpdateStoreBody.safeParse(req.body);
    if (!params.success) {
      res.status(400).json({ error: params.error.message });
      return;
    }
    if (!body.success) {
      res.status(400).json({ error: body.error.message });
      return;
    }

    const [updated] = await db
      .update(storesTable)
      .set(storeValues(body.data))
      .where(eq(storesTable.id, params.data.storeId))
      .returning({ id: storesTable.id });
    if (!updated) {
      res.status(404).json({ error: "Filial não encontrada." });
      return;
    }

    const [record] = await storeRecords(updated.id);
    res.json(UpdateStoreResponse.parse(record));
  },
);

router.delete(
  "/stores/:storeId",
  requireRole("ADMIN"),
  async (req, res): Promise<void> => {
    const params = DeleteStoreParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: params.error.message });
      return;
    }

    const storeId = params.data.storeId;
    const [linkedDelivery] = await db
      .select({ id: deliveriesTable.id })
      .from(deliveriesTable)
      .where(eq(deliveriesTable.storeId, storeId))
      .limit(1);
    const [linkedUser] = await db
      .select({ id: appUsersTable.id })
      .from(appUsersTable)
      .where(eq(appUsersTable.storeId, storeId))
      .limit(1);
    if (linkedDelivery || linkedUser) {
      res.status(409).json({
        error: linkedDelivery
          ? "Não é possível excluir uma filial com entregas vinculadas."
          : "Não é possível excluir uma filial vinculada a uma conta.",
      });
      return;
    }

    const [deleted] = await db
      .delete(storesTable)
      .where(eq(storesTable.id, storeId))
      .returning({ id: storesTable.id });
    if (!deleted) {
      res.status(404).json({ error: "Filial não encontrada." });
      return;
    }
    res.status(204).end();
  },
);

router.get(
  "/enderecos/autocomplete",
  requireRole("ADMIN", "CENTRAL", "STORE_MANAGER", "STORE_STAFF"),
  async (req, res): Promise<void> => {
    const query = AutocompleteAddressesQueryParams.safeParse(req.query);
    if (!query.success || query.data.texto.trim().length < 3) {
      res.status(422).json({ error: "Digite pelo menos 3 caracteres do endereço." });
      return;
    }

    const apiKey = process.env.GEOAPIFY_API_KEY;
    if (!apiKey) {
      res.status(503).json({ error: "A busca de endereços ainda não está configurada." });
      return;
    }

    const url = new URL("https://api.geoapify.com/v1/geocode/autocomplete");
    url.searchParams.set("text", query.data.texto.trim());
    url.searchParams.set("format", "json");
    url.searchParams.set("limit", "5");
    url.searchParams.set("lang", "pt");
    url.searchParams.set("filter", "countrycode:br");
    url.searchParams.set("apiKey", apiKey);

    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(8000) });
      if (!response.ok) {
        req.log.warn({ status: response.status }, "Geoapify autocomplete request failed");
        res.status(502).json({ error: "Não foi possível consultar endereços agora." });
        return;
      }

      const payload = (await response.json()) as {
        results?: Array<Record<string, unknown>>;
      };
      const suggestions = (payload.results ?? [])
        .filter(
          (result) =>
            typeof result.formatted === "string" &&
            typeof result.lat === "number" &&
            Number.isFinite(result.lat) &&
            typeof result.lon === "number" &&
            Number.isFinite(result.lon),
        )
        .slice(0, 5)
        .map((result) => ({
          formatted: result.formatted as string,
          street: typeof result.street === "string" ? result.street : null,
          houseNumber:
            typeof result.housenumber === "string" ? result.housenumber : null,
          suburb:
            typeof result.suburb === "string"
              ? result.suburb
              : typeof result.neighbourhood === "string"
                ? result.neighbourhood
                : null,
          district: typeof result.district === "string" ? result.district : null,
          city:
            typeof result.city === "string"
              ? result.city
              : typeof result.town === "string"
                ? result.town
                : typeof result.village === "string"
                  ? result.village
                  : null,
          stateCode:
            typeof result.state_code === "string"
              ? result.state_code.toUpperCase().slice(0, 2)
              : null,
          postcode: typeof result.postcode === "string" ? result.postcode : null,
          latitude: result.lat as number,
          longitude: result.lon as number,
        }));

      res.json(AutocompleteAddressesResponse.parse(suggestions));
    } catch {
      req.log.warn("Geoapify autocomplete request failed");
      res.status(502).json({ error: "Não foi possível consultar endereços agora." });
    }
  },
);

router.post(
  "/admin/demo-data/cleanup",
  requireRole("ADMIN"),
  async (req, res): Promise<void> => {
    const body = CleanupDemoDataBody.safeParse(req.body);
    if (!body.success || body.data.confirmation !== "REMOVE_DEMO_RECORDS") {
      res.status(400).json({ error: "Confirme a remoção dos dados de demonstração." });
      return;
    }

    const summary = await db.transaction(async (tx) => {
      const routes = await tx
        .select({
          id: deliveryRoutesTable.id,
          courierId: deliveryRoutesTable.courierId,
          deliveryIds: deliveryRoutesTable.deliveryIds,
        })
        .from(deliveryRoutesTable);
      const routeIdsToDelete: string[] = [];
      const protectedDeliveryIds = new Set<string>();

      for (const route of routes) {
        const routeIsDemo =
          route.deliveryIds.length > 0 &&
          route.deliveryIds.every((id) => demoDeliveryIds.includes(id)) &&
          (demoCourierIds.includes(route.courierId ?? "") ||
            route.deliveryIds.some((id) => demoDeliveryIds.includes(id)));
        if (routeIsDemo) {
          routeIdsToDelete.push(route.id);
        } else {
          route.deliveryIds
            .filter((id) => demoDeliveryIds.includes(id))
            .forEach((id) => protectedDeliveryIds.add(id));
        }
      }

      if (routeIdsToDelete.length) {
        await tx
          .delete(deliveryRoutesTable)
          .where(inArray(deliveryRoutesTable.id, routeIdsToDelete));
      }

      const existingDemoDeliveries = await tx
        .select({ id: deliveriesTable.id })
        .from(deliveriesTable)
        .where(inArray(deliveriesTable.id, demoDeliveryIds));
      const deletableDeliveryIds = existingDemoDeliveries
        .map((delivery) => delivery.id)
        .filter((id) => !protectedDeliveryIds.has(id));
      if (deletableDeliveryIds.length) {
        await tx
          .delete(deliveriesTable)
          .where(inArray(deliveriesTable.id, deletableDeliveryIds));
      }

      const linkedCourierRows = await tx
        .select({ courierId: appUsersTable.courierId })
        .from(appUsersTable)
        .where(inArray(appUsersTable.courierId, demoCourierIds));
      const linkedCourierIds = new Set(
        linkedCourierRows
          .map((row) => row.courierId)
          .filter((id): id is string => Boolean(id)),
      );
      const remainingCourierDeliveries = await tx
        .select({ courierId: deliveriesTable.courierId })
        .from(deliveriesTable)
        .where(inArray(deliveriesTable.courierId, demoCourierIds));
      const remainingCourierRoutes = await tx
        .select({ courierId: deliveryRoutesTable.courierId })
        .from(deliveryRoutesTable)
        .where(inArray(deliveryRoutesTable.courierId, demoCourierIds));
      const courierIdsToDelete = demoCourierIds.filter(
        (id) =>
          !linkedCourierIds.has(id) &&
          !remainingCourierDeliveries.some((row) => row.courierId === id) &&
          !remainingCourierRoutes.some((row) => row.courierId === id),
      );
      const deletedCouriers = courierIdsToDelete.length
        ? await tx
            .delete(couriersTable)
            .where(inArray(couriersTable.id, courierIdsToDelete))
            .returning({ id: couriersTable.id })
        : [];

      const linkedStoreRows = await tx
        .select({ storeId: appUsersTable.storeId })
        .from(appUsersTable)
        .where(inArray(appUsersTable.storeId, demoStoreIds));
      const linkedStoreIds = new Set(
        linkedStoreRows
          .map((row) => row.storeId)
          .filter((id): id is string => Boolean(id)),
      );
      const remainingStoreDeliveries = await tx
        .select({ storeId: deliveriesTable.storeId })
        .from(deliveriesTable)
        .where(inArray(deliveriesTable.storeId, demoStoreIds));
      const storeIdsToDelete = demoStoreIds.filter(
        (id) =>
          !linkedStoreIds.has(id) &&
          !remainingStoreDeliveries.some((row) => row.storeId === id),
      );
      const deletedStores = storeIdsToDelete.length
        ? await tx
            .delete(storesTable)
            .where(inArray(storesTable.id, storeIdsToDelete))
            .returning({ id: storesTable.id })
        : [];

      return {
        removedDeliveries: deletableDeliveryIds.length,
        removedCouriers: deletedCouriers.length,
        removedStores: deletedStores.length,
        preservedDeliveries: protectedDeliveryIds.size,
        preservedLinkedCouriers: linkedCourierIds.size,
        preservedLinkedStores: linkedStoreIds.size,
      };
    });

    res.json(CleanupDemoDataResponse.parse(summary));
  },
);

export default router;
