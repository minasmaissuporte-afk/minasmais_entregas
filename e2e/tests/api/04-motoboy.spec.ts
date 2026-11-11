import { test, expect } from "@playwright/test";
import { Api, describe, json } from "../../support/api.ts";
import { BH_POSITION } from "../../support/fixtures-data.ts";
import { courierOnline, createDelivery, expectError, expectStatus, setStatus } from "../../support/helpers.ts";
import { query, setCourierStatus, wipeDeliveries } from "../../support/db.ts";

test.describe("Motoboy: disponibilidade e localização", () => {
  test.beforeEach(wipeDeliveries);

  test("Fica online (AVAILABLE) e offline (OFFLINE)", async () => {
    const courier = await Api.as("courier");
    const on = await courier.patch("/courier/availability", { online: true });
    expect(on.status(), await describe(on)).toBe(200);
    expect(await json(on)).toEqual({ online: true, status: "AVAILABLE" });
    const off = await courier.patch("/courier/availability", { online: false });
    expect(await json(off)).toEqual({ online: false, status: "OFFLINE" });
  });

  test("Disponibilidade sem o campo online → 400", async () => {
    await expectError(await (await Api.as("courier")).patch("/courier/availability", { online: "sim" }), 400);
  });

  test("Não fica offline com entrega em andamento (409)", async () => {
    const central = await Api.as("central");
    const courier = await Api.as("courier");
    await courierOnline(courier);
    const d = await createDelivery(central);
    await central.post(`/deliveries/${d.id}/dispatch`, { mode: "single", courierId: "e2e-courier-1" });
    await setStatus(central, d.id, "ACCEPTED");
    await expectError(await courier.patch("/courier/availability", { online: false }), 409, "entrega ativa");
  });

  test("Localização GPS é gravada e aparece para a Central em /couriers", async () => {
    const courier = await Api.as("courier");
    await courierOnline(courier, { latitude: -19.93, longitude: -43.94 });
    const list = await json(await (await Api.as("central")).get("/couriers"));
    const me = list.find((c: any) => c.id === "e2e-courier-1");
    expect(me).toBeTruthy();
    expect(me.currentLatitude).toBeCloseTo(-19.93, 3);
    expect(me.currentLongitude).toBeCloseTo(-43.94, 3);
    expect(me.lastLocationAt).toBeTruthy();
  });

  const badLocations: [string, Record<string, unknown>][] = [
    ["latitude fora do intervalo", { latitude: 91, longitude: -43.9, measuredAt: new Date().toISOString() }],
    ["sem measuredAt", { latitude: -19.9, longitude: -43.9 }],
    ["precisão negativa", { ...BH_POSITION, accuracyMeters: -5, measuredAt: new Date().toISOString() }],
    ["data inválida", { ...BH_POSITION, measuredAt: "ontem" }],
  ];
  for (const [label, body] of badLocations) {
    test(`Localização inválida (${label}) → 400`, async () => {
      await expectError(await (await Api.as("courier")).post("/courier/location", body), 400);
    });
  }

  test("Ganhos do motoboy: dia, semana e mês, período inválido → 400", async () => {
    const courier = await Api.as("courier");
    for (const period of ["day", "week", "month"]) {
      const res = await courier.get(`/courier/earnings?period=${period}`);
      expect(res.status(), await describe(res)).toBe(200);
      const body = await json(res);
      expect(body.period).toBe(period);
      expect(body.completedDeliveries).toBeGreaterThanOrEqual(0);
      expect(body.amountToReceive).toBeGreaterThanOrEqual(0);
    }
    await expectError(await courier.get("/courier/earnings?period=ano"), 400);
  });

  test("Ganhos somam a tarifa das entregas concluídas hoje", async () => {
    const central = await Api.as("central");
    const courier = await Api.as("courier");
    const before = await json(await courier.get("/courier/earnings?period=day"));
    await setCourierStatus("e2e-courier-1", "AVAILABLE");
    const d = await createDelivery(central);
    await central.post(`/deliveries/${d.id}/dispatch`, { mode: "single", courierId: "e2e-courier-1" });
    for (const s of ["ACCEPTED", "AT_STORE", "IN_TRANSIT", "COMPLETED"]) await setStatus(central, d.id, s);
    const after = await json(await courier.get("/courier/earnings?period=day"));
    expect(after.completedDeliveries).toBe(before.completedDeliveries + 1);
    expect(after.amountToReceive).toBeCloseTo(before.amountToReceive + d.deliveryAmount, 2);
  });
});

test.describe("Despacho individual", () => {
  test.beforeEach(wipeDeliveries);

  test("Sem motoboy disponível → 409", async () => {
    const central = await Api.as("central");
    const d = await createDelivery(central);
    await expectError(await central.post(`/deliveries/${d.id}/dispatch`, { mode: "single" }), 409, "motoboy disponível");
    await expectStatus(central, d.id, "REQUESTED");
  });

  test("Modo inválido → 400 e entrega inexistente → 404", async () => {
    const central = await Api.as("central");
    const d = await createDelivery(central);
    await expectError(await central.post(`/deliveries/${d.id}/dispatch`, { mode: "todos" }), 400);
    await expectError(await central.post("/deliveries/e2e-nao-existe/dispatch", { mode: "group" }), 404);
  });

  test("Oferta para motoboy indicado aparece na lista dele; offline ele não vê a oferta", async () => {
    const central = await Api.as("central");
    const courier = await Api.as("courier");
    await courierOnline(courier);
    const d = await createDelivery(central);
    const res = await central.post(`/deliveries/${d.id}/dispatch`, { mode: "single", courierId: "e2e-courier-1" });
    expect(res.status(), await describe(res)).toBe(200);
    expect(await json(res)).toMatchObject({ status: "OFFERED", courierId: "e2e-courier-1" });
    expect((await json(await courier.get("/deliveries"))).map((x: any) => x.id)).toContain(d.id);
    await setCourierStatus("e2e-courier-1", "OFFLINE");
    expect((await json(await courier.get("/deliveries"))).map((x: any) => x.id)).not.toContain(d.id);
  });

  test("Motoboy ocupado não recebe oferta direcionada", async () => {
    const central = await Api.as("central");
    await setCourierStatus("e2e-courier-1", "BUSY");
    const d = await createDelivery(central);
    await expectError(
      await central.post(`/deliveries/${d.id}/dispatch`, { mode: "single", courierId: "e2e-courier-1" }),
      409,
    );
  });

  test("Despacho para o grupo deixa a entrega OFFERED sem motoboy definido", async () => {
    const central = await Api.as("central");
    const d = await createDelivery(central);
    const res = await central.post(`/deliveries/${d.id}/dispatch`, { mode: "group" });
    expect(res.status(), await describe(res)).toBe(200);
    expect(await json(res)).toMatchObject({ status: "OFFERED", courierId: null });
  });

  test("Motoboy recusa oferta individual → volta para AWAITING_COURIER; recusar de novo → 409", async () => {
    const central = await Api.as("central");
    const courier = await Api.as("courier");
    await courierOnline(courier);
    const d = await createDelivery(central);
    await central.post(`/deliveries/${d.id}/dispatch`, { mode: "single", courierId: "e2e-courier-1" });
    const res = await courier.post(`/courier/deliveries/${d.id}/decline`);
    expect(res.status(), await describe(res)).toBe(204);
    const after = await json(await central.get(`/deliveries/${d.id}`));
    expect(after.status).toBe("AWAITING_COURIER");
    expect(after.courierId).toBeNull();
    await expectError(await courier.post(`/courier/deliveries/${d.id}/decline`), 409);
  });

  test("Entrega devolvida à fila (AWAITING_COURIER) pode ser redespachada", async () => {
    const central = await Api.as("central");
    const courier = await Api.as("courier");
    await courierOnline(courier);
    const d = await createDelivery(central);
    await central.post(`/deliveries/${d.id}/dispatch`, { mode: "single", courierId: "e2e-courier-1" });
    await courier.post(`/courier/deliveries/${d.id}/decline`);
    const again = await central.post(`/deliveries/${d.id}/dispatch`, { mode: "group" });
    expect(again.status(), await describe(again)).toBe(200);
  });

  test("Entrega em andamento não pode ser redespachada (409)", async () => {
    const central = await Api.as("central");
    await setCourierStatus("e2e-courier-1", "AVAILABLE");
    const d = await createDelivery(central);
    await central.post(`/deliveries/${d.id}/dispatch`, { mode: "single", courierId: "e2e-courier-1" });
    await setStatus(central, d.id, "ACCEPTED");
    await expectError(await central.post(`/deliveries/${d.id}/dispatch`, { mode: "group" }), 409);
  });

  test("Aceite marca o motoboy como BUSY; um segundo aceite para o mesmo motoboy falha", async () => {
    const central = await Api.as("central");
    await setCourierStatus("e2e-courier-1", "AVAILABLE");
    const d1 = await createDelivery(central);
    const d2 = await createDelivery(central);
    await central.post(`/deliveries/${d1.id}/dispatch`, { mode: "single", courierId: "e2e-courier-1" });
    await central.post(`/deliveries/${d2.id}/dispatch`, { mode: "single", courierId: "e2e-courier-1" });
    expect((await setStatus(central, d1.id, "ACCEPTED")).status()).toBe(200);
    const [c] = await query("select status from couriers where id='e2e-courier-1'");
    expect(c.status).toBe("BUSY");
    const second = await setStatus(central, d2.id, "ACCEPTED");
    expect(second.status(), await describe(second)).toBe(409);
  });
});

test.describe("Motoboy: navegação, foto e ocorrência em entrega individual", () => {
  test.beforeEach(wipeDeliveries);

  async function inTransitDelivery() {
    const central = await Api.as("central");
    const courier = await Api.as("courier");
    await courierOnline(courier);
    const d = await createDelivery(central);
    await central.post(`/deliveries/${d.id}/dispatch`, { mode: "single", courierId: "e2e-courier-1" });
    for (const s of ["ACCEPTED", "AT_STORE", "IN_TRANSIT"]) {
      const r = await setStatus(central, d.id, s);
      expect(r.status(), await describe(r)).toBe(200);
    }
    return { central, courier, d };
  }

  test("Navegação: só durante atendimento ativo; com GPS atual devolve rota até o cliente", async () => {
    const central = await Api.as("central");
    const courier = await Api.as("courier");
    await courierOnline(courier);
    const d = await createDelivery(central);
    await central.post(`/deliveries/${d.id}/dispatch`, { mode: "single", courierId: "e2e-courier-1" });
    await expectError(await courier.get(`/courier/deliveries/${d.id}/navigation`), 409);
    for (const s of ["ACCEPTED", "AT_STORE", "IN_TRANSIT"]) await setStatus(central, d.id, s);
    await courierOnline(courier);
    const nav = await courier.get(`/courier/deliveries/${d.id}/navigation`);
    expect(nav.status(), await describe(nav)).toBe(200);
    const body = await json(nav);
    expect(body.targetPosition.latitude).toBeCloseTo(d.customerLatitude, 3);
    expect(body.currentPosition.latitude).toBeCloseTo(BH_POSITION.latitude, 3);
  });

  test("Foto de comprovação: pedido de upload antes de IN_TRANSIT → 409", async () => {
    const central = await Api.as("central");
    const courier = await Api.as("courier");
    await courierOnline(courier);
    const d = await createDelivery(central);
    await central.post(`/deliveries/${d.id}/dispatch`, { mode: "single", courierId: "e2e-courier-1" });
    await setStatus(central, d.id, "ACCEPTED");
    const res = await courier.post(`/deliveries/${d.id}/evidence/upload-url`, { name: "foto.jpg", size: 1000, contentType: "image/jpeg" });
    expect(res.status(), await describe(res)).toBe(409);
  });

  test("Foto de comprovação: tipo, tamanho e nome inválidos → 400", async () => {
    const { courier, d } = await inTransitDelivery();
    const url = `/deliveries/${d.id}/evidence/upload-url`;
    await expectError(await courier.post(url, { name: "doc.pdf", size: 1000, contentType: "application/pdf" }), 400);
    await expectError(await courier.post(url, { name: "foto.jpg", size: 9 * 1024 * 1024, contentType: "image/jpeg" }), 400);
    await expectError(await courier.post(url, { name: "", size: 1000, contentType: "image/jpeg" }), 400);
    await expectError(await courier.post(url, { name: "foto.jpg", size: 0, contentType: "image/jpeg" }), 400);
  });

  test("Foto de comprovação: URL de upload (precisa do armazenamento de objetos)", async () => {
    const { courier, d } = await inTransitDelivery();
    const res = await courier.post(`/deliveries/${d.id}/evidence/upload-url`, { name: "foto.jpg", size: 2048, contentType: "image/jpeg" });
    if (!process.env.PRIVATE_OBJECT_DIR) {
      // Ambiente local: o armazenamento só existe no Replit (Fase 2 da migração). A API deve falhar de forma controlada.
      expect(res.status(), await describe(res)).toBe(503);
      test.info().annotations.push({ type: "limitação", description: "Armazenamento de fotos indisponível fora do Replit" });
      return;
    }
    expect(res.status(), await describe(res)).toBe(200);
    expect((await json(res)).uploadURL).toMatch(/^https?:\/\//);
  });

  test("Foto inexistente: GET /evidence → 404", async () => {
    const { central, d } = await inTransitDelivery();
    await expectError(await central.get(`/deliveries/${d.id}/evidence`), 404);
  });

  test("Ocorrência com motivo inativo/inventado → 400; motivo curto → 400", async () => {
    const { courier, d } = await inTransitDelivery();
    await expectError(await courier.post(`/courier/deliveries/${d.id}/unable`, { reason: "Motivo inventado" }), 400, "motivo ativo");
    await expectError(await courier.post(`/courier/deliveries/${d.id}/unable`, { reason: "x" }), 400);
  });

  test("Ocorrência em entrega já retirada → RETURNING_TO_STORE; Central confirma devolução → NOT_DELIVERED", async () => {
    const { central, courier, d } = await inTransitDelivery();
    const res = await courier.post(`/courier/deliveries/${d.id}/unable`, {
      reason: "Cliente ausente / não atende",
      observation: "Toquei o interfone 3 vezes.",
      ...BH_POSITION,
    });
    expect(res.status(), await describe(res)).toBe(200);
    expect(await json(res)).toMatchObject({ deliveryId: d.id, status: "RETURNING_TO_STORE", routeContinues: false, priority: false });
    await expectStatus(central, d.id, "RETURNING_TO_STORE");

    const alerts = await json(await central.get("/delivery-cancellations"));
    const alert = alerts.find((a: any) => a.deliveryId === d.id);
    expect(alert).toMatchObject({ status: "RETURNING_TO_STORE", reason: "Cliente ausente / não atende", observation: "Toquei o interfone 3 vezes." });

    await expectError(await central.post(`/delivery-cancellations/${alert.id}/action`, { action: "REQUEUE" }), 409);
    const confirm = await central.post(`/delivery-cancellations/${alert.id}/action`, { action: "CONFIRM_RETURN" });
    expect(confirm.status(), await describe(confirm)).toBeLessThan(300);
    await expectStatus(central, d.id, "NOT_DELIVERED");
    const [c] = await query("select status from couriers where id='e2e-courier-1'");
    expect(c.status).not.toBe("BUSY");
  });

  test("Ocorrência antes da retirada → AWAITING_COURIER; Central reenfileira (REQUEUE) ou encerra (CLOSE)", async () => {
    const central = await Api.as("central");
    const courier = await Api.as("courier");
    for (const action of ["REQUEUE", "CLOSE"] as const) {
      await courierOnline(courier);
      const d = await createDelivery(central);
      await central.post(`/deliveries/${d.id}/dispatch`, { mode: "single", courierId: "e2e-courier-1" });
      await setStatus(central, d.id, "ACCEPTED");
      const res = await courier.post(`/courier/deliveries/${d.id}/unable`, { reason: "Imprevisto pessoal" });
      expect(res.status(), await describe(res)).toBe(200);
      expect((await json(res)).status).toBe("AWAITING_COURIER");
      const alert = (await json(await central.get("/delivery-cancellations"))).find((a: any) => a.deliveryId === d.id);
      expect(alert.status).toBe("AWAITING_CENTRAL");
      const done = await central.post(`/delivery-cancellations/${alert.id}/action`, { action });
      expect(done.status(), await describe(done)).toBeLessThan(300);
      await expectStatus(central, d.id, action === "REQUEUE" ? "AWAITING_COURIER" : "NOT_DELIVERED");
      const again = await central.post(`/delivery-cancellations/${alert.id}/action`, { action });
      expect(again.status(), `ação repetida: ${await describe(again)}`).toBe(409);
    }
  });

  test("Acidente (moto com problema) aborta: entrega volta à fila como prioridade e motoboy fica OFFLINE", async () => {
    const { central, courier, d } = await inTransitDelivery();
    const res = await courier.post(`/courier/deliveries/${d.id}/unable`, { reason: "Moto com problema / acidente" });
    expect(res.status(), await describe(res)).toBe(200);
    expect(await json(res)).toMatchObject({ status: "AWAITING_COURIER", priority: true });
    const [c] = await query("select status from couriers where id='e2e-courier-1'");
    expect(c.status).toBe("OFFLINE");
    const alert = (await json(await central.get("/delivery-cancellations"))).find((a: any) => a.deliveryId === d.id);
    expect(alert).toMatchObject({ status: "ROUTE_ABORTED", priority: true });
  });

  test("Ocorrência em entrega de outro motoboy → 403 e em entrega não iniciada → 409", async () => {
    const central = await Api.as("central");
    const courier = await Api.as("courier");
    await setCourierStatus("e2e-courier-2", "AVAILABLE");
    const other = await createDelivery(central);
    await central.post(`/deliveries/${other.id}/dispatch`, { mode: "single", courierId: "e2e-courier-2" });
    await setStatus(central, other.id, "ACCEPTED");
    await expectError(await courier.post(`/courier/deliveries/${other.id}/unable`, { reason: "Imprevisto pessoal" }), 403);

    await courierOnline(courier);
    const offered = await createDelivery(central);
    await central.post(`/deliveries/${offered.id}/dispatch`, { mode: "single", courierId: "e2e-courier-1" });
    await expectError(await courier.post(`/courier/deliveries/${offered.id}/unable`, { reason: "Imprevisto pessoal" }), 409);
  });

  test("Ação de ocorrência inválida → 400 e ocorrência inexistente → 404", async () => {
    const central = await Api.as("central");
    await expectError(await central.post("/delivery-cancellations/e2e-x/action", { action: "APAGAR" }), 400);
    const res = await central.post("/delivery-cancellations/e2e-x/action", { action: "CLOSE" });
    expect(res.status(), await describe(res)).toBe(404);
  });
});
