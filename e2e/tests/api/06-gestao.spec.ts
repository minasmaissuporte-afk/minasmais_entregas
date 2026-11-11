import { test, expect } from "@playwright/test";
import { Api, describe, json } from "../../support/api.ts";
import { stores } from "../../support/fixtures-data.ts";
import { createDelivery, expectError, setStatus } from "../../support/helpers.ts";
import { demo, query, setCourierStatus, wipeDeliveries } from "../../support/db.ts";

const TEMP = "e2e-user-temp";

test.describe("Gestão de acessos (Admin)", () => {
  test.beforeEach(async () => {
    await query(`delete from app_users where id = $1`, [TEMP]);
    await query(
      `insert into app_users (id, email, name, role) values ($1, 'e2e-temp@example.com', 'E2E Conta Nova', 'PENDING')`,
      [TEMP],
    );
  });
  test.afterAll(async () => {
    await query(`delete from app_users where id = $1`, [TEMP]);
    await query(`delete from couriers where id like 'e2e-%' and id not in ('e2e-courier-1','e2e-courier-2')`);
  });

  test("Lista todas as contas com papel, loja e motoboy", async () => {
    const list = await json(await (await Api.as("admin")).get("/access/users"));
    const byId = Object.fromEntries(list.map((u: any) => [u.id, u]));
    expect(byId["e2e-user-manager"]).toMatchObject({ role: "STORE_MANAGER", storeId: stores.a.id });
    expect(byId["e2e-user-courier"]).toMatchObject({ role: "COURIER", courierId: "e2e-courier-1" });
    expect(byId[TEMP].role).toBe("PENDING");
  });

  test("Aprovar como atendente exige filial existente", async () => {
    const admin = await Api.as("admin");
    await expectError(await admin.patch(`/access/users/${TEMP}`, { role: "STORE_STAFF" }), 400, "unidade");
    await expectError(await admin.patch(`/access/users/${TEMP}`, { role: "STORE_STAFF", storeId: "e2e-nao-existe" }), 400, "não encontrada");
    const ok = await admin.patch(`/access/users/${TEMP}`, { role: "STORE_STAFF", storeId: stores.b.id });
    expect(ok.status(), await describe(ok)).toBe(200);
    expect(await json(ok)).toMatchObject({ role: "STORE_STAFF", storeId: stores.b.id, courierId: null });
  });

  test("Aprovar como motoboy exige nome; vincula a cadastro existente ou cria um novo", async () => {
    const admin = await Api.as("admin");
    await expectError(await admin.patch(`/access/users/${TEMP}`, { role: "COURIER" }), 400, "nome");
    await expectError(await admin.patch(`/access/users/${TEMP}`, { role: "COURIER", name: "E2E X", courierId: "e2e-nao-existe" }), 400);
    await query(`insert into couriers (id, name, initials, status) values ('e2e-courier-temp', 'E2E Temp', 'ET', 'OFFLINE')`);
    const linked = await admin.patch(`/access/users/${TEMP}`, {
      role: "COURIER",
      name: "  E2E Lúcia Ávila  ",
      phone: "(31) 97777-0000",
      courierId: "e2e-courier-temp",
    });
    expect(linked.status(), await describe(linked)).toBe(200);
    expect(await json(linked)).toMatchObject({ role: "COURIER", courierId: "e2e-courier-temp", name: "E2E Lúcia Ávila" });
    const [courier] = await query(`select name, initials, phone from couriers where id='e2e-courier-temp'`);
    expect(courier).toMatchObject({ name: "E2E Lúcia Ávila", phone: "(31) 97777-0000" });
    expect(courier.initials).toMatch(/^[A-ZÁ]{1,3}$/);
  });

  test("Aprovar como Central zera loja e motoboy", async () => {
    const admin = await Api.as("admin");
    const res = await admin.patch(`/access/users/${TEMP}`, { role: "CENTRAL", storeId: stores.a.id });
    expect(await json(res)).toMatchObject({ role: "CENTRAL", storeId: null, courierId: null });
  });

  test("Papel inválido → 400; conta inexistente → 404", async () => {
    const admin = await Api.as("admin");
    await expectError(await admin.patch(`/access/users/${TEMP}`, { role: "DONO" }), 400);
    await expectError(await admin.patch("/access/users/e2e-nao-existe", { role: "CENTRAL" }), 404);
    await expectError(await admin.delete("/access/users/e2e-nao-existe"), 404);
  });

  test("Admin não remove o próprio acesso nem exclui a própria conta", async () => {
    const admin = await Api.as("admin");
    await expectError(await admin.patch("/access/users/e2e-user-admin", { role: "CENTRAL" }), 400, "próprio acesso");
    await expectError(await admin.delete("/access/users/e2e-user-admin"), 400);
    expect((await json(await admin.get("/me"))).role).toBe("ADMIN");
  });

  test("Excluir conta remove o perfil (204) e mantém as entregas da filial", async () => {
    const admin = await Api.as("admin");
    await admin.patch(`/access/users/${TEMP}`, { role: "STORE_STAFF", storeId: stores.a.id });
    const d = await createDelivery(await Api.as("central"), { storeId: stores.a.id });
    const res = await admin.delete(`/access/users/${TEMP}`);
    expect(res.status(), await describe(res)).toBe(204);
    expect(await query(`select 1 from app_users where id=$1`, [TEMP])).toEqual([]);
    expect(await query(`select 1 from deliveries where id=$1`, [d.id])).toHaveLength(1);
  });

  test("Motoboy com entrega em andamento não pode ser rebaixado (409)", async () => {
    await wipeDeliveries();
    const central = await Api.as("central");
    await setCourierStatus("e2e-courier-2", "AVAILABLE");
    const d = await createDelivery(central);
    await central.post(`/deliveries/${d.id}/dispatch`, { mode: "single", courierId: "e2e-courier-2" });
    await setStatus(central, d.id, "ACCEPTED");
    const admin = await Api.as("admin");
    await expectError(await admin.patch("/access/users/e2e-user-courier-2", { role: "CENTRAL" }), 409);
    await expectError(await admin.delete("/access/users/e2e-user-courier-2"), 409);
    await wipeDeliveries();
  });
});

test.describe("Motivos de ocorrência", () => {
  let original: any[] = [];
  test.beforeAll(async () => {
    original = await json(await (await Api.as("central")).get("/delivery-cancellation-reasons"));
  });
  test.afterAll(async () => {
    const res = await (await Api.as("admin")).put("/delivery-cancellation-reasons", { reasons: original });
    expect(res.status(), `restaurar motivos: ${await describe(res)}`).toBe(200);
  });

  test("Central e motoboy leem os motivos em ordem", async () => {
    for (const role of ["central", "courier"] as const) {
      const list = await json(await (await Api.as(role)).get("/delivery-cancellation-reasons"));
      expect(list.length).toBeGreaterThan(0);
      const positions = list.map((r: any) => r.position);
      expect([...positions].sort((a, b) => a - b)).toEqual(positions);
    }
  });

  test("Central desativa e reordena motivos: a lista passa a ter só os ativos, na nova ordem", async () => {
    const central = await Api.as("central");
    const changed = [...original].reverse().map((r) => ({ ...r, active: r.id !== "PERSONAL_ISSUE" }));
    const res = await central.put("/delivery-cancellation-reasons", { reasons: changed });
    expect(res.status(), await describe(res)).toBe(200);
    const list = await json(await central.get("/delivery-cancellation-reasons"));
    expect(list.map((r: any) => r.id)).not.toContain("PERSONAL_ISSUE");
    expect(list.map((r: any) => r.id)).toEqual(changed.filter((r) => r.active).map((r) => r.id));
  });

  test("Motivo de acidente não pode ser desativado (400)", async () => {
    const central = await Api.as("central");
    const changed = original.map((r) => ({ ...r, active: r.id !== "MOTORCYCLE_ISSUE" }));
    await expectError(await central.put("/delivery-cancellation-reasons", { reasons: changed }), 400, "acidente");
  });

  test("Lista vazia, rótulo vazio ou repetido → 400", async () => {
    const central = await Api.as("central");
    await expectError(await central.put("/delivery-cancellation-reasons", { reasons: [] }), 400);
    await expectError(
      await central.put("/delivery-cancellation-reasons", { reasons: original.map((r, i) => (i === 0 ? { ...r, label: "   " } : r)) }),
      400,
    );
    await expectError(
      await central.put("/delivery-cancellation-reasons", {
        reasons: original.map((r, i) => (i === 1 ? { ...r, label: original[0].label } : r)),
      }),
      400,
    );
  });
});

test.describe("Relatórios e painel", () => {
  test.beforeAll(async () => {
    await wipeDeliveries();
    const central = await Api.as("central");
    await setCourierStatus("e2e-courier-1", "AVAILABLE");
    const done = await createDelivery(central, { storeId: stores.a.id });
    await central.post(`/deliveries/${done.id}/dispatch`, { mode: "single", courierId: "e2e-courier-1" });
    for (const s of ["ACCEPTED", "TO_STORE", "AT_STORE", "IN_TRANSIT", "COMPLETED"]) await setStatus(central, done.id, s);
    const cancelled = await createDelivery(central, { storeId: stores.b.id });
    await setStatus(central, cancelled.id, "CANCELLED");
    await createDelivery(central, { storeId: stores.a.id });
  });

  test("Painel da Central conta entregas por status e motoboys", async () => {
    const res = await (await Api.as("central")).get("/dashboard/summary");
    expect(res.status(), await describe(res)).toBe(200);
    const s = await json(res);
    expect(s.completed).toBeGreaterThanOrEqual(1);
    expect(s.cancelled).toBeGreaterThanOrEqual(1);
    expect(s.requested).toBeGreaterThanOrEqual(1);
    expect(s.totalCouriers).toBe(s.availableCouriers + s.busyCouriers + s.offlineCouriers);
  });

  test("Relatório do dia: total, concluídas, canceladas e valor do motoboy", async () => {
    const today = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date());
    const res = await (await Api.as("admin")).get(`/reports/analytics?from=${today}&to=${today}`);
    expect(res.status(), await describe(res)).toBe(200);
    const r = await json(res);
    const e2eRows = r.deliveries.filter((d: any) => d.storeName.startsWith("E2E"));
    expect(e2eRows.length).toBeGreaterThanOrEqual(3);
    expect(r.summary.completed).toBeGreaterThanOrEqual(1);
    expect(r.summary.cancelled).toBeGreaterThanOrEqual(1);
    expect(r.summary.courierAmount).toBeGreaterThanOrEqual(stores.a.feeCents / 100);
    const completedRow = e2eRows.find((d: any) => d.status === "COMPLETED");
    expect(completedRow.storeArrivedAt).toBeTruthy();
    expect(completedRow.completedAt).toBeTruthy();
    expect(r.couriers.find((c: any) => c.courierId === "e2e-courier-1")?.completedDeliveries).toBeGreaterThanOrEqual(1);
  });

  test("Filtros do relatório: filial, motoboy e status", async () => {
    const admin = await Api.as("admin");
    const byStore = await json(await admin.get(`/reports/analytics?storeId=${stores.b.id}`));
    expect(byStore.deliveries.every((d: any) => d.storeName === stores.b.name)).toBe(true);
    const byStatus = await json(await admin.get(`/reports/analytics?status=COMPLETED`));
    expect(byStatus.deliveries.every((d: any) => d.status === "COMPLETED")).toBe(true);
    const byCourier = await json(await admin.get(`/reports/analytics?courierId=e2e-courier-1`));
    expect(byCourier.deliveries.length).toBeGreaterThanOrEqual(1);
  });

  test("Período futuro não traz entregas; data inválida → 400", async () => {
    const admin = await Api.as("admin");
    const future = await json(await admin.get(`/reports/analytics?from=2099-01-01&to=2099-01-31`));
    expect(future.summary.total).toBe(0);
    await expectError(await admin.get(`/reports/analytics?from=31/12/2026`), 400);
  });

  test("Gerente: relatório só da própria filial; pedir outra filial → 403", async () => {
    const manager = await Api.as("manager");
    const own = await json(await manager.get("/reports/analytics"));
    expect(own.deliveries.every((d: any) => d.storeName === stores.a.name)).toBe(true);
    await expectError(await manager.get(`/reports/analytics?storeId=${stores.b.id}`), 403, "própria filial");
  });
});

test.describe("Notificações push (configuração local)", () => {
  test("/push/config informa se o push está ligado", async () => {
    const cfg = await json(await (await Api.as("courier")).get("/push/config"));
    expect(cfg.enabled).toBe(Boolean(process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY));
  });

  test("Inscrição web push: corpo inválido → 400; válido sem VAPID → 503", async () => {
    const courier = await Api.as("courier");
    await expectError(await courier.post("/push/subscription", { endpoint: "nao-e-url" }), 400);
    const res = await courier.post("/push/subscription", {
      endpoint: "https://fcm.googleapis.com/fcm/send/e2e-teste-123",
      p256dh: "BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8QcYP7DkM",
      auth: "tBHItJI5svbpez7KI4CCXg",
    });
    if (process.env.VAPID_PUBLIC_KEY) expect(res.status(), await describe(res)).toBeLessThan(300);
    else expect(res.status(), await describe(res)).toBe(503);
  });

  test("Token nativo (Android): vazio → 400; sem Firebase → 503", async () => {
    const courier = await Api.as("courier");
    await expectError(await courier.post("/push/native-token", { token: "" }), 400);
    const res = await courier.post("/push/native-token", { token: "e2e-token-android" });
    if (process.env.FIREBASE_SERVICE_ACCOUNT_JSON) expect(res.status(), await describe(res)).toBeLessThan(300);
    else expect(res.status(), await describe(res)).toBe(503);
  });
});

test.describe("Limpeza dos dados de demonstração", () => {
  test("Confirmação errada → 400", async () => {
    await expectError(await (await Api.as("admin")).post("/admin/demo-data/cleanup", { confirmation: "SIM" }), 400);
  });

  test("Remove só os registros de demonstração e preserva os demais", async () => {
    await query(`insert into stores (id, name, code, city, address, delivery_fee_cents) values
      ('${demo.stores[0]}', 'Demo Centro', 'DEMO-C', 'Belo Horizonte', 'Rua Demo, 1', 500),
      ('${demo.stores[1]}', 'Demo Contagem', 'DEMO-K', 'Contagem', 'Rua Demo, 2', 500) on conflict do nothing`);
    await query(`insert into couriers (id, name, initials, status) values
      ('${demo.couriers[0]}', 'Ana Demo', 'AD', 'OFFLINE'), ('${demo.couriers[1]}', 'Bruno Demo', 'BD', 'OFFLINE') on conflict do nothing`);
    await query(`insert into deliveries (id, code, customer_name, destination, order_number, store_id, status) values
      ('${demo.deliveries[0]}', 'MM-DEMO1', 'Cliente Demo', 'Rua Demo, 10', 'D1', '${demo.stores[0]}', 'REQUESTED'),
      ('${demo.deliveries[1]}', 'MM-DEMO2', 'Cliente Demo 2', 'Rua Demo, 20', 'D2', '${demo.stores[1]}', 'COMPLETED')
      on conflict do nothing`);
    const real = await createDelivery(await Api.as("central"), { storeId: stores.a.id });

    const res = await (await Api.as("admin")).post("/admin/demo-data/cleanup", { confirmation: "REMOVE_DEMO_RECORDS" });
    expect(res.status(), await describe(res)).toBe(200);
    const summary = await json(res);
    expect(summary.removedDeliveries).toBeGreaterThanOrEqual(2);
    expect(summary.removedCouriers).toBeGreaterThanOrEqual(2);
    expect(summary.removedStores).toBeGreaterThanOrEqual(2);
    expect(await query(`select id from stores where id = any($1)`, [demo.stores])).toEqual([]);
    expect(await query(`select id from deliveries where id = $1`, [real.id])).toHaveLength(1);
    expect(await query(`select id from stores where id = $1`, [stores.a.id])).toHaveLength(1);
  });
});
