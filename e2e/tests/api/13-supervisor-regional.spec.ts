import { test, expect } from "@playwright/test";
import { Api, describe, json } from "../../support/api.ts";
import { courierCities, stores } from "../../support/fixtures-data.ts";
import { createDelivery, deliveryInput, setStatus } from "../../support/helpers.ts";
import { query, wipeDeliveries } from "../../support/db.ts";

/**
 * Supervisor regional: vê e opera só as filiais escolhidas para ele (aqui, só a filial B,
 * de Contagem). Motoboys: os das cidades dessas filiais. Relatórios: só dessas filiais.
 */
test.describe("Supervisor regional: só as filiais dele", () => {
  test.beforeEach(wipeDeliveries);
  test.afterAll(async () => {
    for (const [id, city] of Object.entries(courierCities)) {
      await query(`update couriers set city = $2 where id = $1`, [id, city]);
    }
  });

  test("Filiais, entregas, detalhe e criação respeitam as filiais do supervisor", async () => {
    const supervisor = await Api.as("supervisor");
    const central = await Api.as("central");
    const inA = await createDelivery(central, { storeId: stores.a.id });
    const inB = await createDelivery(central, { storeId: stores.b.id });

    const storeIds = (await json(await supervisor.get("/stores"))).map((store: { id: string }) => store.id);
    expect(storeIds).toEqual([stores.b.id]);

    const listed = (await json(await supervisor.get("/deliveries"))).map((item: { id: string }) => item.id);
    expect(listed).toContain(inB.id);
    expect(listed).not.toContain(inA.id);
    expect((await supervisor.get(`/deliveries/${inA.id}`)).status()).toBe(403);
    expect((await supervisor.get(`/deliveries/${inB.id}`)).status()).toBe(200);

    expect((await supervisor.post("/deliveries", deliveryInput({ storeId: stores.a.id }))).status()).toBe(403);
    const created = await supervisor.post("/deliveries", deliveryInput({ storeId: stores.b.id }));
    expect(created.status(), await describe(created)).toBe(201);
    const createdBody = await json(created);
    expect(createdBody.events[0].actor).toBe("Supervisor regional");
  });

  test("Opera (reenvia, edita, cancela) só nas filiais dele", async () => {
    const supervisor = await Api.as("supervisor");
    const central = await Api.as("central");
    const inA = await createDelivery(central, { storeId: stores.a.id });
    const inB = await createDelivery(central, { storeId: stores.b.id });

    expect((await supervisor.post(`/deliveries/${inA.id}/dispatch`, { mode: "group" })).status()).toBe(404);
    expect((await supervisor.patch(`/deliveries/${inA.id}`, { notes: "Teste" })).status()).toBe(403);
    expect((await setStatus(supervisor, inA.id, "CANCELLED")).status()).toBe(403);

    const edit = await supervisor.patch(`/deliveries/${inB.id}`, { notes: "Editado pelo supervisor" });
    expect(edit.status(), await describe(edit)).toBe(200);
    const cancel = await setStatus(supervisor, inB.id, "CANCELLED");
    expect(cancel.status(), await describe(cancel)).toBe(200);
  });

  test("Motoboys: só os das cidades das filiais dele", async () => {
    const supervisor = await Api.as("supervisor");
    const couriers = (await json(await supervisor.get("/couriers"))).map((courier: { id: string }) => courier.id);
    expect(couriers).toContain("e2e-courier-c");
    expect(couriers).not.toContain("e2e-courier-1");
    expect(couriers).not.toContain("e2e-courier-b");
    const summary = await json(await supervisor.get("/dashboard/summary"));
    expect(summary.totalCouriers).toBe(1);
  });

  test("Relatórios e contabilidade: só as filiais dele", async () => {
    const supervisor = await Api.as("supervisor");
    const central = await Api.as("central");
    await createDelivery(central, { storeId: stores.a.id });
    await createDelivery(central, { storeId: stores.b.id });

    const report = await supervisor.get("/reports/analytics");
    expect(report.status(), await describe(report)).toBe(200);
    const body = await json(report);
    expect(JSON.stringify(body)).toContain(stores.b.name);
    expect(JSON.stringify(body)).not.toContain(stores.a.name);
    expect((await supervisor.get(`/reports/analytics?storeId=${stores.a.id}`)).status()).toBe(403);

    expect((await supervisor.get(`/reports/store-accounting?storeId=${stores.b.id}`)).status()).toBe(200);
    expect((await supervisor.get(`/reports/store-accounting?storeId=${stores.a.id}`)).status()).not.toBe(200);

    const summary = await json(await supervisor.get("/dashboard/summary"));
    expect(summary.requested).toBe(1);
  });

  test("Administrador cadastra supervisor com filiais; perfis antigos não existem mais", async () => {
    const admin = await Api.as("admin");
    const [pending] = await query(`select id from app_users where email = 'e2e-pendente@example.com'`);
    const noStores = await admin.patch(`/access/users/${pending.id}`, { role: "REGIONAL_SUPERVISOR", storeIds: [] });
    expect(noStores.status()).toBe(400);
    expect((await json(noStores)).error).toContain("filial");

    const saved = await admin.patch(`/access/users/${pending.id}`, { role: "REGIONAL_SUPERVISOR", storeIds: [stores.a.id, stores.b.id] });
    expect(saved.status(), await describe(saved)).toBe(200);
    expect((await json(saved)).supervisedStoreIds.sort()).toEqual([stores.a.id, stores.b.id].sort());
    const listed = (await json(await admin.get("/access/users"))).find((user: { id: string }) => user.id === pending.id);
    expect(listed.supervisedStoreIds.sort()).toEqual([stores.a.id, stores.b.id].sort());

    // Trocar de perfil apaga as filiais do supervisor.
    expect((await admin.patch(`/access/users/${pending.id}`, { role: "PENDING" })).status()).toBe(200);
    expect(await query(`select 1 from supervisor_stores where app_user_id = $1`, [pending.id])).toHaveLength(0);

    for (const role of ["CENTRAL", "STORE_STAFF"]) {
      expect((await admin.patch(`/access/users/${pending.id}`, { role })).status(), role).toBe(400);
    }
    // O administrador não tira o próprio acesso de administração.
    const [me] = await query(`select id from app_users where email = 'e2e-admin@example.com'`);
    expect((await admin.patch(`/access/users/${me.id}`, { role: "REGIONAL_SUPERVISOR", storeIds: [stores.a.id] })).status()).toBe(400);
  });
});
