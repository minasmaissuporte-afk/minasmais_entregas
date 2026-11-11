import { test, expect } from "@playwright/test";
import { Api, describe, json } from "../../support/api.ts";
import { stores } from "../../support/fixtures-data.ts";
import { createDelivery, deliveryInput, expectError, expectStatus, setStatus } from "../../support/helpers.ts";
import { query, setCourierStatus, wipeDeliveries } from "../../support/db.ts";

test.describe("Entregas: criação e validação", () => {
  test.beforeAll(wipeDeliveries);

  test("Central cria entrega: código MM-XXXXXX, status REQUESTED, valor = tarifa da filial, evento inicial", async () => {
    const central = await Api.as("central");
    const delivery = await createDelivery(central, { storeId: stores.a.id, deliveryAmount: 999 });
    expect(delivery.code).toMatch(/^MM-[0-9A-F]{6}$/);
    expect(delivery).toMatchObject({
      status: "REQUESTED",
      storeId: stores.a.id,
      storeName: stores.a.name,
      deliveryAmount: stores.a.feeCents / 100, // ignora o deliveryAmount enviado
      priority: "normal",
      courierId: null,
      evidenceAvailable: false,
    });
    expect(delivery.events.length).toBeGreaterThanOrEqual(1);
    expect(delivery.customerName).toContain("Conceição");
  });

  test("Campos de texto chegam aparados (trim) e telefone vazio vira null", async () => {
    const central = await Api.as("central");
    const delivery = await createDelivery(central, {
      customerName: "  E2E Cliente Com Espaços  ",
      orderNumber: "  PED-TRIM  ",
      customerPhone: "   ",
      notes: "   ",
    });
    expect(delivery.customerName).toBe("E2E Cliente Com Espaços");
    expect(delivery.orderNumber).toBe("PED-TRIM");
    expect(delivery.customerPhone).toBeNull();
    expect(delivery.notes).toBeNull();
  });

  test("Entrega urgente é aceita e entrega sem coordenadas também", async () => {
    const central = await Api.as("central");
    const urgent = await createDelivery(central, { priority: "urgent" });
    expect(urgent.priority).toBe("urgent");
    const noCoords = await createDelivery(central, { customerLatitude: null, customerLongitude: null });
    expect(noCoords.customerLatitude).toBeNull();
  });

  const invalid: [string, Record<string, unknown>, number, string?][] = [
    ["nome com 1 letra", { customerName: "A" }, 400],
    ["destino curto", { destination: "Rua" }, 400],
    ["pedido vazio", { orderNumber: "" }, 400],
    ["prioridade desconhecida", { priority: "altissima" }, 400],
    ["latitude sem longitude", { customerLatitude: -19.9, customerLongitude: null }, 400, "juntas"],
    ["latitude inválida", { customerLatitude: 120 }, 400],
    ["filial inexistente", { storeId: "e2e-nao-existe" }, 400, "Loja não encontrada"],
    ["filial inativa", { storeId: stores.inactive.id }, 400, "inativa"],
    ["filial sem tarifa configurada", { storeId: stores.zeroFee.id }, 409, "tarifa"],
  ];
  for (const [label, patch, status, msg] of invalid) {
    test(`Validação: ${label} → ${status}`, async () => {
      const central = await Api.as("central");
      await expectError(await central.post("/deliveries", deliveryInput(patch)), status, msg);
    });
  }

  test("Gerente cria entrega sempre na própria filial, mesmo se mandar outra storeId", async () => {
    const manager = await Api.as("manager");
    const res = await manager.post("/deliveries", deliveryInput({ storeId: stores.b.id }));
    // Regra: para gerente/atendente a API usa a filial do perfil.
    expect(res.status(), await describe(res)).toBe(201);
    expect((await json(res)).storeId).toBe(stores.a.id);
  });

  test("Atendente cria entrega na própria filial", async () => {
    const staff = await Api.as("staff");
    const delivery = await createDelivery(staff, { storeId: stores.b.id });
    expect(delivery.storeId).toBe(stores.b.id);
  });
});

test.describe("Entregas: visibilidade, busca e filtros", () => {
  let fromA: any;
  let fromB: any;
  test.beforeAll(async () => {
    await wipeDeliveries();
    const central = await Api.as("central");
    fromA = await createDelivery(central, { storeId: stores.a.id, customerName: "E2E Zé da Savassi", orderNumber: "PED-SAVASSI-77" });
    fromB = await createDelivery(central, { storeId: stores.b.id, customerName: "E2E Ana de Contagem" });
  });

  test("Central e Admin veem entregas de todas as filiais", async () => {
    for (const role of ["central", "admin"] as const) {
      const ids = (await json(await (await Api.as(role)).get("/deliveries"))).map((d: any) => d.id);
      expect(ids).toEqual(expect.arrayContaining([fromA.id, fromB.id]));
    }
  });

  test("Gerente vê só a filial A e atendente só a filial B", async () => {
    const managerIds = (await json(await (await Api.as("manager")).get("/deliveries"))).map((d: any) => d.id);
    expect(managerIds).toContain(fromA.id);
    expect(managerIds).not.toContain(fromB.id);
    const staffIds = (await json(await (await Api.as("staff")).get("/deliveries"))).map((d: any) => d.id);
    expect(staffIds).toContain(fromB.id);
    expect(staffIds).not.toContain(fromA.id);
  });

  test("Gerente não abre entrega de outra filial (403), mesmo filtrando por storeId", async () => {
    const manager = await Api.as("manager");
    await expectError(await manager.get(`/deliveries/${fromB.id}`), 403);
    const filtered = await json(await manager.get(`/deliveries?storeId=${stores.b.id}`));
    expect(filtered).toEqual([]);
  });

  test("Motoboy não vê entrega que não é dele", async () => {
    const courier = await Api.as("courier");
    await expectError(await courier.get(`/deliveries/${fromA.id}`), 403);
    const list = await json(await courier.get("/deliveries"));
    expect(list.map((d: any) => d.id)).not.toContain(fromA.id);
  });

  test("Busca por código, pedido, nome (sem diferenciar maiúsculas) e endereço", async () => {
    const central = await Api.as("central");
    const search = async (term: string) =>
      (await json(await central.get(`/deliveries?search=${encodeURIComponent(term)}`))).map((d: any) => d.id);
    expect(await search(fromA.code)).toEqual([fromA.id]);
    expect(await search("ped-savassi-77")).toEqual([fromA.id]);
    expect(await search("zé da savassi")).toEqual([fromA.id]);
    expect(await search("Contagem")).toContain(fromB.id);
    expect(await search("texto-que-nao-existe-xyz")).toEqual([]);
  });

  test("Busca com caracteres especiais não quebra (%, _, aspas)", async () => {
    const central = await Api.as("central");
    for (const term of ["%", "_", "'", "\"", "%' OR 1=1 --"]) {
      const res = await central.get(`/deliveries?search=${encodeURIComponent(term)}`);
      expect(res.status(), await describe(res)).toBe(200);
    }
  });

  test("Filtro por status e por filial", async () => {
    const central = await Api.as("central");
    const requested = await json(await central.get("/deliveries?status=REQUESTED"));
    expect(requested.every((d: any) => d.status === "REQUESTED")).toBe(true);
    const onlyB = await json(await central.get(`/deliveries?storeId=${stores.b.id}`));
    expect(onlyB.every((d: any) => d.storeId === stores.b.id)).toBe(true);
    expect(await json(await central.get("/deliveries?status=STATUS_INVENTADO"))).toEqual([]);
  });

  test("Lista vem da mais nova para a mais antiga", async () => {
    const list = await json(await (await Api.as("central")).get("/deliveries"));
    const times = list.map((d: any) => Date.parse(d.createdAt));
    expect([...times].sort((a, b) => b - a)).toEqual(times);
  });

  test("Entrega inexistente → 404", async () => {
    await expectError(await (await Api.as("central")).get("/deliveries/e2e-nao-existe"), 404);
  });
});

test.describe("Entregas: transições de status", () => {
  test.beforeEach(wipeDeliveries);

  test("Fluxo manual completo pela Central: OFFERED → ACCEPTED → TO_STORE → AT_STORE → IN_TRANSIT → COMPLETED", async () => {
    const central = await Api.as("central");
    await setCourierStatus("e2e-courier-1", "AVAILABLE");
    const d = await createDelivery(central);
    const dispatched = await central.post(`/deliveries/${d.id}/dispatch`, { mode: "single", courierId: "e2e-courier-1" });
    expect(dispatched.status(), await describe(dispatched)).toBe(200);
    expect((await json(dispatched)).status).toBe("OFFERED");
    for (const status of ["ACCEPTED", "TO_STORE", "AT_STORE", "IN_TRANSIT", "COMPLETED"]) {
      const res = await setStatus(central, d.id, status);
      expect(res.status(), `${status}: ${await describe(res)}`).toBe(200);
    }
    const final = await json(await central.get(`/deliveries/${d.id}`));
    expect(final.status).toBe("COMPLETED");
    expect(final.courierId).toBe("e2e-courier-1");
    expect(final.events.length).toBeGreaterThanOrEqual(6);
    const [courier] = await query("select status from couriers where id = 'e2e-courier-1'");
    expect(["AVAILABLE", "OFFLINE"]).toContain(courier.status); // ao concluir, motoboy é liberado
  });

  test("ACCEPTED pode pular TO_STORE e ir direto para AT_STORE", async () => {
    const central = await Api.as("central");
    await setCourierStatus("e2e-courier-1", "AVAILABLE");
    const d = await createDelivery(central);
    await central.post(`/deliveries/${d.id}/dispatch`, { mode: "single", courierId: "e2e-courier-1" });
    expect((await setStatus(central, d.id, "ACCEPTED")).status()).toBe(200);
    expect((await setStatus(central, d.id, "AT_STORE")).status()).toBe(200);
  });

  const illegal: [string, string][] = [
    ["REQUESTED", "ACCEPTED"],
    ["REQUESTED", "IN_TRANSIT"],
    ["REQUESTED", "COMPLETED"],
    ["REQUESTED", "AWAITING_COURIER"],
    ["REQUESTED", "NOT_DELIVERED"],
    ["REQUESTED", "RETURNING_TO_STORE"],
  ];
  for (const [from, to] of illegal) {
    test(`Transição proibida ${from} → ${to} é recusada (4xx)`, async () => {
      const central = await Api.as("central");
      const d = await createDelivery(central);
      const res = await setStatus(central, d.id, to);
      expect(res.status(), await describe(res)).toBeGreaterThanOrEqual(400);
      expect(res.status()).toBeLessThan(500);
      await expectStatus(central, d.id, from);
    });
  }

  test("Status desconhecido e nota com mais de 500 caracteres → 400", async () => {
    const central = await Api.as("central");
    const d = await createDelivery(central);
    await expectError(await setStatus(central, d.id, "VOANDO"), 400);
    await expectError(await setStatus(central, d.id, "CANCELLED", { note: "x".repeat(501) }), 400);
  });

  test("Entrega cancelada não volta: CANCELLED → qualquer status é recusado", async () => {
    const central = await Api.as("central");
    const d = await createDelivery(central);
    expect((await setStatus(central, d.id, "CANCELLED")).status()).toBe(200);
    for (const to of ["REQUESTED", "ACCEPTED", "IN_TRANSIT", "COMPLETED"]) {
      const res = await setStatus(central, d.id, to);
      expect(res.status(), `${to}: ${await describe(res)}`).toBeGreaterThanOrEqual(400);
    }
    await expectStatus(central, d.id, "CANCELLED");
  });

  test("Só Admin/Central cancelam: gerente, atendente e motoboy recebem 403", async () => {
    const central = await Api.as("central");
    const d = await createDelivery(central, { storeId: stores.a.id });
    for (const role of ["manager", "staff", "courier"] as const) {
      await expectError(await setStatus(await Api.as(role), d.id, "CANCELLED"), 403);
    }
    await expectStatus(central, d.id, "REQUESTED");
  });

  test("Loja só pode marcar IN_TRANSIT (retirada) — outros status são recusados", async () => {
    const central = await Api.as("central");
    await setCourierStatus("e2e-courier-1", "AVAILABLE");
    const d = await createDelivery(central, { storeId: stores.a.id });
    await central.post(`/deliveries/${d.id}/dispatch`, { mode: "single", courierId: "e2e-courier-1" });
    const manager = await Api.as("manager");
    const res = await setStatus(manager, d.id, "ACCEPTED");
    expect(res.status(), await describe(res)).toBeGreaterThanOrEqual(400);
    await setStatus(central, d.id, "ACCEPTED");
    await setStatus(central, d.id, "AT_STORE");
    const pickup = await setStatus(manager, d.id, "IN_TRANSIT");
    expect(pickup.status(), await describe(pickup)).toBe(200);
  });

  // Hoje a API responde 409 com a mensagem "não pertence à sua área de acesso"; o GET da mesma entrega responde 403.
  test("[BUG] Atendente de outra filial não altera status (deveria ser 403, como no GET)", async () => {
    const central = await Api.as("central");
    const d = await createDelivery(central, { storeId: stores.a.id });
    await expectError(await setStatus(await Api.as("staff"), d.id, "IN_TRANSIT"), 403);
  });

  test("Motoboy não conclui entrega sem foto de comprovação (422)", async () => {
    const central = await Api.as("central");
    await setCourierStatus("e2e-courier-1", "AVAILABLE");
    const d = await createDelivery(central);
    await central.post(`/deliveries/${d.id}/dispatch`, { mode: "single", courierId: "e2e-courier-1" });
    for (const s of ["ACCEPTED", "AT_STORE", "IN_TRANSIT"]) await setStatus(central, d.id, s);
    const courier = await Api.as("courier");
    await expectError(await setStatus(courier, d.id, "COMPLETED"), 422, "foto");
    await expectError(await setStatus(courier, d.id, "COMPLETED", { evidencePath: "/objects/inventado.jpg" }), 422, "foto");
  });

  test("Duas atualizações simultâneas: só uma vence, sem estado inconsistente", async () => {
    const central = await Api.as("central");
    const d = await createDelivery(central);
    const [a, b] = await Promise.all([setStatus(central, d.id, "CANCELLED"), setStatus(central, d.id, "CANCELLED")]);
    const statuses = [a.status(), b.status()].sort();
    expect(statuses[0]).toBe(200);
    expect(statuses[1]).toBeGreaterThanOrEqual(400);
    await expectStatus(central, d.id, "CANCELLED");
  });
});

test.describe("Entregas: exclusão definitiva", () => {
  test.beforeEach(wipeDeliveries);

  test("Admin exclui entrega e eventos; segunda exclusão → 404", async () => {
    const admin = await Api.as("admin");
    const d = await createDelivery(admin);
    const res = await admin.delete(`/deliveries/${d.id}`);
    expect(res.status(), await describe(res)).toBeLessThan(300);
    await expectError(await admin.get(`/deliveries/${d.id}`), 404);
    expect(await query("select 1 from delivery_events where delivery_id = $1", [d.id])).toEqual([]);
    await expectError(await admin.delete(`/deliveries/${d.id}`), 404);
  });

  // Exclusão dentro de rota ofertada e de rota aceita: ver 05-rotas.spec.ts.

  test("Gerente, atendente, Central e motoboy não excluem entregas (403)", async () => {
    const d = await createDelivery(await Api.as("central"), { storeId: stores.a.id });
    for (const role of ["central", "manager", "staff", "courier"] as const) {
      await expectError(await (await Api.as(role)).delete(`/deliveries/${d.id}`), 403);
    }
  });
});
