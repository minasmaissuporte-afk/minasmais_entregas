import { test, expect } from "@playwright/test";
import { Api, describe, json } from "../../support/api.ts";
import { courierCities, stores } from "../../support/fixtures-data.ts";
import { courierOnline, createDelivery } from "../../support/helpers.ts";
import { query, wipeDeliveries } from "../../support/db.ts";

/**
 * Dispensar oferta: some só para quem dispensou. Quando todos os motoboys online da cidade
 * dispensam, a entrega volta para a filial (AWAITING_COURIER) e o gerente reenvia para a fila.
 */
test.describe("Dispensar: volta para a filial quando todos dispensam", () => {
  test.beforeEach(async () => {
    await wipeDeliveries();
    // Só os motoboys A e B online, ambos em Belo Horizonte (cidade da filial A).
    await query(`update couriers set status = 'OFFLINE' where id like 'e2e-%'`);
    await query(`update couriers set city = $1 where id in ('e2e-courier-1', 'e2e-courier-b')`, [stores.a.city]);
  });
  test.afterAll(async () => {
    for (const [id, city] of Object.entries(courierCities)) {
      await query(`update couriers set city = $2 where id = $1`, [id, city]);
    }
  });

  test("Um dispensa: continua para os outros; todos dispensam: volta para a filial e o gerente reenvia", async () => {
    const manager = await Api.as("manager");
    const courierA = await Api.as("courier");
    const courierB = await Api.as("courierB");
    await courierOnline(courierA);
    await courierOnline(courierB);
    // Nenhum outro motoboy (fora dos de teste) pode estar online no banco local.
    await query(`update couriers set status = 'OFFLINE' where id not like 'e2e-%'`);

    const d = await createDelivery(manager);
    expect(d.status).toBe("OFFERED");

    const declineA = await courierA.post(`/courier/deliveries/${d.id}/decline`);
    expect(declineA.status(), await describe(declineA)).toBe(204);
    let current = await json(await manager.get(`/deliveries/${d.id}`));
    expect(current.status, "ainda há um motoboy online que não dispensou").toBe("OFFERED");
    expect((await json(await courierA.get("/deliveries"))).some((item: { id: string }) => item.id === d.id)).toBe(false);
    expect((await json(await courierB.get("/deliveries"))).some((item: { id: string }) => item.id === d.id)).toBe(true);

    const declineB = await courierB.post(`/courier/deliveries/${d.id}/decline`);
    expect(declineB.status(), await describe(declineB)).toBe(204);
    current = await json(await manager.get(`/deliveries/${d.id}`));
    expect(current.status).toBe("AWAITING_COURIER");
    expect(current.courierId).toBeNull();
    const returned = current.events.find((event: { kind: string }) => event.kind === "declined_by_all");
    expect(returned?.label).toContain("dispensaram; voltou para a filial");
    expect((await json(await courierB.get("/deliveries"))).some((item: { id: string }) => item.id === d.id)).toBe(false);

    // Gerente reenvia: volta para a fila e quem tinha dispensado vê de novo.
    const requeue = await manager.post(`/deliveries/${d.id}/dispatch`, { mode: "group" });
    expect(requeue.status(), await describe(requeue)).toBe(200);
    expect((await json(await manager.get(`/deliveries/${d.id}`))).status).toBe("OFFERED");
    expect((await json(await courierA.get("/deliveries"))).some((item: { id: string }) => item.id === d.id)).toBe(true);
    expect((await json(await courierB.get("/deliveries"))).some((item: { id: string }) => item.id === d.id)).toBe(true);
  });

  test("Motoboy offline ou de outra cidade não segura a entrega na fila", async () => {
    const manager = await Api.as("manager");
    const courierA = await Api.as("courier");
    await courierOnline(courierA);
    await query(`update couriers set status = 'OFFLINE' where id <> 'e2e-courier-1'`);
    // Motoboy C (Contagem) online não conta para filial de Belo Horizonte.
    await query(`update couriers set status = 'AVAILABLE', city = 'Contagem' where id = 'e2e-courier-c'`);

    const d = await createDelivery(manager);
    expect((await courierA.post(`/courier/deliveries/${d.id}/decline`)).status()).toBe(204);
    const current = await json(await manager.get(`/deliveries/${d.id}`));
    expect(current.status).toBe("AWAITING_COURIER");
  });
});
