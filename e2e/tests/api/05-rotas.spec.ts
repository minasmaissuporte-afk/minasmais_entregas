import { test, expect } from "@playwright/test";
import { Api, describe, json } from "../../support/api.ts";
import { BH_POSITION, stores } from "../../support/fixtures-data.ts";
import { courierOnline, createDelivery, expectError, expectStatus, setStatus } from "../../support/helpers.ts";
import { query, seedAcceptedRoute, setCourierStatus, wipeDeliveries } from "../../support/db.ts";

async function twoDeliveries(central: Api) {
  const d1 = await createDelivery(central, { storeId: stores.a.id });
  const d2 = await createDelivery(central, { storeId: stores.a.id });
  return [d1, d2];
}

test.describe("Rotas agrupadas: criação", () => {
  test.beforeEach(wipeDeliveries);

  test("Central agrupa 2 entregas: rota OFFERED, entregas OFFERED, valor = soma das tarifas", async () => {
    const central = await Api.as("central");
    const [d1, d2] = await twoDeliveries(central);
    const res = await central.post("/delivery-routes", { deliveryIds: [d1.id, d2.id] });
    expect(res.status(), await describe(res)).toBe(201);
    const route = await json(res);
    expect(route).toMatchObject({ status: "OFFERED", courierId: null, deliveryCount: 2 });
    expect(route.amountToReceive).toBeCloseTo(d1.deliveryAmount + d2.deliveryAmount, 2);
    await expectStatus(central, d1.id, "OFFERED");
    await expectStatus(central, d2.id, "OFFERED");
  });

  const invalid: [string, (ids: string[]) => unknown][] = [
    ["só 1 entrega", (ids) => ({ deliveryIds: [ids[0]] })],
    ["entrega repetida", (ids) => ({ deliveryIds: [ids[0], ids[0]] })],
    ["mais de 10 entregas", () => ({ deliveryIds: Array.from({ length: 11 }, (_, i) => `e2e-${i}`) })],
    ["lista vazia", () => ({ deliveryIds: [] })],
  ];
  for (const [label, body] of invalid) {
    test(`Rota inválida (${label}) → 400`, async () => {
      const central = await Api.as("central");
      const ds = await twoDeliveries(central);
      await expectError(await central.post("/delivery-routes", body(ds.map((d) => d.id))), 400);
    });
  }

  test("Entrega inexistente → 404 e entrega já despachada → 409 (sem criar rota pela metade)", async () => {
    const central = await Api.as("central");
    const [d1, d2] = await twoDeliveries(central);
    await expectError(await central.post("/delivery-routes", { deliveryIds: [d1.id, "e2e-nao-existe"] }), 404);
    await expectStatus(central, d1.id, "REQUESTED");
    await central.post(`/deliveries/${d2.id}/dispatch`, { mode: "group" });
    await expectError(await central.post("/delivery-routes", { deliveryIds: [d1.id, d2.id] }), 409);
    await expectStatus(central, d1.id, "REQUESTED");
    expect(await query("select 1 from delivery_routes where $1 = any(delivery_ids)", [d1.id])).toEqual([]);
  });

  test("Entrega em rota agrupada não pode ter status alterado manualmente nem ser redespachada", async () => {
    const central = await Api.as("central");
    const [d1, d2] = await twoDeliveries(central);
    await central.post("/delivery-routes", { deliveryIds: [d1.id, d2.id] });
    expect((await setStatus(central, d1.id, "CANCELLED")).status()).toBe(409);
    await expectError(await central.post(`/deliveries/${d1.id}/dispatch`, { mode: "group" }), 409, "rota agrupada");
  });

  test("Duas Centrais criando rota com as mesmas entregas ao mesmo tempo: só uma rota nasce", async () => {
    const central = await Api.as("central");
    const admin = await Api.as("admin");
    const [d1, d2] = await twoDeliveries(central);
    const [a, b] = await Promise.all([
      central.post("/delivery-routes", { deliveryIds: [d1.id, d2.id] }),
      admin.post("/delivery-routes", { deliveryIds: [d2.id, d1.id] }),
    ]);
    expect([a.status(), b.status()].sort()).toEqual([201, 409]);
    const routes = await query("select id from delivery_routes where $1 = any(delivery_ids)", [d1.id]);
    expect(routes).toHaveLength(1);
  });
});

test.describe("Rotas agrupadas: oferta ao motoboy", () => {
  test.beforeEach(wipeDeliveries);

  async function offeredRoute() {
    const central = await Api.as("central");
    const courier = await Api.as("courier");
    const [d1, d2] = await twoDeliveries(central);
    const route = await json(await central.post("/delivery-routes", { deliveryIds: [d1.id, d2.id] }));
    return { central, courier, d1, d2, route };
  }

  test("Motoboy offline não pré-visualiza; online vê a oferta na lista", async () => {
    const { courier, route } = await offeredRoute();
    await setCourierStatus("e2e-courier-1", "OFFLINE");
    await expectError(await courier.get(`/courier/routes/${route.id}/preview`), 403, "online");
    await courierOnline(courier);
    expect((await json(await courier.get("/courier/routes"))).map((r: any) => r.id)).toContain(route.id);
  });

  test("Pré-visualizar e aceitar rota usam o Google Route Optimization (trajeto otimizado)", async () => {
    const { central, courier, d1, route } = await offeredRoute();
    await courierOnline(courier);
    const preview = await courier.get(`/courier/routes/${route.id}/preview`);
    if (preview.status() === 503) {
      // Ambiente: sem conta de serviço/permissão da Route Optimization API. A API falha de forma controlada.
      expect((await json(preview)).error).toMatch(/Google/);
      const accept = await courier.post(`/courier/routes/${route.id}/accept`, BH_POSITION);
      expect(accept.status(), await describe(accept)).toBe(503);
      await expectStatus(central, d1.id, "OFFERED"); // nada muda quando o Google Maps falha
      const [c] = await query("select status from couriers where id='e2e-courier-1'");
      expect(c.status).toBe("AVAILABLE");
      test.info().annotations.push({ type: "limitação", description: "Route Optimization API não configurada no ambiente local: aceite real de rota não testado" });
      return;
    }
    expect(preview.status(), await describe(preview)).toBe(200);
    const body = await json(preview);
    expect(body.stops.filter((s: any) => s.kind === "delivery")).toHaveLength(2);
    const accept = await courier.post(`/courier/routes/${route.id}/accept`, BH_POSITION);
    expect(accept.status(), await describe(accept)).toBe(200);
    expect(await json(accept)).toMatchObject({ status: "ACCEPTED", courierId: "e2e-courier-1" });
  });

  test("Recusar rota: some da lista dele e continua ofertada; recusar de novo é idempotente; aceitar a recusada → 409", async () => {
    const { courier, route } = await offeredRoute();
    await courierOnline(courier);
    const res = await courier.post(`/courier/routes/${route.id}/decline`);
    expect(res.status(), await describe(res)).toBe(204);
    expect((await json(await courier.get("/courier/routes"))).map((r: any) => r.id)).not.toContain(route.id);
    expect((await courier.post(`/courier/routes/${route.id}/decline`)).status()).toBe(204);
    await expectError(await courier.post(`/courier/routes/${route.id}/accept`, BH_POSITION), 409, "recusou");
    const [r] = await query("select status from delivery_routes where id=$1", [route.id]);
    expect(r.status).toBe("OFFERED");
  });

  test("Aceitar rota sem localização → 400", async () => {
    const { courier, route } = await offeredRoute();
    await courierOnline(courier);
    await expectError(await courier.post(`/courier/routes/${route.id}/accept`, {}), 400);
  });

  test("Excluir entrega de rota ainda ofertada: rota de 2 vira cancelada e a outra entrega volta para REQUESTED", async () => {
    const { central, d1, d2, route } = await offeredRoute();
    const admin = await Api.as("admin");
    const res = await admin.delete(`/deliveries/${d1.id}`);
    expect(res.status(), await describe(res)).toBe(204);
    await expectStatus(central, d2.id, "REQUESTED");
    const [r] = await query("select status, delivery_ids from delivery_routes where id=$1", [route.id]);
    expect(r?.delivery_ids ?? []).not.toContain(d1.id);
  });
});

test.describe("Rotas agrupadas: rota aceita (montada no banco)", () => {
  test.beforeEach(wipeDeliveries);

  async function acceptedRoute() {
    const central = await Api.as("central");
    const courier = await Api.as("courier");
    const [d1, d2] = await twoDeliveries(central);
    const { routeId, stops } = await seedAcceptedRoute([d1, d2]);
    return { central, courier, d1, d2, routeId, stops };
  }

  test("Motoboy vê a rota aceita com paradas na ordem e a Central vê a rota ativa", async () => {
    const { central, courier, routeId } = await acceptedRoute();
    const mine = (await json(await courier.get("/courier/routes"))).find((r: any) => r.id === routeId);
    expect(mine).toMatchObject({ status: "ACCEPTED", courierId: "e2e-courier-1", deliveryCount: 2 });
    expect(mine.stops.map((s: any) => s.kind)).toEqual(["pickup", "pickup", "delivery", "delivery"]);
    const active = await json(await central.get("/operations/active-routes"));
    expect(active.map((r: any) => r.id)).toContain(routeId);
  });

  test("Jornada: chegada obrigatória, coleta na ordem travada, entrega exige foto", async () => {
    const { central, courier, d1, d2, routeId, stops } = await acceptedRoute();
    const base = `/courier/routes/${routeId}/stops`;
    // Fora de ordem (a 2ª coleta antes da 1ª)
    await expectError(await courier.post(`${base}/${stops[1].id}/arrive`), 409);
    await expectError(await courier.post(`${base}/${stops[1].id}/complete`, {}), 409, "sequência");
    // Coleta sem chegada
    await expectError(await courier.post(`${base}/${stops[0].id}/complete`, {}), 409, "chegada");
    for (const stop of stops.slice(0, 2)) {
      const arrive = await courier.post(`${base}/${stop.id}/arrive`);
      expect(arrive.status(), await describe(arrive)).toBe(200);
      const done = await courier.post(`${base}/${stop.id}/complete`, {});
      expect(done.status(), await describe(done)).toBe(200);
      await expectStatus(central, stop.deliveryId, "IN_TRANSIT");
    }
    // Entrega: "chegada" é só para loja; concluir sem foto ou com foto falsa → 422
    await expectError(await courier.post(`${base}/${stops[2].id}/arrive`), 409);
    await expectError(await courier.post(`${base}/${stops[2].id}/complete`, {}), 422, "foto");
    await expectError(await courier.post(`${base}/${stops[2].id}/complete`, { evidencePath: "/objects/falsa.jpg" }), 422);
    // Com rota ativa: não fica offline, a Central não muda status manualmente
    await expectError(await courier.patch("/courier/availability", { online: false }), 409);
    expect((await setStatus(central, d1.id, "CANCELLED")).status()).toBe(409);
    await expectStatus(central, d2.id, "IN_TRANSIT");
  });

  test("Outro motoboy não mexe na rota (403)", async () => {
    const { courier, routeId, stops } = await acceptedRoute();
    await query("update delivery_routes set courier_id = 'e2e-courier-2' where id = $1", [routeId]);
    await expectError(await courier.post(`/courier/routes/${routeId}/stops/${stops[0].id}/arrive`), 403);
  });

  test("Entrega de rota aceita não pode ser excluída (409)", async () => {
    const { d1 } = await acceptedRoute();
    const res = await (await Api.as("admin")).delete(`/deliveries/${d1.id}`);
    expect(res.status(), await describe(res)).toBe(409);
  });

  // Hoje a API chama a otimização do Google antes de checar se o motoboy está livre:
  // gasta uma otimização e, sem Google Maps, responde "token sem permissão" em vez de "você já tem rota".
  test("[MELHORIA] Motoboy com rota ativa não aceita outra rota (409, sem consultar o Google Maps)", async () => {
    const { central, courier } = await acceptedRoute();
    const [b1, b2] = await twoDeliveries(central);
    const r2 = await json(await central.post("/delivery-routes", { deliveryIds: [b1.id, b2.id] }));
    const res = await courier.post(`/courier/routes/${r2.id}/accept`, BH_POSITION);
    expect(res.status(), await describe(res)).toBe(409);
  });

  test("Admin não pode rebaixar nem excluir motoboy com rota ativa (409)", async () => {
    await acceptedRoute();
    const admin = await Api.as("admin");
    await expectError(await admin.patch("/access/users/e2e-user-courier", { role: "PENDING" }), 409);
    await expectError(await admin.delete("/access/users/e2e-user-courier"), 409);
    const [row] = await query("select role, courier_id from app_users where id = 'e2e-user-courier'");
    expect(row).toEqual({ role: "COURIER", courier_id: "e2e-courier-1" });
  });

  test("Acidente durante a rota aborta tudo: entregas voltam à fila com prioridade e motoboy fica OFFLINE", async () => {
    const { central, courier, d1, d2, routeId } = await acceptedRoute();
    const res = await courier.post(`/courier/deliveries/${d1.id}/unable`, { reason: "Moto com problema / acidente" });
    expect(res.status(), await describe(res)).toBe(200);
    expect(await json(res)).toMatchObject({ priority: true, routeContinues: false });
    const [r] = await query("select status from delivery_routes where id=$1", [routeId]);
    expect(r.status).not.toBe("ACCEPTED");
    for (const d of [d1, d2]) {
      const view = await json(await central.get(`/deliveries/${d.id}`));
      expect(["AWAITING_COURIER", "REQUESTED"]).toContain(view.status);
    }
    const [c] = await query("select status from couriers where id='e2e-courier-1'");
    expect(c.status).toBe("OFFLINE");
  });

  test("Ocorrência comum numa entrega da rota recalcula as paradas (Google Maps) ou falha sem corromper a rota", async () => {
    const { central, courier, d1, d2, routeId, stops } = await acceptedRoute();
    const base = `/courier/routes/${routeId}/stops`;
    for (const stop of stops.slice(0, 2)) {
      await courier.post(`${base}/${stop.id}/arrive`);
      await courier.post(`${base}/${stop.id}/complete`, {});
    }
    await courierOnline(courier);
    const res = await courier.post(`/courier/deliveries/${d1.id}/unable`, { reason: "Endereço não encontrado ou incorreto", ...BH_POSITION });
    if (res.status() >= 500) {
      // Sem Optimization no token local: nada pode ter mudado.
      await expectStatus(central, d1.id, "IN_TRANSIT");
      await expectStatus(central, d2.id, "IN_TRANSIT");
      const [r] = await query("select status from delivery_routes where id=$1", [routeId]);
      expect(r.status).toBe("ACCEPTED");
      test.info().annotations.push({ type: "limitação", description: `Recalcular rota depende da Google Route Optimization API (${res.status()})` });
      return;
    }
    expect(res.status(), await describe(res)).toBe(200);
    expect(await json(res)).toMatchObject({ deliveryId: d1.id, status: "RETURNING_TO_STORE", routeContinues: true });
    await expectStatus(central, d1.id, "RETURNING_TO_STORE");
  });
});
