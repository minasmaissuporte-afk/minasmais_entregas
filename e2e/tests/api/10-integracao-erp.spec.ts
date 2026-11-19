import { test, expect, request, type APIRequestContext } from "@playwright/test";
import { Api, describe, json } from "../../support/api.ts";
import { API_URL } from "../../support/env.ts";
import { stores } from "../../support/fixtures-data.ts";
import { courierOnline, setStatus } from "../../support/helpers.ts";
import { query, wipeDeliveries } from "../../support/db.ts";

/**
 * Integração ERP: o ERP envia a venda pela API pública (/api/v1/erp) e a entrega
 * é cadastrada sozinha na filial do código informado. Dados fictícios, banco local.
 */
const LOCAL_IPS = ["127.0.0.1", "::1", "::ffff:127.0.0.1"];
let erp: APIRequestContext;
let token = "";
let credentialId = "";
let seq = 0;

const codes = { a: "E2E-001", zeroFee: "E2E-ZERO", inactive: "E2E-INAT" };

function saleId() {
  seq += 1;
  return `E2E-V${Date.now()}-${seq}`;
}

function sale(overrides: Record<string, unknown> = {}) {
  return {
    idVenda: saleId(),
    codigoFilial: codes.a,
    dataVenda: "2026-11-19T10:30:00-03:00",
    cliente: { nome: "E2E Cliente ERP Conceição", telefone: "31999990000" },
    endereco: {
      cep: "30140071",
      rua: "Rua Paraíba",
      numero: "1200",
      bairro: "Savassi",
      cidade: "Belo Horizonte",
      estado: "mg",
      complemento: "Apto 301",
      referencia: "Ao lado da padaria",
    },
    pedido: {
      numeroPedido: "PED-ERP-1",
      valorTotal: "48,90",
      formaPagamento: "dinheiro",
      trocoPara: 100,
      observacoes: "Interfone com defeito.",
    },
    ...overrides,
  };
}

async function call(method: "GET" | "POST" | "PATCH", path: string, data?: unknown, auth: string | null = token) {
  return erp.fetch(path.replace(/^\//, ""), {
    method,
    headers: auth ? { Authorization: `Bearer ${auth}` } : {},
    data,
    failOnStatusCode: false,
  });
}

async function expectErp(res: Awaited<ReturnType<typeof call>>, status: number, code: string) {
  expect(res.status(), await describe(res)).toBe(status);
  const body = await json(res);
  expect(body.erro.codigo).toBe(code);
  expect(body.requestId).toBeTruthy();
  return body;
}

async function deliveriesForSale(id: string) {
  return query<{ id: string; code: string; store_id: string; status: string }>(
    `select id, code, store_id, status from deliveries where erp_sale_id = $1`,
    [id],
  );
}

async function resetAuthFailures() {
  await query(`delete from erp_integration_events where operation = 'AUTH' and client_ip = any($1)`, [LOCAL_IPS]);
}

test.describe("Integração ERP (API pública /api/v1/erp)", () => {
  test.beforeAll(async () => {
    erp = await request.newContext({ baseURL: `${API_URL}/api/v1/erp/` });
    await resetAuthFailures();
    const admin = await Api.as("developer");
    const created = await admin.post("/admin/erp/credentials", { name: "E2E ERP homologação" });
    expect(created.status(), await describe(created)).toBe(201);
    const body = await json(created);
    token = body.token;
    credentialId = body.credential.id;
    expect(token).toMatch(/^mmerp_[0-9a-f]{12}_[A-Za-z0-9_-]{43}$/);
    // A lista nunca devolve o token, só o prefixo.
    const list = await json(await admin.get("/admin/erp/credentials"));
    expect(JSON.stringify(list)).not.toContain(token);
    for (const [key, code] of Object.entries(codes)) {
      const store = stores[key as keyof typeof codes];
      const res = await admin.put(`/admin/erp/stores/${store.id}`, { erpCode: code.toLowerCase() });
      expect(res.status(), await describe(res)).toBe(200);
      expect((await json(res)).erpCode).toBe(code);
    }
  });

  test.beforeEach(async () => {
    await wipeDeliveries();
    await query(`update couriers set city = $1 where id = 'e2e-courier-1'`, [stores.a.city]);
  });

  test.afterAll(async () => {
    await query(`update stores set erp_code = null where id like 'e2e-%'`);
    await query(`delete from erp_integration_events where credential_id in (select id from erp_api_credentials where name like 'E2E %')`);
    await query(`delete from erp_api_credentials where name like 'E2E %'`);
    await resetAuthFailures();
    await erp.dispose();
  });

  test("Health responde sem token e confirma a credencial quando enviada", async () => {
    const open = await call("GET", "/health", undefined, null);
    expect(open.status()).toBe(200);
    const body = await json(open);
    expect(body).toMatchObject({ status: "ok", versao: "v1" });
    expect(body).not.toHaveProperty("credencialValida");
    expect(JSON.stringify(body)).not.toMatch(/postgres|database|supabase/i);
    expect((await json(await call("GET", "/health"))).credencialValida).toBe(true);
    expect((await json(await call("GET", "/health", undefined, "mmerp_000000000000_x"))).credencialValida).toBe(false);
    // Documentação pública (sem token dentro).
    const spec = await call("GET", "/openapi.json", undefined, null);
    expect(spec.status()).toBe(200);
    const doc = await json(spec);
    expect(doc.openapi).toMatch(/^3\./);
    expect(Object.keys(doc.paths)).toEqual(expect.arrayContaining(["/entregas", "/entregas/{idVenda}", "/entregas/{idVenda}/cancelar", "/health"]));
    expect(JSON.stringify(doc)).not.toContain(token);
    expect((await call("GET", "/docs", undefined, null)).status()).toBe(200);
  });

  test("Credencial ausente, inválida ou revogada é recusada (401) e auditada", async () => {
    await expectErp(await call("POST", "/entregas", sale(), null), 401, "CREDENCIAL_AUSENTE");
    await expectErp(await call("POST", "/entregas", sale(), "mmerp_abcdefabcdef_" + "x".repeat(43)), 401, "CREDENCIAL_INVALIDA");
    // Token com o mesmo prefixo e segredo diferente.
    const tampered = token.slice(0, -4) + (token.endsWith("AAAA") ? "BBBB" : "AAAA");
    await expectErp(await call("POST", "/entregas", sale(), tampered), 401, "CREDENCIAL_INVALIDA");
    // Login de pessoa (Supabase) não serve para a API do ERP.
    const adminJwt = (await import("../../support/auth.ts")).accessToken;
    await expectErp(await call("POST", "/entregas", sale(), await adminJwt("admin")), 401, "CREDENCIAL_INVALIDA");

    const admin = await Api.as("developer");
    const second = await json(await admin.post("/admin/erp/credentials", { name: "E2E ERP revogar" }));
    expect((await call("GET", "/entregas/qualquer", undefined, second.token)).status()).toBe(404);
    const revoked = await admin.post(`/admin/erp/credentials/${second.credential.id}/revoke`);
    expect(revoked.status(), await describe(revoked)).toBe(200);
    expect((await json(revoked)).revokedAt).toBeTruthy();
    await expectErp(await call("GET", "/entregas/qualquer", undefined, second.token), 401, "CREDENCIAL_INVALIDA");

    const audit = await query(`select error_code from erp_integration_events where operation = 'AUTH' and client_ip = any($1)`, [LOCAL_IPS]);
    expect(audit.map((row) => row.error_code)).toEqual(expect.arrayContaining(["CREDENCIAL_AUSENTE", "CREDENCIAL_INVALIDA"]));
    await resetAuthFailures();
  });

  test("Venda válida vira entrega na filial certa, aparece para a central e vai para os motoboys", async () => {
    const courier = await Api.as("courier");
    await courierOnline(courier);
    const input = sale();
    const res = await call("POST", "/entregas", input);
    expect(res.status(), await describe(res)).toBe(201);
    const body = await json(res);
    expect(body.duplicada).toBe(false);
    const entrega = body.entrega;
    expect(entrega).toMatchObject({
      idVenda: input.idVenda,
      status: "OFFERED",
      filial: { codigo: codes.a, nome: stores.a.name },
      cliente: { nome: "E2E Cliente ERP Conceição", telefone: "31999990000" },
      numeroPedido: "PED-ERP-1",
      motoboy: null,
    });
    expect(entrega.codigoEntrega).toMatch(/^MM-\d{6}$/);
    expect(entrega.endereco).toBe("Rua Paraíba, 1200, Apto 301 - Savassi, Belo Horizonte - MG, 30140-071");
    expect(entrega.pagamento).toMatchObject({
      formaPagamento: "DINHEIRO",
      pago: false,
      valorProdutos: 48.9,
      taxaEntrega: stores.a.feeCents / 100,
      valorCobrarNaEntrega: 48.9 + stores.a.feeCents / 100,
      trocoPara: 100,
    });

    const [row] = await deliveriesForSale(input.idVenda);
    expect(row.store_id).toBe(stores.a.id);

    // Painel da central (mesma lista usada pela tela, que atualiza a cada 15 s).
    const central = await Api.as("central");
    const listed = await json(await central.get("/deliveries"));
    const inPanel = listed.find((item: { id: string }) => item.id === row.id);
    expect(inPanel, "entrega aparece na lista da central").toBeTruthy();
    expect(inPanel.paymentMethod).toBe("CASH");
    expect(inPanel.notes).toContain("Referência: Ao lado da padaria");
    expect(inPanel.notes).toContain("Interfone com defeito.");
    const detail = await json(await central.get(`/deliveries/${row.id}`));
    expect(detail.events.some((event: { actor: string }) => event.actor === "Integração ERP")).toBe(true);
    // Gerente da filial também vê.
    const manager = await Api.as("manager");
    expect((await json(await manager.get("/deliveries"))).some((item: { id: string }) => item.id === row.id)).toBe(true);
    // Motoboy da cidade recebe a oferta; ninguém foi atribuído automaticamente.
    const offers = await json(await courier.get("/deliveries"));
    expect(offers.some((item: { id: string; courierId: string | null }) => item.id === row.id && item.courierId === null)).toBe(true);

    const audit = await query(`select outcome, delivery_id, store_code from erp_integration_events where sale_id = $1`, [input.idVenda]);
    expect(audit).toEqual([{ outcome: "CREATED", delivery_id: row.id, store_code: codes.a }]);
  });

  test("Venda repetida não duplica (idempotência) e envios simultâneos geram uma só entrega", async () => {
    const input = sale();
    const first = await call("POST", "/entregas", input);
    expect(first.status(), await describe(first)).toBe(201);
    const code = (await json(first)).entrega.codigoEntrega;
    const again = await call("POST", "/entregas", input);
    expect(again.status(), await describe(again)).toBe(200);
    expect(again.headers()["idempotent-replayed"]).toBe("true");
    const againBody = await json(again);
    expect(againBody.duplicada).toBe(true);
    expect(againBody.entrega.codigoEntrega).toBe(code);
    expect(await deliveriesForSale(input.idVenda)).toHaveLength(1);

    const burst = sale();
    const responses = await Promise.all(Array.from({ length: 6 }, () => call("POST", "/entregas", burst)));
    const statuses = responses.map((res) => res.status()).sort();
    expect(statuses.filter((status) => status === 201), statuses.join(",")).toHaveLength(1);
    expect(statuses.filter((status) => status === 200), statuses.join(",")).toHaveLength(5);
    const codesReturned = new Set(await Promise.all(responses.map(async (res) => (await json(res)).entrega.codigoEntrega)));
    expect(codesReturned.size).toBe(1);
    expect(await deliveriesForSale(burst.idVenda)).toHaveLength(1);
  });

  test("Falha de conexão: o ERP reenvia depois de cair a conexão e continua uma entrega só", async () => {
    const input = sale();
    // Simula a conexão caindo logo depois do envio (o ERP não recebe a resposta).
    const aborted = await fetch(`${API_URL}/api/v1/erp/entregas`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(input),
      signal: AbortSignal.timeout(5),
    }).catch((error: Error) => error);
    expect(aborted).toBeInstanceOf(Error);
    await expect.poll(async () => (await deliveriesForSale(input.idVenda)).length, { timeout: 10_000 }).toBeLessThanOrEqual(1);
    // Reenvio (como o ERP faria): 201 se a primeira não chegou, 200 duplicada se chegou.
    const retry = await call("POST", "/entregas", input);
    expect([200, 201], await describe(retry)).toContain(retry.status());
    const retryAgain = await call("POST", "/entregas", input);
    expect(retryAgain.status()).toBe(200);
    expect(await deliveriesForSale(input.idVenda)).toHaveLength(1);
  });

  test("Dados incompletos ou inválidos voltam 400 com a lista de campos", async () => {
    const missing = await expectErp(
      await call("POST", "/entregas", { idVenda: saleId(), codigoFilial: codes.a, cliente: {}, endereco: {} }),
      400,
      "DADOS_INVALIDOS",
    );
    const fields = missing.erro.detalhes.map((item: { campo: string }) => item.campo);
    expect(fields).toEqual(expect.arrayContaining(["cliente.nome", "endereco.rua"]));
    const bad = await expectErp(
      await call("POST", "/entregas", sale({ pedido: { formaPagamento: "BOLETO", valorTotal: "abc" } })),
      400,
      "DADOS_INVALIDOS",
    );
    expect(bad.erro.detalhes.map((item: { campo: string }) => item.campo)).toEqual(
      expect.arrayContaining(["pedido.formaPagamento", "pedido.valorTotal"]),
    );
    await expectErp(await call("POST", "/entregas", sale({ idVenda: "venda com espaço" })), 400, "DADOS_INVALIDOS");
    await expectErp(await call("POST", "/entregas", sale({ pedido: { valorTotal: 10 } })), 422, "FORMA_PAGAMENTO_OBRIGATORIA");
    const malformed = await erp.fetch("entregas", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      data: "{ venda: quebrada",
      failOnStatusCode: false,
    });
    await expectErp(malformed, 400, "JSON_INVALIDO");
    expect(await query(`select 1 from deliveries where erp_sale_id is not null`)).toHaveLength(0);
  });

  test("Filial não cadastrada, sem taxa ou inativa: erro auditado e reprocessamento depois de corrigir", async () => {
    await expectErp(await call("POST", "/entregas", sale({ codigoFilial: codes.zeroFee })), 422, "FILIAL_SEM_TARIFA");
    await expectErp(await call("POST", "/entregas", sale({ codigoFilial: codes.inactive })), 422, "FILIAL_INATIVA");
    const input = sale({ codigoFilial: "E2E-999" });
    await expectErp(await call("POST", "/entregas", input), 422, "FILIAL_NAO_CADASTRADA");
    expect(await deliveriesForSale(input.idVenda)).toHaveLength(0);

    const admin = await Api.as("developer");
    const failed = await json(await admin.get(`/admin/erp/events?outcome=FAILED&q=${input.idVenda}`));
    expect(failed).toHaveLength(1);
    expect(failed[0]).toMatchObject({ errorCode: "FILIAL_NAO_CADASTRADA", canReprocess: true, saleId: input.idVenda, storeCode: "E2E-999" });
    expect(failed[0].payload.cliente.nome).toBe("E2E Cliente ERP Conceição");

    // Reprocessar sem corrigir: continua com erro, com o motivo.
    const stillFailing = await json(await admin.post(`/admin/erp/events/${failed[0].id}/reprocess`));
    expect(stillFailing).toMatchObject({ outcome: "FAILED", errorCode: "FILIAL_NAO_CADASTRADA", reprocessOf: failed[0].id });
    // O evento original não pode ser reprocessado de novo.
    expect((await admin.post(`/admin/erp/events/${failed[0].id}/reprocess`)).status()).toBe(409);

    // Corrige: a filial B passa a ter o código E2E-999.
    expect((await admin.put(`/admin/erp/stores/${stores.b.id}`, { erpCode: "E2E-999" })).status()).toBe(200);
    // Código repetido em outra filial é recusado.
    expect((await admin.put(`/admin/erp/stores/${stores.a.id}`, { erpCode: "e2e-999" })).status()).toBe(409);
    const fixed = await json(await admin.post(`/admin/erp/events/${stillFailing.id}/reprocess`));
    expect(fixed).toMatchObject({ outcome: "CREATED", reprocessOf: stillFailing.id });
    expect(fixed.deliveryCode).toMatch(/^MM-/);
    const [row] = await deliveriesForSale(input.idVenda);
    expect(row.store_id).toBe(stores.b.id);
    // Reenvio do ERP depois do reprocessamento: duplicada, sem nova entrega.
    expect((await call("POST", "/entregas", input)).status()).toBe(200);
    expect(await deliveriesForSale(input.idVenda)).toHaveLength(1);
    await admin.put(`/admin/erp/stores/${stores.b.id}`, { erpCode: null });
  });

  test("Consulta de status pela venda", async () => {
    const input = sale();
    await call("POST", "/entregas", input);
    const res = await call("GET", `/entregas/${input.idVenda}`);
    expect(res.status(), await describe(res)).toBe(200);
    const body = await json(res);
    expect(body.entrega).toMatchObject({ idVenda: input.idVenda, status: "OFFERED", situacao: "Aguardando um motoboy aceitar" });
    expect(body.entrega.historico.length).toBeGreaterThanOrEqual(2);
    expect(body.entrega).not.toHaveProperty("courierId");
    await expectErp(await call("GET", "/entregas/E2E-NAO-EXISTE"), 404, "VENDA_NAO_ENCONTRADA");
  });

  test("Atualização: dados livres enquanto aberta; endereço só antes do motoboy aceitar; filial não muda", async () => {
    const courier = await Api.as("courier");
    await courierOnline(courier);
    const input = sale();
    await call("POST", "/entregas", input);
    const [row] = await deliveriesForSale(input.idVenda);

    const phone = await call("PATCH", `/entregas/${input.idVenda}`, { cliente: { telefone: "31988887777" }, pedido: { formaPagamento: "PIX" } });
    expect(phone.status(), await describe(phone)).toBe(200);
    const phoneBody = await json(phone);
    expect(phoneBody.alterada).toBe(true);
    expect(phoneBody.entrega.cliente).toEqual({ nome: "E2E Cliente ERP Conceição", telefone: "31988887777" });
    expect(phoneBody.entrega.pagamento.formaPagamento).toBe("PIX");
    expect(phoneBody.entrega.pagamento.trocoPara).toBeNull();
    expect(phoneBody.entrega.pagamento.valorProdutos).toBe(48.9);

    const same = await json(await call("PATCH", `/entregas/${input.idVenda}`, { cliente: { telefone: "31988887777" } }));
    expect(same.alterada).toBe(false);

    const newAddress = { rua: "Avenida Afonso Pena", numero: "1500", bairro: "Centro", cidade: "Belo Horizonte", estado: "MG" };
    const moved = await call("PATCH", `/entregas/${input.idVenda}`, { endereco: newAddress });
    expect(moved.status(), await describe(moved)).toBe(200);
    expect((await json(moved)).entrega.endereco).toBe("Avenida Afonso Pena, 1500 - Centro, Belo Horizonte - MG");

    await expectErp(await call("PATCH", `/entregas/${input.idVenda}`, { codigoFilial: "E2E-ZERO" }), 409, "FILIAL_NAO_ALTERAVEL");

    const accepted = await setStatus(courier, row.id, "ACCEPTED");
    expect(accepted.status(), await describe(accepted)).toBe(200);
    await expectErp(
      await call("PATCH", `/entregas/${input.idVenda}`, { endereco: { ...newAddress, numero: "1600" } }),
      409,
      "ENDERECO_BLOQUEADO",
    );
    const note = await call("PATCH", `/entregas/${input.idVenda}`, { pedido: { observacoes: "Ligar antes." } });
    expect(note.status(), await describe(note)).toBe(200);
    const status = await json(await call("GET", `/entregas/${input.idVenda}`));
    expect(status.entrega.motoboy?.nome).toBeTruthy();
    expect(status.entrega.status).toBe("ACCEPTED");
    await expectErp(await call("PATCH", "/entregas/E2E-NAO-EXISTE", { cliente: { telefone: "1" } }), 404, "VENDA_NAO_ENCONTRADA");
  });

  test("Cancelamento pelo ERP libera o motoboy, é idempotente e encerra a entrega", async () => {
    const courier = await Api.as("courier");
    await courierOnline(courier);
    const input = sale();
    await call("POST", "/entregas", input);
    const [row] = await deliveriesForSale(input.idVenda);
    expect((await setStatus(courier, row.id, "ACCEPTED")).status()).toBe(200);
    expect((await query(`select status from couriers where id = 'e2e-courier-1'`))[0].status).toBe("BUSY");

    const cancel = await call("POST", `/entregas/${input.idVenda}/cancelar`, { motivo: "Venda estornada no caixa" });
    expect(cancel.status(), await describe(cancel)).toBe(200);
    const body = await json(cancel);
    expect(body).toMatchObject({ jaEstavaCancelada: false, entrega: { status: "CANCELLED", situacao: "Cancelada" } });
    expect(body.entrega.historico.at(-1).descricao).toBe("Cancelada pelo ERP · Motivo: Venda estornada no caixa");
    expect((await query(`select status from couriers where id = 'e2e-courier-1'`))[0].status).toBe("AVAILABLE");

    const again = await json(await call("POST", `/entregas/${input.idVenda}/cancelar`));
    expect(again.jaEstavaCancelada).toBe(true);
    await expectErp(await call("PATCH", `/entregas/${input.idVenda}`, { cliente: { telefone: "1" } }), 409, "ENTREGA_ENCERRADA");
    await expectErp(await call("POST", "/entregas/E2E-NAO-EXISTE/cancelar"), 404, "VENDA_NAO_ENCONTRADA");

    // Entrega concluída não pode ser cancelada.
    const done = sale();
    await call("POST", "/entregas", done);
    const [doneRow] = await deliveriesForSale(done.idVenda);
    await query(`update deliveries set status = 'COMPLETED' where id = $1`, [doneRow.id]);
    await expectErp(await call("POST", `/entregas/${done.idVenda}/cancelar`), 409, "ENTREGA_ENCERRADA");
  });

  test("Pedido já pago: motoboy não cobra nada", async () => {
    const input = sale({ pedido: { valorTotal: 30, pago: true } });
    const res = await call("POST", "/entregas", input);
    expect(res.status(), await describe(res)).toBe(201);
    const body = await json(res);
    expect(body.entrega.pagamento).toMatchObject({ formaPagamento: "PAGO", pago: true, valorCobrarNaEntrega: 0 });
    const zero = await json(await call("POST", "/entregas", sale({ pedido: { valorTotal: 30, formaPagamento: "PIX", valorReceber: 0 } })));
    expect(zero.entrega.pagamento.pago).toBe(true);
  });

  test("Limite de requisições por credencial (429 com Retry-After)", async () => {
    await query(
      `insert into erp_integration_events (id, credential_id, operation, outcome, http_status, created_at)
       select 'e2e-rate-' || g, $1, 'QUERY', 'OK', 200, now() from generate_series(1, 120) g`,
      [credentialId],
    );
    try {
      const res = await call("GET", "/entregas/qualquer");
      await expectErp(res, 429, "LIMITE_REQUISICOES");
      expect(res.headers()["retry-after"]).toBe("60");
    } finally {
      await query(`delete from erp_integration_events where id like 'e2e-rate-%'`);
    }
  });

  test("Painel Integração ERP é só do desenvolvedor", async () => {
    for (const role of ["admin", "central", "manager", "courier"] as const) {
      const api = await Api.as(role);
      for (const path of ["/admin/erp/summary", "/admin/erp/credentials", "/admin/erp/stores", "/admin/erp/events"]) {
        expect((await api.get(path)).status(), `${role} ${path}`).toBe(403);
      }
      expect((await api.post("/admin/erp/credentials", { name: "E2E hack" })).status()).toBe(403);
    }
    const admin = await Api.as("developer");
    const input = sale();
    await call("POST", "/entregas", input);
    const summary = await json(await admin.get("/admin/erp/summary"));
    expect(summary).toMatchObject({ operational: true, databaseOk: true });
    expect(summary.baseUrl).toMatch(/\/api\/v1\/erp$/);
    expect(summary.activeCredentials).toBeGreaterThanOrEqual(1);
    expect(summary.last24h.created).toBeGreaterThanOrEqual(1);
    const mappings = await json(await admin.get("/admin/erp/stores"));
    expect(mappings.find((item: { storeId: string }) => item.storeId === stores.a.id).erpCode).toBe(codes.a);
  });
});
