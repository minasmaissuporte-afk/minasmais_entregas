import { test, expect } from "@playwright/test";
import { Api, describe, json } from "../../support/api.ts";
import { courierCities, stores } from "../../support/fixtures-data.ts";
import { courierOnline, createDelivery, deliveryInput, expectError, expectStatus, setStatus } from "../../support/helpers.ts";
import { query, setCourierStatus, wipeDeliveries } from "../../support/db.ts";

/**
 * Fluxo de novembro/2026: a entrega vai direto para os motoboys da cidade da filial
 * (quem aceitar primeiro leva), forma de pagamento, 4 etapas, reenvio com um clique
 * e relatórios por filial.
 */
test.describe("Fluxo da filial: despacho automático por cidade", () => {
  test.beforeEach(async () => {
    await wipeDeliveries();
    await query(`update couriers set city = $1 where id = 'e2e-courier-1'`, [stores.a.city]);
    await setCourierStatus("e2e-courier-1", "OFFLINE");
  });
  // Devolve a cidade de cada motoboy de teste ao valor da semente (outros arquivos dependem dela).
  test.afterAll(async () => {
    for (const [id, city] of Object.entries(courierCities)) {
      await query(`update couriers set city = $2 where id = $1`, [id, city]);
    }
  });

  test("Pagamento é obrigatório e fica gravado (dinheiro com troco)", async () => {
    const manager = await Api.as("manager");
    await expectError(await manager.post("/deliveries", deliveryInput({ paymentMethod: undefined })), 400, "pagamento");
    const cash = await createDelivery(manager, { paymentMethod: "CASH", changeFor: 100 });
    expect(cash.paymentMethod).toBe("CASH");
    expect(cash.changeFor).toBe(100);
    expect(cash.bringCardMachine).toBeNull();
    const card = await createDelivery(manager, { paymentMethod: "CARD", bringCardMachine: false });
    expect(card.paymentMethod).toBe("CARD");
    expect(card.bringCardMachine).toBe(false);
    expect(card.changeFor).toBeNull();
  });

  test("Entrega nova já vai para a fila dos motoboys da cidade", async () => {
    const manager = await Api.as("manager");
    const courier = await Api.as("courier");
    await courierOnline(courier);
    const d = await createDelivery(manager);
    expect(d.status).toBe("OFFERED");
    expect(d.courierId).toBeNull();
    expect(d.events.map((event: { kind: string }) => event.kind)).toEqual(expect.arrayContaining(["requested", "offered"]));
    const mine = await json(await courier.get("/deliveries"));
    expect(mine.some((item: { id: string }) => item.id === d.id)).toBe(true);

    // Motoboy de outra cidade não vê.
    await query(`update couriers set city = 'Contagem' where id = 'e2e-courier-1'`);
    const other = await json(await courier.get("/deliveries"));
    expect(other.some((item: { id: string }) => item.id === d.id)).toBe(false);
    await expectError(await setStatus(courier, d.id, "ACCEPTED"), 409, "outra cidade");
  });

  test("Quem aceita primeiro leva; o segundo recebe aviso", async () => {
    const manager = await Api.as("manager");
    const courier = await Api.as("courier");
    await courierOnline(courier);
    const d = await createDelivery(manager);
    const accepted = await setStatus(courier, d.id, "ACCEPTED");
    expect(accepted.status(), await describe(accepted)).toBe(200);
    expect((await json(accepted)).courierId).toBe("e2e-courier-1");
    // Simula um segundo toque depois que a entrega já foi aceita.
    await expectError(await setStatus(courier, d.id, "ACCEPTED"), 409, "aceitou esta entrega primeiro");
  });

  test("Chegada e retirada são um passo só (ACCEPTED → IN_TRANSIT)", async () => {
    const manager = await Api.as("manager");
    const courier = await Api.as("courier");
    await courierOnline(courier);
    const d = await createDelivery(manager);
    await setStatus(courier, d.id, "ACCEPTED");
    const picked = await setStatus(courier, d.id, "IN_TRANSIT");
    expect(picked.status(), await describe(picked)).toBe(200);
    await expectStatus(manager, d.id, "IN_TRANSIT");
  });

  test("Dispensar uma oferta aberta some só para este motoboy", async () => {
    const manager = await Api.as("manager");
    const courier = await Api.as("courier");
    await courierOnline(courier);
    const d = await createDelivery(manager);
    const declined = await courier.post(`/courier/deliveries/${d.id}/decline`);
    expect(declined.status(), await describe(declined)).toBe(204);
    const list = await json(await courier.get("/deliveries"));
    expect(list.some((item: { id: string }) => item.id === d.id)).toBe(false);
    await expectStatus(manager, d.id, "OFFERED");
  });

  test("Motoboy devolve → gerente reenvia com um clique → gerente cancela", async () => {
    const manager = await Api.as("manager");
    const courier = await Api.as("courier");
    await courierOnline(courier);
    const d = await createDelivery(manager);
    await setStatus(courier, d.id, "ACCEPTED");
    const unable = await courier.post(`/courier/deliveries/${d.id}/unable`, { reason: "Cliente ausente / não atende" });
    expect(unable.status(), await describe(unable)).toBeLessThan(300);
    await expectStatus(manager, d.id, "AWAITING_COURIER");

    const requeue = await manager.post(`/deliveries/${d.id}/dispatch`, { mode: "group" });
    expect(requeue.status(), await describe(requeue)).toBe(200);
    const requeued = await json(requeue);
    expect(requeued.status).toBe("OFFERED");
    expect(requeued.courierId).toBeNull();

    const cancel = await setStatus(manager, d.id, "CANCELLED", { note: "Cliente desistiu" });
    expect(cancel.status(), await describe(cancel)).toBe(200);
    expect((await json(cancel)).events.at(-1).label).toContain("Cancelada pela loja");
  });

  test("Gerente cancela entrega devolvida pelo motoboy (antes dava erro)", async () => {
    const manager = await Api.as("manager");
    const courier = await Api.as("courier");
    await courierOnline(courier);
    const d = await createDelivery(manager);
    await setStatus(courier, d.id, "ACCEPTED");
    await courier.post(`/courier/deliveries/${d.id}/unable`, { reason: "Endereço não encontrado" });
    const cancel = await setStatus(manager, d.id, "CANCELLED");
    expect(cancel.status(), await describe(cancel)).toBe(200);
  });

  test("Motivos de cancelamento: só os mais frequentes", async () => {
    await query(`update delivery_cancellation_reasons set active = (id in ('CLIENT_ABSENT','ADDRESS_NOT_FOUND','CUSTOMER_REFUSED','OTHER'))`);
    await query(`update delivery_cancellation_reasons set position = case id when 'CLIENT_ABSENT' then 0 when 'ADDRESS_NOT_FOUND' then 1 when 'CUSTOMER_REFUSED' then 2 when 'OTHER' then 3 else position end`);
    const reasons = await json(await (await Api.as("courier")).get("/delivery-cancellation-reasons"));
    expect(reasons.map((reason: { label: string }) => reason.label)).toEqual([
      "Cliente ausente / não atende",
      "Endereço não encontrado",
      "Cliente desistiu / recusou",
      "Outro motivo",
    ]);
  });

  test("Relatórios: etapas e macro por filial; gerente só a dele", async () => {
    const manager = await Api.as("manager");
    const courier = await Api.as("courier");
    await courierOnline(courier);
    const a = await createDelivery(manager);
    await createDelivery(manager);
    await setStatus(courier, a.id, "ACCEPTED");
    const managerReport = await json(await (await Api.as("admin")).get(`/reports/analytics?storeId=${stores.a.id}`));
    expect(managerReport.stores).toHaveLength(1);
    expect(managerReport.stores[0].storeId).toBe(stores.a.id);
    expect(managerReport.summary.requested).toBeGreaterThanOrEqual(1);
    expect(managerReport.summary.accepted).toBeGreaterThanOrEqual(1);
    const adminReport = await json(await (await Api.as("admin")).get("/reports/analytics"));
    expect(Array.isArray(adminReport.stores)).toBe(true);
    expect(adminReport.summary).toHaveProperty("pickedUp");
  });

  test("Relatórios: tempo médio de cada etapa, por filial e por motoboy", async () => {
    const manager = await Api.as("manager");
    const courier = await Api.as("courier");
    await courierOnline(courier);
    const d = await createDelivery(manager);
    await setStatus(courier, d.id, "ACCEPTED");
    await setStatus(courier, d.id, "IN_TRANSIT");
    // Conclusão direto no banco (sem foto) com horários conhecidos: aceite +5 min, retirada +15, conclusão +35.
    await query(`update deliveries set status = 'COMPLETED', created_at = now() - interval '35 minutes' where id = $1`, [d.id]);
    await query(`update delivery_events set timestamp = now() - interval '30 minutes' where delivery_id = $1 and kind = 'accepted'`, [d.id]);
    await query(`update delivery_events set timestamp = now() - interval '20 minutes' where delivery_id = $1 and kind = 'in_transit'`, [d.id]);
    await query(`insert into delivery_events (id, delivery_id, label, kind, actor, timestamp) values ($1, $2, 'Entrega concluída', 'completed', 'Motoboy', now())`, [`e2e-ev-${d.id}`, d.id]);
    const report = await json(await (await Api.as("admin")).get(`/reports/analytics?storeId=${stores.a.id}`));
    expect(report.summary.averageAcceptMinutes).toBeCloseTo(5, 0);
    expect(report.summary.averageStoreMinutes).toBeCloseTo(10, 0);
    expect(report.summary.averageDeliveryMinutes).toBeCloseTo(20, 0);
    expect(report.summary.averageTotalMinutes).toBeCloseTo(35, 0);
    expect(report.stores[0].averageTotalMinutes).toBeCloseTo(35, 0);
    const me = report.couriers.find((item: { courierId: string }) => item.courierId === "e2e-courier-1");
    expect(me.averagePickupMinutes).toBeCloseTo(10, 0);
    expect(me.averageDeliveryMinutes).toBeCloseTo(20, 0);
  });

  test("Contabilidade da filial: pedidos, pago e a pagar; gerente marca como pago", async () => {
    const manager = await Api.as("manager");
    const courier = await Api.as("courier");
    for (let i = 0; i < 2; i += 1) {
      await courierOnline(courier);
      const d = await createDelivery(manager);
      await setStatus(courier, d.id, "ACCEPTED");
      await setStatus(courier, d.id, "IN_TRANSIT");
      await query(`update deliveries set status = 'COMPLETED' where id = $1`, [d.id]);
      await query(`update couriers set status = 'AVAILABLE', current_delivery_code = null where id = 'e2e-courier-1'`);
    }
    await createDelivery(manager);
    const fee = stores.a.feeCents / 100;
    const before = await json(await manager.get("/reports/store-accounting"));
    expect(before).toMatchObject({ storeId: stores.a.id, totalDeliveries: 3, completedDeliveries: 2, amountTotal: fee * 2, amountPaid: 0, amountToPay: fee * 2 });
    expect(before.couriers[0]).toMatchObject({ courierId: "e2e-courier-1", completedDeliveries: 2, amountToPay: fee * 2 });

    const paid = await manager.post("/reports/store-accounting/pay", { courierId: "e2e-courier-1" });
    expect(paid.status(), await describe(paid)).toBe(200);
    expect(await json(paid)).toEqual({ paidDeliveries: 2, amount: fee * 2 });

    const after = await json(await manager.get("/reports/store-accounting"));
    expect(after).toMatchObject({ amountPaid: fee * 2, amountToPay: 0 });
    expect(after.deliveries.filter((item: { paidAt: string | null }) => item.paidAt)).toHaveLength(2);
    // Pagar de novo não paga nada em dobro.
    expect(await json(await manager.post("/reports/store-accounting/pay", { courierId: "e2e-courier-1" }))).toEqual({ paidDeliveries: 0, amount: 0 });
  });

  test("Motoboy em entrega aceita outra: entregas separadas e ordem sugerida", async () => {
    const manager = await Api.as("manager");
    const courier = await Api.as("courier");
    await courierOnline(courier);
    const first = await createDelivery(manager);
    expect((await setStatus(courier, first.id, "ACCEPTED")).status()).toBe(200);
    expect((await setStatus(courier, first.id, "IN_TRANSIT")).status()).toBe(200);
    const second = await createDelivery(manager);
    const accepted = await setStatus(courier, second.id, "ACCEPTED");
    expect(accepted.status(), await describe(accepted)).toBe(200);
    expect((await json(accepted)).courierId).toBe("e2e-courier-1");

    // Nada de rota juntada: cada entrega segue com os próprios botões.
    const routes = await json(await courier.get("/courier/routes"));
    expect(routes.filter((item: { status: string }) => item.status === "ACCEPTED")).toHaveLength(0);
    const plan = (await json(await courier.get("/courier/plan"))).plan;
    expect(plan, "ordem sugerida").toBeTruthy();
    expect(plan.stops.filter((stop: { deliveryId: string }) => stop.deliveryId === first.id).map((stop: { kind: string }) => stop.kind)).toEqual(["delivery"]);
    expect(plan.stops.filter((stop: { deliveryId: string }) => stop.deliveryId === second.id).map((stop: { kind: string }) => stop.kind)).toEqual(["pickup", "delivery"]);

    // A segunda pode ser retirada antes de concluir a primeira.
    expect((await setStatus(courier, second.id, "IN_TRANSIT")).status()).toBe(200);
    // Concluir uma (Central, sem foto) não deixa o motoboy disponível: ainda tem a outra.
    await setStatus(await Api.as("central"), first.id, "COMPLETED");
    const [c] = await query("select status from couriers where id = 'e2e-courier-1'");
    expect(c.status).toBe("BUSY");
    expect((await json(await courier.get("/courier/plan"))).plan).toBeNull();
  });

  test("Convite de motoboy exige a cidade", async () => {
    await expectError(
      await (await Api.as("admin")).post("/access/invites", {
        email: "e2e-sem-cidade@example.com",
        name: "E2E Sem Cidade",
        role: "COURIER",
        redirectTo: "http://localhost:5173/aceitar-convite",
      }),
      400,
      "cidade",
    );
  });
});
