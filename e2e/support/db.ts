import pg from "pg";
import { assertSafeEnvironment } from "./env.ts";
import { secondCourier, stores, users, type RoleKey } from "./fixtures-data.ts";

let pool: pg.Pool | undefined;

export function db() {
  assertSafeEnvironment();
  pool ??= new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 4 });
  return pool;
}

export async function closeDb() {
  await pool?.end();
  pool = undefined;
}

export async function query<T extends pg.QueryResultRow = any>(sql: string, params: unknown[] = []) {
  return (await db().query<T>(sql, params)).rows;
}

// Ids fixos dos "dados de demonstração" do sistema (só usados no teste da limpeza de demo).
export const demo = {
  deliveries: ["delivery-2413", "delivery-2414"],
  couriers: ["courier-ana", "courier-bruno"],
  stores: ["store-centro", "store-contagem"],
};
const list = (ids: string[]) => ids.map((id) => `'${id}'`).join(",");
const e2eStores = `(select id from stores where id like 'e2e-%' or name like 'E2E %' or id in (${list(demo.stores)}))`;
const e2eDeliveries = `(select id from deliveries where store_id in ${e2eStores} or id in (${list(demo.deliveries)}))`;

/** Remove tudo que a bateria cria. Não toca em registros reais. */
export async function cleanupDatabase() {
  const client = await db().connect();
  try {
    await client.query("begin");
    await client.query(`delete from delivery_cancellations where delivery_id in ${e2eDeliveries}`);
    await client.query(`delete from delivery_evidence_uploads where delivery_id in ${e2eDeliveries}`);
    await client.query(
      `delete from delivery_routes where delivery_ids && array(select id from deliveries where id in ${e2eDeliveries})
         or courier_id like 'e2e-%' or courier_id in (${list(demo.couriers)})`,
    );
    await client.query(`delete from deliveries where id in ${e2eDeliveries}`);
    await client.query(
      `delete from push_subscriptions where user_id in (select id from app_users where email like 'e2e-%@example.com')`,
    );
    await client.query(
      `delete from native_push_tokens where user_id in (select id from app_users where email like 'e2e-%@example.com')`,
    );
    await client.query(`delete from app_users where email like 'e2e-%@example.com'`);
    await client.query(`delete from couriers where id like 'e2e-%' or id in (${list(demo.couriers)})`);
    await client.query(`delete from stores where id in ${e2eStores}`);
    await client.query("commit");
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}

/** Recria lojas, motoboys e perfis com papéis fixos. */
export async function seedDatabase(authIds: Record<RoleKey, string>) {
  for (const store of Object.values(stores)) {
    await query(
      `insert into stores (id, name, code, city, address, street, number, neighborhood, state_code, postal_code,
         phone, manager_name, manager_phone, delivery_fee_cents, latitude, longitude, active)
       values ($1,$2,$3,$4,$5,'Rua Teste','100','Centro','MG','30000-000','(31) 3333-0000','E2E Gerente',
         '(31) 99999-0000',$6,$7,$8,$9)`,
      [store.id, store.name, store.code, store.city, store.address, store.feeCents, store.lat, store.lng,
        store.id !== stores.inactive.id],
    );
  }
  await query(
    `insert into couriers (id, name, phone, initials, status) values
       ('e2e-courier-1', $1, '(31) 98888-0001', 'JM', 'OFFLINE'),
       ('e2e-courier-2', $2, '(31) 98888-0002', 'MM', 'OFFLINE')`,
    [users.courier.name, secondCourier.name],
  );
  for (const [key, user] of Object.entries(users) as [RoleKey, (typeof users)[RoleKey]][]) {
    await query(
      `insert into app_users (id, auth_user_id, email, name, role, store_id, courier_id)
       values ($1,$2,$3,$4,$5,$6,$7)`,
      [`e2e-user-${key}`, authIds[key], user.email.toLowerCase(), user.name, user.role,
        user.storeId ?? null, user.courierId ?? null],
    );
  }
  await query(
    `insert into app_users (id, email, name, role, courier_id) values ($1,$2,$3,'COURIER',$4)`,
    [secondCourier.appUserId, secondCourier.email, secondCourier.name, secondCourier.courierId],
  );
}

/** Volta os motoboys ao estado inicial entre arquivos de teste. */
export async function resetCouriers() {
  await query(`update couriers set status = 'OFFLINE', current_delivery_code = null,
    current_latitude = null, current_longitude = null, location_measured_at = null, last_location_at = null
    where id like 'e2e-%'`);
}

export async function setCourierStatus(courierId: string, status: "AVAILABLE" | "BUSY" | "OFFLINE") {
  await query(`update couriers set status = $2 where id = $1`, [courierId, status]);
}

/**
 * Monta direto no banco uma rota agrupada já ACEITA pelo motoboy, com paradas
 * coleta → coleta → entrega → entrega. Usado porque aceitar rota pela API exige
 * a Google Route Optimization API, que o ambiente local pode não ter configurada.
 */
export async function seedAcceptedRoute(deliveries: { id: string; destination: string; customerLatitude: number; customerLongitude: number }[], courierId = "e2e-courier-1") {
  const routeId = `e2e-route-${Date.now()}`;
  const ids = deliveries.map((d) => d.id);
  await query(
    `insert into delivery_routes (id, delivery_ids, courier_id, status, start_latitude, start_longitude, locked_at, created_by,
       route_geometry, distance_meters, duration_seconds)
     values ($1, $2, $3, 'ACCEPTED', -19.9367, -43.9345, now(), 'e2e-user-central', $4::jsonb, 2400, 900)`,
    [routeId, ids, courierId, JSON.stringify([
      { latitude: -19.9367, longitude: -43.9345 },
      { latitude: -19.9365, longitude: -43.9351 },
      ...deliveries.map((d) => ({ latitude: d.customerLatitude, longitude: d.customerLongitude })),
    ])],
  );
  await query(`update deliveries set status = 'ACCEPTED', courier_id = $2, updated_at = now() where id = any($1)`, [ids, courierId]);
  await query(`update couriers set status = 'BUSY', current_latitude = -19.9367, current_longitude = -43.9345,
    last_location_at = now(), location_measured_at = now() where id = $1`, [courierId]);
  let sequence = 0;
  const stops: { id: string; deliveryId: string; kind: string }[] = [];
  for (const kind of ["pickup", "delivery"]) {
    for (const d of deliveries) {
      sequence += 1;
      const id = `${routeId}-s${sequence}`;
      const [lat, lng] = kind === "pickup" ? [-19.9365, -43.9351] : [d.customerLatitude, d.customerLongitude];
      await query(
        `insert into delivery_route_stops (id, route_id, delivery_id, sequence, kind, address, latitude, longitude, status)
         values ($1, $2, $3, $4, $5, $6, $7, $8, 'PENDING')`,
        [id, routeId, d.id, sequence, kind, kind === "pickup" ? "E2E Drogaria Savassi" : d.destination, lat, lng],
      );
      stops.push({ id, deliveryId: d.id, kind });
    }
  }
  return { routeId, stops };
}

/** Apaga entregas e rotas de teste, mantendo lojas, usuários e motoboys. */
export async function wipeDeliveries() {
  await query(`delete from delivery_cancellations where delivery_id in ${e2eDeliveries}`);
  await query(`delete from delivery_evidence_uploads where delivery_id in ${e2eDeliveries}`);
  await query(
    `delete from delivery_routes where delivery_ids && array(select id from deliveries where id in ${e2eDeliveries})
       or courier_id like 'e2e-%'`,
  );
  await query(`delete from deliveries where id in ${e2eDeliveries}`);
  await resetCouriers();
}
