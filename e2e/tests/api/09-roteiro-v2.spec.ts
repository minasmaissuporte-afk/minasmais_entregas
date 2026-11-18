import { test, expect } from "@playwright/test";
import { Api, describe, json } from "../../support/api.ts";
import { BH_POSITION, courierCities, stores } from "../../support/fixtures-data.ts";
import { courierOnline, deliveryInput, expectError } from "../../support/helpers.ts";
import { query, setCourierStatus, wipeDeliveries } from "../../support/db.ts";

/**
 * Roteiro da nova versão (fila automática por cidade, pagamento, receita, rota pelo gerente,
 * devolução, contabilidade). A e B = Belo Horizonte (cidade da filial A); C = Contagem.
 */
const note = (type: string, description: string) => test.info().annotations.push({ type, description });
const status = async (id: string) => (await json(await (await Api.as("admin")).get(`/deliveries/${id}`))).status as string;
const offersFor = async (role: "courier" | "courierB" | "courierC") =>
  (await json(await (await Api.as(role)).get("/deliveries"))).filter((d: any) => d.status === "OFFERED" || d.status === "AWAITING_COURIER" || d.status === "REQUESTED");

async function allOnline() {
  for (const role of ["courier", "courierB", "courierC"] as const) await courierOnline(await Api.as(role));
}
async function managerCreates(overrides: Record<string, unknown> = {}) {
  const res = await (await Api.as("manager")).post("/deliveries", deliveryInput({ storeId: stores.a.id, paymentMethod: "PIX", ...overrides }));
  expect(res.status(), await describe(res)).toBe(201);
  return json(res);
}

// Outros arquivos (ex.: 09-fluxo-filial) mexem na cidade dos motoboys de teste: este roteiro
// depende de A e B em Belo Horizonte e C em Contagem, então restaura antes de começar.
test.beforeAll(async () => {
  for (const [id, city] of Object.entries(courierCities)) await query("update couriers set city = $1 where id = $2", [city, id]);
});

test.describe("2. Admin: acessos (validações sem enviar e-mail)", () => {
  test("2.3 Convite de motoboy sem cidade pede a cidade (nenhum e-mail enviado)", async () => {
    const admin = await Api.as("admin");
    const res = await admin.post("/access/invites", { email: "e2e-convite-sem-cidade@example.com", name: "E2E Sem Cidade", role: "COURIER", redirectTo: "http://localhost:5173/user-portal" });
    expect(res.status(), await describe(res)).toBe(400);
    note("mensagem", (await json(res)).error);
    expect((await json(res)).error).toMatch(/cidade/i);
  });

  test("2.3b Convite de gerente sem filial é recusado", async () => {
    const res = await (await Api.as("admin")).post("/access/invites", { email: "e2e-convite-gerente@example.com", name: "E2E Gerente Sem Filial", role: "STORE_MANAGER", redirectTo: "http://localhost:5173/user-portal" });
    expect(res.status(), await describe(res)).toBeGreaterThanOrEqual(400);
    note("mensagem", (await json(res)).error);
  });

  test("2.4 Editar motoboy e trocar a cidade", async () => {
    const admin = await Api.as("admin");
    const res = await admin.patch("/access/users/e2e-user-courier-2", { role: "COURIER", name: "E2E Maria Motoboy", courierCity: "Contagem", courierId: "e2e-courier-2" });
    expect(res.status(), await describe(res)).toBe(200);
    const [row] = await query("select city from couriers where id='e2e-courier-2'");
    expect(row.city).toBe("Contagem");
    await admin.patch("/access/users/e2e-user-courier-2", { role: "COURIER", name: "E2E Maria Motoboy", courierCity: "Belo Horizonte", courierId: "e2e-courier-2" });
  });

  test("2.4b Motoboy sem cidade na edição é recusado", async () => {
    const res = await (await Api.as("admin")).patch("/access/users/e2e-user-courier-2", { role: "COURIER", name: "E2E Maria Motoboy", courierCity: "", courierId: "e2e-courier-2" });
    expect(res.status(), await describe(res)).toBe(400);
  });
});

test.describe("3. Gerente: nova entrega", () => {
  test.beforeAll(wipeDeliveries);

  test("3.3 Sem forma de pagamento → pede o pagamento", async () => {
    const input = deliveryInput({ storeId: stores.a.id });
    delete (input as Record<string, unknown>).paymentMethod;
    const res = await (await Api.as("manager")).post("/deliveries", input);
    note("resposta", `${res.status()} ${(await res.text()).slice(0, 160)}`);
    expect(res.status(), "aceitou entrega sem forma de pagamento").toBe(400);
  });

  test("3.4 Dinheiro com troco, Cartão com maquininha, Pix e Dinheiro sem troco", async () => {
    const cash = await managerCreates({ paymentMethod: "CASH", changeFor: 100 });
    const card = await managerCreates({ paymentMethod: "CARD", bringCardMachine: true });
    const pix = await managerCreates({ paymentMethod: "PIX" });
    const cashNoChange = await managerCreates({ paymentMethod: "CASH", changeFor: null });
    expect(cash).toMatchObject({ paymentMethod: "CASH", changeFor: 100 });
    expect(card).toMatchObject({ paymentMethod: "CARD", bringCardMachine: true });
    expect(pix).toMatchObject({ paymentMethod: "PIX" });
    expect(cashNoChange.paymentMethod).toBe("CASH");
    expect(cashNoChange.changeFor ?? null).toBeNull();
  });

  test("3.1 A unidade é sempre a do gerente, mesmo enviando outra", async () => {
    const d = await managerCreates({ storeId: stores.b.id });
    expect(d.storeId).toBe(stores.a.id);
  });

  test("3.5 Medicamento com receita fica marcado", async () => {
    const d = await managerCreates({ requiresPrescription: true });
    expect(d.requiresPrescription).toBe(true);
  });

  test("3.6 Entrega nova entra na fila dos motoboys da cidade", async () => {
    const d = await managerCreates();
    note("status ao criar", d.status);
    const events = (d.events ?? []).map((e: any) => e.label).join(" | ");
    note("eventos", events);
    expect(events).toMatch(/motoboys de Belo Horizonte/i);
  });

  test("3.7 Gerente edita uma entrega que ainda está na fila (troca o pagamento)", async () => {
    const d = await managerCreates({ paymentMethod: "PIX" });
    const res = await (await Api.as("manager")).patch(`/deliveries/${d.id}`, { paymentMethod: "CARD", bringCardMachine: true });
    note("resposta", `${res.status()} ${(await res.text()).slice(0, 160)}`);
    expect(res.status(), "gerente não consegue editar a entrega (a API só permite Admin e Central)").toBe(200);
    expect(await json(res)).toMatchObject({ paymentMethod: "CARD", bringCardMachine: true });
  });

  test("3.7b Gerente não edita entrega já aceita nem entrega de outra filial", async () => {
    await courierOnline(await Api.as("courier"));
    const mine = await managerCreates();
    expect((await (await Api.as("courier")).patch(`/deliveries/${mine.id}/status`, { status: "ACCEPTED" })).status()).toBe(200);
    const accepted = await (await Api.as("manager")).patch(`/deliveries/${mine.id}`, { notes: "mudou" });
    note("aceita", `${accepted.status()} ${(await accepted.text()).slice(0, 160)}`);
    expect(accepted.status()).toBe(409);
    const other = await json(await (await Api.as("admin")).post("/deliveries", deliveryInput({ storeId: stores.b.id })));
    const foreign = await (await Api.as("manager")).patch(`/deliveries/${other.id}`, { notes: "invasão" });
    expect(foreign.status()).toBe(403);
    await setCourierStatus("e2e-courier-1", "OFFLINE");
  });
});

test.describe("5. Fila automática (quem aceitar primeiro leva)", () => {
  test.beforeEach(async () => {
    await wipeDeliveries();
    await allOnline();
  });

  test("5.1 A e B veem a oferta; C (outra cidade) não", async () => {
    const d = await managerCreates();
    const [a, b, c] = await Promise.all([offersFor("courier"), offersFor("courierB"), offersFor("courierC")]);
    expect(a.map((x: any) => x.id), "A não vê a oferta").toContain(d.id);
    expect(b.map((x: any) => x.id), "B não vê a oferta").toContain(d.id);
    expect(c.map((x: any) => x.id), "C (outra cidade) vê a oferta").not.toContain(d.id);
  });

  test("5.2 Oferta traz retirada, destino e pagamento (o valor da entrega fica para a filial)", async () => {
    const d = await managerCreates({ paymentMethod: "CASH", changeFor: 50 });
    const offer = (await offersFor("courier")).find((x: any) => x.id === d.id);
    expect(offer).toMatchObject({ storeName: stores.a.name, paymentMethod: "CASH", changeFor: 50 });
    expect(offer.destination).toBeTruthy();
    note("valor da entrega na resposta do motoboy", String(offer.deliveryAmount));
  });

  test("5.3 A e B aceitam quase juntos: só um fica, o outro recebe 'Outro motoboy aceitou…'", async () => {
    const d = await managerCreates();
    const [ra, rb] = await Promise.all([
      (await Api.as("courier")).patch(`/deliveries/${d.id}/status`, { status: "ACCEPTED" }),
      (await Api.as("courierB")).patch(`/deliveries/${d.id}/status`, { status: "ACCEPTED" }),
    ]);
    const statuses = [ra.status(), rb.status()].sort();
    const loser = ra.status() === 200 ? rb : ra;
    note("respostas", `${ra.status()} / ${rb.status()} · perdedor: ${(await loser.text()).slice(0, 120)}`);
    expect(statuses[0]).toBe(200);
    expect(statuses[1]).toBe(409);
    expect((await json(loser)).error).toMatch(/Outro motoboy aceitou esta entrega primeiro/);
    expect(await status(d.id)).toBe("ACCEPTED");
  });

  test("5.3b C (outra cidade) não consegue aceitar", async () => {
    const d = await managerCreates();
    const res = await (await Api.as("courierC")).patch(`/deliveries/${d.id}/status`, { status: "ACCEPTED" });
    note("resposta", `${res.status()} ${(await res.text()).slice(0, 120)}`);
    expect(res.status()).toBeGreaterThanOrEqual(400);
  });

  test("5.4 Dispensar: some só para quem dispensou", async () => {
    const d = await managerCreates();
    const res = await (await Api.as("courier")).post(`/courier/deliveries/${d.id}/decline`);
    expect(res.status(), await describe(res)).toBeLessThan(300);
    expect((await offersFor("courier")).map((x: any) => x.id)).not.toContain(d.id);
    expect((await offersFor("courierB")).map((x: any) => x.id)).toContain(d.id);
  });

  test("5.5 Offline não vê ofertas; online de novo, elas voltam", async () => {
    const d = await managerCreates();
    const a = await Api.as("courier");
    await a.patch("/courier/availability", { online: false });
    expect((await offersFor("courier")).map((x: any) => x.id)).not.toContain(d.id);
    await courierOnline(a);
    expect((await offersFor("courier")).map((x: any) => x.id)).toContain(d.id);
  });
});

test.describe("6. Entrega individual (motoboy)", () => {
  test.beforeEach(async () => {
    await wipeDeliveries();
    await allOnline();
  });

  test("6.3 'Retirei o pedido na loja': de Aceita direto para Em entrega", async () => {
    const d = await managerCreates();
    const a = await Api.as("courier");
    expect((await a.patch(`/deliveries/${d.id}/status`, { status: "ACCEPTED" })).status()).toBe(200);
    const res = await a.patch(`/deliveries/${d.id}/status`, { status: "IN_TRANSIT" });
    expect(res.status(), await describe(res)).toBe(200);
    expect(await status(d.id)).toBe("IN_TRANSIT");
  });

  test("6.5 Receita: concluir sem marcar 'Peguei a receita' é recusado", async () => {
    const d = await managerCreates({ requiresPrescription: true });
    const a = await Api.as("courier");
    await a.patch(`/deliveries/${d.id}/status`, { status: "ACCEPTED" });
    await a.patch(`/deliveries/${d.id}/status`, { status: "IN_TRANSIT" });
    const up = await json(await a.post(`/deliveries/${d.id}/evidence/upload-url`, { name: "f.jpg", size: 200, contentType: "image/jpeg" }));
    const jpeg = Buffer.from("/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=", "base64");
    await fetch(up.uploadURL, { method: "PUT", headers: { "Content-Type": "image/jpeg" }, body: new Uint8Array(jpeg) });
    const without = await a.patch(`/deliveries/${d.id}/status`, { status: "COMPLETED", evidencePath: up.objectPath });
    note("sem receita", `${without.status()} ${(await without.text()).slice(0, 140)}`);
    expect(without.status()).toBeGreaterThanOrEqual(400);
    const withRx = await a.patch(`/deliveries/${d.id}/status`, { status: "COMPLETED", evidencePath: up.objectPath, prescriptionCollected: true });
    expect(withRx.status(), await describe(withRx)).toBe(200);
    const [row] = await query("select prescription_collected_at from deliveries where id=$1", [d.id]);
    expect(row.prescription_collected_at).not.toBeNull();
  });

  test("6.7 Gerente usa 'Confirmar saída para entrega'", async () => {
    const d = await managerCreates();
    await (await Api.as("courier")).patch(`/deliveries/${d.id}/status`, { status: "ACCEPTED" });
    const res = await (await Api.as("manager")).patch(`/deliveries/${d.id}/status`, { status: "IN_TRANSIT" });
    expect(res.status(), await describe(res)).toBe(200);
  });
});

test.describe("7. Rota montada pelo gerente", () => {
  test.beforeEach(async () => {
    await wipeDeliveries();
    await allOnline();
  });

  test("7.1a Gerente monta rota escolhendo o motoboy: só ele vê", async () => {
    const [d1, d2] = [await managerCreates(), await managerCreates()];
    const res = await (await Api.as("manager")).post("/delivery-routes", { deliveryIds: [d1.id, d2.id], courierId: "e2e-courier-1" });
    expect(res.status(), await describe(res)).toBe(201);
    const route = await json(res);
    const seenA = (await json(await (await Api.as("courier")).get("/courier/routes"))).map((r: any) => r.id);
    const seenB = (await json(await (await Api.as("courierB")).get("/courier/routes"))).map((r: any) => r.id);
    expect(seenA).toContain(route.id);
    expect(seenB, "B vê rota feita para A").not.toContain(route.id);
  });

  test("7.1b Gerente oferece a rota a todos: A e B veem, C não", async () => {
    const [d1, d2] = [await managerCreates(), await managerCreates()];
    const route = await json(await (await Api.as("manager")).post("/delivery-routes", { deliveryIds: [d1.id, d2.id] }));
    const seen = async (r: "courier" | "courierB" | "courierC") => (await json(await (await Api.as(r)).get("/courier/routes"))).map((x: any) => x.id);
    expect(await seen("courier")).toContain(route.id);
    expect(await seen("courierB")).toContain(route.id);
    expect(await seen("courierC"), "C (outra cidade) vê a rota").not.toContain(route.id);
    const c = await Api.as("courierC");
    expect((await c.get(`/courier/routes/${route.id}/preview`)).status()).toBe(403);
    const accept = await c.post(`/courier/routes/${route.id}/accept`, BH_POSITION);
    note("C tenta aceitar", `${accept.status()} ${(await accept.text()).slice(0, 160)}`);
    expect(accept.status()).toBe(403);
  });

  test("7.4 Tirar da rota: voltar para a fila e cancelar", async () => {
    const [d1, d2, d3] = [await managerCreates(), await managerCreates(), await managerCreates()];
    const manager = await Api.as("manager");
    const route = await json(await manager.post("/delivery-routes", { deliveryIds: [d1.id, d2.id, d3.id], courierId: "e2e-courier-1" }));
    const requeue = await manager.post(`/delivery-routes/${route.id}/remove-delivery`, { deliveryId: d1.id });
    expect(requeue.status(), await describe(requeue)).toBeLessThan(300);
    note("tirada (fila)", await status(d1.id));
    const cancel = await manager.post(`/delivery-routes/${route.id}/remove-delivery`, { deliveryId: d2.id, cancel: true });
    expect(cancel.status(), await describe(cancel)).toBeLessThan(300);
    expect(await status(d2.id)).toBe("CANCELLED");
  });

  test("7.5 Desfazer a rota inteira: entregas voltam para a fila", async () => {
    const [d1, d2] = [await managerCreates(), await managerCreates()];
    const manager = await Api.as("manager");
    const route = await json(await manager.post("/delivery-routes", { deliveryIds: [d1.id, d2.id] }));
    const res = await manager.post(`/delivery-routes/${route.id}/ungroup`);
    expect(res.status(), await describe(res)).toBeLessThan(300);
    const offers = (await offersFor("courierB")).map((x: any) => x.id);
    expect(offers).toEqual(expect.arrayContaining([d1.id, d2.id]));
  });

  test("7.6 Motoboy recusa rota feita para ele: entregas voltam para a fila", async () => {
    const [d1, d2] = [await managerCreates(), await managerCreates()];
    const route = await json(await (await Api.as("manager")).post("/delivery-routes", { deliveryIds: [d1.id, d2.id], courierId: "e2e-courier-1" }));
    const res = await (await Api.as("courier")).post(`/courier/routes/${route.id}/decline`);
    expect(res.status(), await describe(res)).toBeLessThan(300);
    const offers = (await offersFor("courierB")).map((x: any) => x.id);
    expect(offers, "entregas não voltaram para a fila dos outros motoboys").toEqual(expect.arrayContaining([d1.id, d2.id]));
  });

  test("7.3 Rota aceita: um botão de retirada libera todos os pedidos da loja", async () => {
    const [d1, d2] = [await managerCreates(), await managerCreates()];
    const route = await json(await (await Api.as("manager")).post("/delivery-routes", { deliveryIds: [d1.id, d2.id], courierId: "e2e-courier-1" }));
    const a = await Api.as("courier");
    const accepted = await a.post(`/courier/routes/${route.id}/accept`, BH_POSITION);
    expect(accepted.status(), await describe(accepted)).toBe(200);
    const view = await json(accepted);
    const pickup = view.stops.find((s: any) => s.kind === "pickup");
    await a.post(`/courier/routes/${route.id}/stops/${pickup.id}/arrive`);
    const done = await a.post(`/courier/routes/${route.id}/stops/${pickup.id}/complete`, {});
    expect(done.status(), await describe(done)).toBe(200);
    expect(await status(d1.id)).toBe("IN_TRANSIT");
    expect(await status(d2.id)).toBe("IN_TRANSIT");
  });
});

test.describe("8. Devolução e cancelamento", () => {
  test.beforeEach(async () => {
    await wipeDeliveries();
    await allOnline();
  });

  test("8.1 Motivos de 'Não consigo entregar' são só os 4 do roteiro", async () => {
    const reasons = (await json(await (await Api.as("courier")).get("/delivery-cancellation-reasons"))).map((r: any) => r.label);
    expect(reasons).toEqual(["Cliente ausente / não atende", "Endereço não encontrado", "Cliente desistiu / recusou", "Outro motivo"]);
  });

  test("8.2–8.4 Devolvida pelo motoboy → gerente reenvia → oferta volta; depois cancela sem erro", async () => {
    const d = await managerCreates();
    const a = await Api.as("courier");
    await a.patch(`/deliveries/${d.id}/status`, { status: "ACCEPTED" });
    const unable = await a.post(`/courier/deliveries/${d.id}/unable`, { reason: "Cliente ausente / não atende", ...BH_POSITION });
    expect(unable.status(), await describe(unable)).toBe(200);
    const returned = await status(d.id);
    note("status devolvida", returned);
    const manager = await Api.as("manager");
    const resend = await manager.post(`/deliveries/${d.id}/dispatch`, { mode: "group" });
    expect(resend.status(), await describe(resend)).toBe(200);
    expect((await offersFor("courierB")).map((x: any) => x.id), "não voltou para a fila").toContain(d.id);
    // Devolve de novo e o gerente cancela a devolvida
    await (await Api.as("courierB")).patch(`/deliveries/${d.id}/status`, { status: "ACCEPTED" });
    await (await Api.as("courierB")).post(`/courier/deliveries/${d.id}/unable`, { reason: "Outro motivo", ...BH_POSITION });
    const cancel = await manager.patch(`/deliveries/${d.id}/status`, { status: "CANCELLED" });
    expect(cancel.status(), await describe(cancel)).toBe(200);
    const events = (await json(await manager.get(`/deliveries/${d.id}`))).events.map((e: any) => e.label);
    expect(events.join(" | ")).toMatch(/Cancelada pela loja/);
  });

  test("8.4 Gerente cancela entrega que está na fila", async () => {
    const d = await managerCreates();
    const res = await (await Api.as("manager")).patch(`/deliveries/${d.id}/status`, { status: "CANCELLED" });
    expect(res.status(), await describe(res)).toBe(200);
    expect(await status(d.id)).toBe("CANCELLED");
  });

  test("8.5 Com o produto retirado, 'Não consigo entregar' → Voltando para a loja", async () => {
    const d = await managerCreates();
    const a = await Api.as("courier");
    await a.patch(`/deliveries/${d.id}/status`, { status: "ACCEPTED" });
    await a.patch(`/deliveries/${d.id}/status`, { status: "IN_TRANSIT" });
    const res = await a.post(`/courier/deliveries/${d.id}/unable`, { reason: "Endereço não encontrado", ...BH_POSITION });
    expect(res.status(), await describe(res)).toBe(200);
    expect(await status(d.id)).toBe("RETURNING_TO_STORE");
  });
});

test.describe("10. Contabilidade da filial e 11. relatórios", () => {
  test("10 Contabilidade: entregas, pago e a pagar; 'Marcar como pago' zera o a pagar", async () => {
    await wipeDeliveries();
    await allOnline();
    const admin = await Api.as("admin");
    // Uma entrega concluída por A (Admin conclui sem foto para preparar o dado).
    const d = await managerCreates();
    await (await Api.as("courier")).patch(`/deliveries/${d.id}/status`, { status: "ACCEPTED" });
    for (const s of ["IN_TRANSIT", "COMPLETED"]) await admin.patch(`/deliveries/${d.id}/status`, { status: s });
    const today = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date());
    const manager = await Api.as("manager");
    const res = await manager.get(`/reports/store-accounting?from=${today}&to=${today}`);
    expect(res.status(), await describe(res)).toBe(200);
    const acc = await json(res);
    note("contabilidade", JSON.stringify({ total: acc.totalDeliveries, concluidas: acc.completedDeliveries, valor: acc.amountTotal, pago: acc.amountPaid, apagar: acc.amountToPay }));
    expect(acc.storeId).toBe(stores.a.id);
    expect(acc.amountToPay).toBeCloseTo(stores.a.feeCents / 100, 2);
    const courier = acc.couriers.find((c: any) => c.courierId === "e2e-courier-1");
    expect(courier).toBeTruthy();
    const pay = await manager.post("/reports/store-accounting/pay", { courierId: "e2e-courier-1", from: today, to: today });
    expect(pay.status(), await describe(pay)).toBeLessThan(300);
    const after = await json(await manager.get(`/reports/store-accounting?from=${today}&to=${today}`));
    expect(after.amountToPay).toBe(0);
    expect(after.couriers.find((c: any) => c.courierId === "e2e-courier-1").amountToPay ?? 0).toBe(0);
    const [row] = await query("select courier_paid_at from deliveries where id=$1", [d.id]);
    expect(row.courier_paid_at).not.toBeNull();
  });

  test("10.6 Gerente não acessa relatório geral nem contabilidade de outra filial", async () => {
    const manager = await Api.as("manager");
    await expectError(await manager.get("/reports/analytics"), 403);
    const other = await manager.get(`/reports/store-accounting?storeId=${stores.b.id}`);
    note("contabilidade de outra filial", `${other.status()} ${(await other.text()).slice(0, 120)}`);
    if (other.status() === 200) expect((await json(other)).storeId, "gerente viu a contabilidade de outra filial").toBe(stores.a.id);
  });

  test("9.2 Totais do motoboy: só quantidade (sem valor em R$)", async () => {
    const res = await (await Api.as("courier")).get("/courier/earnings?period=day");
    expect(res.status(), await describe(res)).toBe(200);
    note("resposta de ganhos", JSON.stringify(await json(res)));
  });

  test("11.1 Relatório do admin: contagem por etapa e tempos médios", async () => {
    const res = await (await Api.as("admin")).get("/reports/analytics");
    expect(res.status(), await describe(res)).toBe(200);
    const r = await json(res);
    note("resumo", JSON.stringify(r.summary).slice(0, 400));
  });
});

test.afterAll(async () => {
  for (const id of ["e2e-courier-1", "e2e-courier-2", "e2e-courier-b", "e2e-courier-c"]) await setCourierStatus(id, "OFFLINE");
});
