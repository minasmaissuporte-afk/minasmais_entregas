import { test, expect, type Page } from "@playwright/test";
import { Api, json } from "../../support/api.ts";
import { credentials } from "../../support/auth.ts";
import { stores } from "../../support/fixtures-data.ts";
import { courierOnline, createDelivery, setStatus } from "../../support/helpers.ts";
import { query, setCourierStatus, wipeDeliveries } from "../../support/db.ts";
import { loginAs } from "../../support/ui.ts";

// Roteiro de pré-lançamento: Google Maps, endereços, rotas, notificações, F5, permissões e conta.

const googleErrors = /ApiNotActivatedMapError|RefererNotAllowedMapError|InvalidKeyMapError|MissingKeyMapError|BillingNotEnabledMapError|Google Maps JavaScript API error|can't load Google Maps/i;

function watchGoogle(page: Page) {
  const errors: string[] = [];
  page.on("console", (m) => { if (googleErrors.test(m.text())) errors.push(m.text().slice(0, 200)); });
  return errors;
}

async function waitForGoogleMap(page: Page) {
  await expect(page.locator(".gm-style").first(), "o mapa do Google não carregou").toBeVisible({ timeout: 20_000 });
  await page.waitForTimeout(1500);
  await expect(page.getByText(/Oops! Something went wrong|não pode carregar o Google Maps/i)).toHaveCount(0);
}

test.describe("Mapa (Google Maps)", () => {
  test.beforeAll(async () => {
    await wipeDeliveries();
    const courier = await Api.as("courier");
    await courierOnline(courier);
    const central = await Api.as("central");
    const d = await createDelivery(central, { storeId: stores.a.id, customerName: "E2E Mapa Cliente" });
    await central.post(`/deliveries/${d.id}/dispatch`, { mode: "single", courierId: "e2e-courier-1" });
    for (const s of ["ACCEPTED", "AT_STORE", "IN_TRANSIT"]) await setStatus(central, d.id, s);
    await courierOnline(courier);
  });

  test("Página Entregas (/) carrega o Google Maps sem erro de chave/API e mostra filiais e motoboy", async ({ page }) => {
    const errors = watchGoogle(page);
    await loginAs(page, "central", "/");
    await waitForGoogleMap(page);
    const markers = page.locator("gmp-advanced-marker, [data-map-marker]");
    await expect.poll(() => markers.count(), { timeout: 15_000 }).toBeGreaterThanOrEqual(3); // 3 filiais ativas + motoboy
    expect(errors).toEqual([]);
  });

  test("Zoom pelos botões e arrasto mudam o mapa", async ({ page }) => {
    await loginAs(page, "central", "/");
    await waitForGoogleMap(page);
    const map = page.locator(".gm-style").first();
    const before = await map.screenshot();
    const zoomIn = page.locator('button[aria-label*="zoom" i], button[title*="zoom" i]').first();
    await expect(zoomIn, "botão de zoom do mapa").toBeVisible();
    await zoomIn.click();
    await page.waitForTimeout(1500);
    const afterZoom = await map.screenshot();
    expect(Buffer.compare(before, afterZoom), "o zoom não mudou o mapa").not.toBe(0);
    const box = (await map.boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 - 150, box.y + box.height / 2 - 80, { steps: 10 });
    await page.mouse.up();
    await page.waitForTimeout(1200);
    expect(Buffer.compare(afterZoom, await map.screenshot()), "o arrasto não moveu o mapa").not.toBe(0);
  });

  test("Celular: deslizar o dedo sobre o mapa rola a página (o mapa não prende a rolagem)", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await loginAs(page, "central", "/user-portal");
    await waitForGoogleMap(page);
    const map = page.locator(".gm-style").first();
    await map.scrollIntoViewIfNeeded();
    const box = (await map.boundingBox())!;
    const before = await page.evaluate(() => window.scrollY);
    // Rolagem com o mapa sob o ponteiro: com gestureHandling "cooperative" a página rola
    // (o toque com um dedo segue a mesma regra; o gesto de toque sintético não funciona no navegador de teste).
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.wheel(0, 300);
    await page.waitForTimeout(800);
    const after = await page.evaluate(() => window.scrollY);
    expect(after - before, "a página não rolou ao deslizar sobre o mapa").toBeGreaterThan(100);
  });

  test("[FALTA] Detalhe da entrega mostra o mapa da entrega", async ({ page }) => {
    const [row] = await query("select id from deliveries where customer_name = 'E2E Mapa Cliente' limit 1");
    await loginAs(page, "central", `/deliveries/${row.id}`);
    await expect(page.getByRole("heading", { name: "Informações da entrega" })).toBeVisible({ timeout: 20_000 });
    await expect(page.locator(".gm-style").first(), "não há mapa no detalhe da entrega").toBeVisible({ timeout: 10_000 });
  });
});

test.describe("Cancelar e excluir pela tela", () => {
  test("Central cancela pela fila com motivo; Admin exclui; Central não vê o botão excluir", async ({ page }) => {
    await wipeDeliveries();
    const central = await Api.as("central");
    const toCancel = await createDelivery(central, { storeId: stores.a.id, customerName: "E2E Cancelar Pela Tela" });
    const toDelete = await createDelivery(central, { storeId: stores.a.id, customerName: "E2E Excluir Pela Tela" });
    await loginAs(page, "central", "/entregas");
    await expect(page.getByText("E2E Excluir Pela Tela").first()).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId(`button-delete-delivery-${toDelete.id}`)).toHaveCount(0);
    await page.getByTestId(`button-cancel-${toCancel.id}`).click();
    const reason = page.getByTestId("input-cancel-reason");
    if (await reason.isVisible().catch(() => false)) await reason.fill("Cliente desistiu do pedido (teste E2E)");
    await page.getByTestId("button-confirm-cancel").click();
    await expect.poll(async () => (await json(await central.get(`/deliveries/${toCancel.id}`))).status, { timeout: 15_000 }).toBe("CANCELLED");

    await page.context().clearCookies();
    await page.evaluate(() => localStorage.clear());
    await loginAs(page, "admin", "/entregas");
    const del = page.locator(`[data-testid^="button-delete"][data-testid$="${toDelete.id}"]`).first();
    await expect(del, "Admin não vê o botão excluir").toBeVisible({ timeout: 20_000 });
    await del.click();
    await page.getByTestId("button-confirm-delete-delivery").click();
    await expect.poll(async () => (await central.get(`/deliveries/${toDelete.id}`)).status(), { timeout: 15_000 }).toBe(404);
  });

  test("[FALTA] Editar uma entrega já registrada (endereço, telefone, observações)", async ({ page }) => {
    const central = await Api.as("central");
    const d = await createDelivery(central, { storeId: stores.a.id, customerName: "E2E Editar" });
    await loginAs(page, "central", `/deliveries/${d.id}`);
    await expect(page.getByRole("heading", { name: "Informações da entrega" })).toBeVisible({ timeout: 20_000 });
    await expect(page.getByRole("button", { name: /Editar/ }).first(), "não existe opção de editar a entrega").toBeVisible({ timeout: 5_000 });
  });
});

test.describe("Foto no detalhe da entrega", () => {
  test("Central abre a foto de comprovação pelo detalhe da entrega", async ({ page }) => {
    await wipeDeliveries();
    const central = await Api.as("central");
    const courier = await Api.as("courier");
    await courierOnline(courier);
    const d = await createDelivery(central, { storeId: stores.a.id, customerName: "E2E Foto Detalhe" });
    await central.post(`/deliveries/${d.id}/dispatch`, { mode: "single", courierId: "e2e-courier-1" });
    for (const s of ["ACCEPTED", "AT_STORE", "IN_TRANSIT"]) await setStatus(central, d.id, s);
    const up = await json(await courier.post(`/deliveries/${d.id}/evidence/upload-url`, { name: "f.jpg", size: 200, contentType: "image/jpeg" }));
    const jpeg = await page.screenshot({ type: "jpeg", quality: 60 });
    await fetch(up.uploadURL, { method: "PUT", headers: { "Content-Type": "image/jpeg" }, body: new Uint8Array(jpeg) });
    expect((await setStatus(courier, d.id, "COMPLETED", { evidencePath: up.objectPath })).status()).toBe(200);

    await loginAs(page, "central", `/deliveries/${d.id}`);
    const link = page.getByTestId(`link-evidence-${d.id}`).or(page.getByRole("link", { name: /foto|comprova/i })).first();
    await expect(link, "não há acesso à foto no detalhe").toBeVisible({ timeout: 20_000 });
    const [popup] = await Promise.all([page.context().waitForEvent("page"), link.click()]);
    await popup.waitForLoadState();
    const body = (await popup.locator("body").innerText().catch(() => "")).slice(0, 200);
    const isImage = await popup.evaluate(() => document.contentType.startsWith("image/"));
    test.info().annotations.push({ type: "nova aba da foto", description: `${popup.url()} → ${isImage ? "imagem" : body}` });
    expect(isImage, `a foto não abre: ${body}`).toBe(true);
  });
});

test.describe("Endereços pela tela", () => {
  test("Nova entrega: digitar endereço, escolher sugestão, digitar o número e o pino cai no lugar certo", async ({ page }) => {
    await loginAs(page, "central", "/entregas");
    await page.getByTestId("button-new-delivery").click();
    const dialog = page.getByRole("dialog", { name: "Registrar entrega" });
    await dialog.getByTestId("input-customer-name").fill("E2E Endereço Pela Tela");
    const address = dialog.getByTestId("input-destination");
    const started = Date.now();
    await address.pressSequentially("Rua Pernambuco, Belo Horizonte", { delay: 30 });
    const options = page.getByRole("listbox", { name: "Sugestões de endereço" }).getByRole("option");
    await expect(options.first(), "nenhuma sugestão apareceu").toBeVisible({ timeout: 10_000 });
    test.info().annotations.push({ type: "tempo", description: `Sugestões apareceram ${Date.now() - started} ms após começar a digitar` });
    await options.first().click();
    await expect(dialog.getByTestId("text-new-delivery-without-pin")).toHaveCount(0);
    // 2º passo: o número é obrigatório e fica num campo separado.
    const number = dialog.getByTestId("input-new-delivery-number");
    await expect(number).toBeVisible();
    expect(await number.evaluate((el: HTMLInputElement) => el.required)).toBe(true);
    await number.fill("1000");
    await number.blur();
    await expect(dialog.getByRole("status").filter({ hasText: /Pino|pino/ })).toBeVisible({ timeout: 10_000 }).catch(() => undefined);
    const order = `PED-END-${Date.now()}`;
    await dialog.getByTestId("input-order-number").fill(order);
    await dialog.getByTestId("select-store").selectOption(stores.a.id);
    await dialog.getByText("Pix", { exact: true }).click();
    await dialog.getByRole("button", { name: "Registrar pedido" }).click();
    await expect(dialog).toBeHidden({ timeout: 15_000 });
    const [row] = await query("select customer_latitude as lat, customer_longitude as lng, destination from deliveries where order_number=$1", [order]);
    expect(row.lat, "entrega salva sem coordenadas").not.toBeNull();
    expect(row.destination).toMatch(/Pernambuco, 1000/);
    expect(Math.abs(row.lat - -19.9359)).toBeLessThan(0.01);
    expect(Math.abs(row.lng - -43.9351)).toBeLessThan(0.01);
    test.info().annotations.push({ type: "endereço salvo", description: row.destination });
  });

  test("Nova entrega: endereço digitado sem escolher sugestão avisa que ficará sem pino", async ({ page }) => {
    await loginAs(page, "central", "/entregas");
    await page.getByTestId("button-new-delivery").click();
    const dialog = page.getByRole("dialog", { name: "Registrar entrega" });
    await dialog.getByTestId("input-destination").fill("Rua Qualquer 123, Belo Horizonte");
    await dialog.getByTestId("input-customer-name").click();
    await expect(dialog.getByTestId("text-new-delivery-without-pin")).toBeVisible();
    await expect(dialog.getByTestId("text-new-delivery-without-pin")).toContainText("Escolha a rua na lista");
    // Sem sugestão escolhida, o campo Número não aparece.
    await expect(dialog.getByTestId("input-new-delivery-number")).toHaveCount(0);
  });

  test("Nova filial: endereço com sugestão preenche os campos, mostra o pino e salva as coordenadas certas", async ({ page }) => {
    await loginAs(page, "admin", "/filiais");
    await page.getByRole("button", { name: /Nova filial/ }).click();
    const name = `E2E Filial Endereço ${Date.now()}`;
    await page.getByLabel("Nome da filial").fill(name);
    await page.getByTestId("input-branch-delivery-fee").fill("7.5");
    await page.getByTestId("input-branch-address").pressSequentially("Avenida Afonso Pena, 1500, Belo Horizonte", { delay: 30 });
    const options = page.getByRole("listbox", { name: "Sugestões de endereço" }).getByRole("option");
    await expect(options.first()).toBeVisible({ timeout: 10_000 });
    await options.first().click();
    // O campo "Rua ou avenida" saiu: a sugestão preenche o endereço completo; o número é separado.
    await expect(page.getByLabel("Rua ou avenida")).toHaveCount(0);
    await expect(page.getByTestId("input-branch-address")).toHaveValue(/Afonso Pena/);
    const number = page.getByLabel("Número", { exact: true });
    const suggestedNumber = await number.inputValue();
    test.info().annotations.push({ type: "número após a sugestão", description: suggestedNumber || "(vazio)" });
    if (suggestedNumber !== "1500") await number.fill("1500");
    await number.blur();
    await expect(page.getByLabel("Cidade")).toHaveValue("Belo Horizonte");
    test.info().annotations.push({ type: "complemento sugerido", description: (await page.getByLabel("Complemento").inputValue()) || "(vazio)" });
    await expect(page.locator(".gm-style").last(), "mapa do formulário com o pino").toBeVisible({ timeout: 15_000 });
    await page.getByLabel("Nome do gerente").fill("E2E Gerente Afonso Pena");
    await page.getByRole("button", { name: "Cadastrar filial" }).click();
    await expect.poll(async () => (await query("select latitude, longitude from stores where name=$1", [name]))[0], { timeout: 15_000 }).toBeTruthy();
    const [row] = await query("select latitude, longitude from stores where name=$1", [name]);
    expect(Math.abs(row.latitude - -19.9245)).toBeLessThan(0.01);
    expect(Math.abs(row.longitude - -43.9352)).toBeLessThan(0.01);
  });
});

test.describe("Rota pela tela da Central", () => {
  test("Selecionar 2 entregas e criar rota agrupada", async ({ page }) => {
    await wipeDeliveries();
    const central = await Api.as("central");
    const d1 = await createDelivery(central, { storeId: stores.a.id, customerName: "E2E Rota Tela 1" });
    const d2 = await createDelivery(central, { storeId: stores.a.id, customerName: "E2E Rota Tela 2" });
    await loginAs(page, "central", "/entregas");
    for (const d of [d1, d2]) await page.getByLabel(`Selecionar ${d.code} para uma rota`).check();
    await expect(page.getByTestId("button-create-route")).toHaveText(/Montar rota com 2/);
    await page.getByTestId("button-create-route").click();
    const modal = page.getByRole("dialog", { name: "Montar rota com 2 entregas" });
    await expect(modal).toBeVisible();
    // "Quem vai levar": sem escolha, a rota é oferecida a todos os motoboys disponíveis.
    await expect(modal.getByLabel("Quem vai levar")).toHaveValue("");
    await modal.getByTestId("button-confirm-route").click();
    await expect(modal).toBeHidden({ timeout: 15_000 });
    await expect(page.getByText("Rota com 2 entregas oferecida a todos os motoboys disponíveis.")).toBeVisible();
    await expect.poll(async () => (await query("select count(*)::int as n from delivery_routes where $1 = any(delivery_ids)", [d1.id]))[0].n, { timeout: 15_000 }).toBe(1);
    await expect.poll(async () => (await json(await central.get(`/deliveries/${d2.id}`))).status).toBe("OFFERED");
  });
});

test.describe("Atualizar a página (F5) e sair/entrar", () => {
  const pages: [string, RegExp | string][] = [
    ["/user-portal", /^Entregas$/], ["/entregas", /^Entregas$/],
    ["/motoboys", /^Motoboys$/], ["/reports", /Relatórios e indicadores/], ["/account", /Alterar senha/],
  ];
  for (const [path, heading] of pages) {
    test(`F5 em ${path} mantém o login e a mesma tela`, async ({ page }) => {
      await loginAs(page, "central", path);
      await expect(page.getByRole("heading", { level: 1, name: heading })).toBeVisible({ timeout: 20_000 });
      await page.reload();
      await expect(page).toHaveURL(new RegExp(`${path}$`));
      await expect(page.getByRole("heading", { level: 1, name: heading })).toBeVisible({ timeout: 20_000 });
    });
  }

  test("/mapa (aba removida) redireciona para a página Entregas", async ({ page }) => {
    await loginAs(page, "central", "/mapa");
    await expect(page).toHaveURL(/^https?:\/\/[^/]+\/$/);
    await expect(page.getByRole("heading", { level: 1, name: /^Entregas$/ })).toBeVisible({ timeout: 20_000 });
    await page.reload();
    await expect(page.getByRole("heading", { level: 1, name: /^Entregas$/ })).toBeVisible({ timeout: 20_000 });
  });

  test("Sair e entrar de novo volta para a página Entregas", async ({ page }) => {
    await loginAs(page, "central", "/entregas");
    await page.getByRole("button", { name: /menu da conta/i }).click();
    await page.getByRole("menuitem", { name: /Sair/ }).click();
    await page.waitForURL((u) => !/entregas/.test(u.pathname), { timeout: 15_000 });
    await page.waitForLoadState("networkidle");
    await loginAs(page, "central");
    await expect(page.getByRole("heading", { level: 1, name: /^Entregas$/ })).toBeVisible({ timeout: 20_000 });
  });
});

test.describe("Permissões: abrir páginas proibidas digitando o endereço", () => {
  const forbidden = ["/entregas", "/motoboys", "/reports", "/access", "/filiais"];
  for (const role of ["manager", "courier", "pending"] as const) {
    test(`${role}: nenhuma página da Central abre`, async ({ page }) => {
      const [d] = await query("select id from deliveries limit 1");
      await loginAs(page, role);
      for (const path of [...forbidden, ...(d ? [`/deliveries/${d.id}`] : [])]) {
        await page.goto(path);
        await page.waitForTimeout(1200);
        await expect(page.getByTestId("button-new-delivery"), `${role} vê a fila em ${path}`).toHaveCount(0);
        await expect(page.getByText("Contas cadastradas"), `${role} vê acessos em ${path}`).toHaveCount(0);
        await expect(page.getByText("Filiais cadastradas"), `${role} vê filiais em ${path}`).toHaveCount(0);
        await expect(page.getByTestId("report-delivery-table"), `${role} vê relatórios em ${path}`).toHaveCount(0);
        await expect(page.locator("#operation-title"), `${role} vê a página Entregas da Central em ${path}`).toHaveCount(0);
        await expect(page.getByRole("heading", { name: /Informações da entrega|Relatórios e indicadores/ }), `${role} em ${path}`).toHaveCount(0);
      }
    });
  }
});

test.describe("Relatórios batem com as entregas", () => {
  test("Números do relatório = contagem real no banco (hoje)", async ({ page }) => {
    const today = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date());
    const [db] = await query(`select count(*)::int as total,
      count(*) filter (where status='COMPLETED')::int as completed,
      count(*) filter (where status in ('CANCELLED','NOT_DELIVERED'))::int as cancelled
      from deliveries where (created_at at time zone 'America/Sao_Paulo')::date = $1::date`, [today]);
    // O relatório geral é do admin/Central (o gerente vê só a "Contabilidade da filial").
    await loginAs(page, "admin", "/reports");
    await page.getByTestId("filter-report-from").fill(today);
    await page.getByTestId("filter-report-to").fill(today);
    await expect(page.getByTestId("report-stage-cards")).toBeVisible({ timeout: 20_000 });
    await page.waitForTimeout(2500);
    const metric = async (testId: string) =>
      Number((await page.getByTestId(testId).getByTestId("report-metric-value").innerText()).replace(/\D/g, ""));
    test.info().annotations.push({ type: "banco (hoje)", description: JSON.stringify(db) });
    // O card "Entregas concluídas" saiu: o número de concluídas está no card de etapa "Concluídas".
    expect(await metric("report-metric-entregas-registradas"), "Entregas registradas").toBe(db.total);
    expect(await metric("report-metric-concluídas"), "Concluídas").toBe(db.completed);
    expect(await metric("report-metric-canceladas"), "Canceladas").toBe(db.cancelled);
  });
});

test.describe("Conta: código de acesso e redefinição de senha", () => {
  const otpEmail = "e2e-codigo@example.com";
  const resetEmail = "e2e-redefinir@example.com";
  const admin = async (path: string, init: RequestInit = {}) => {
    const key = process.env.SUPABASE_SECRET_KEY!;
    return fetch(`${process.env.SUPABASE_URL}/auth/v1/admin${path}`, {
      ...init,
      headers: { apikey: key, ...(key.startsWith("sb_secret_") ? {} : { Authorization: `Bearer ${key}` }), "Content-Type": "application/json" },
    });
  };
  const ensureUser = async (email: string, password: string) => {
    const created = await admin("/users", { method: "POST", body: JSON.stringify({ email, password, email_confirm: true }) });
    if (!created.ok) {
      const list = await (await admin(`/users?per_page=200`)).json();
      const u = list.users.find((x: { email: string }) => x.email === email);
      await admin(`/users/${u.id}`, { method: "PUT", body: JSON.stringify({ password }) });
    }
  };
  test.afterAll(async () => {
    const list = await (await admin(`/users?per_page=200`)).json();
    for (const u of list.users ?? []) if ([otpEmail, resetEmail].includes(u.email)) await admin(`/users/${u.id}`, { method: "DELETE" });
    await query("delete from app_users where email = any($1)", [[otpEmail, resetEmail]]);
  });

  test("Entrar 'Sem senha': código errado é recusado e o código certo entra", async ({ page }) => {
    await ensureUser(otpEmail, `Senha!${Date.now()}`);
    await page.goto("/sign-in");
    await page.getByRole("button", { name: "Sem senha" }).click();
    await page.getByLabel("E-mail").fill(otpEmail);
    await page.locator('form button[type="submit"]').click();
    const codeField = page.getByLabel("Código");
    const sendError = page.locator("[role=alert], .text-red-700, .text-destructive").first();
    await expect(codeField.or(sendError)).toBeVisible({ timeout: 20_000 });
    if (!(await codeField.isVisible())) {
      test.info().annotations.push({ type: "envio do código falhou", description: (await sendError.textContent()) ?? "" });
      expect(await codeField.isVisible(), "a tela não aceitou enviar o código").toBe(true);
    }
    await codeField.fill("000000");
    await page.locator('form button[type="submit"]').click();
    const wrong = page.locator("[role=alert], .text-red-700, .text-destructive, p").filter({ hasText: /inválid|expirad|incorret/i }).first();
    await expect(wrong, "código errado sem mensagem de erro").toBeVisible({ timeout: 15_000 });
    test.info().annotations.push({ type: "mensagem do código errado", description: (await wrong.textContent()) ?? "" });
    // Código válido gerado pelo Supabase (sem depender da caixa de e-mail).
    const link = await (await admin("/generate_link", { method: "POST", body: JSON.stringify({ type: "magiclink", email: otpEmail }) })).json();
    const code = link.email_otp ?? link.properties?.email_otp;
    test.info().annotations.push({ type: "tamanho do código", description: `${String(code).length} dígitos` });
    expect(String(code)).toMatch(/^\d{6}$/);
    await codeField.fill(code);
    await page.locator('form button[type="submit"]').click();
    await page.waitForURL((u) => !u.pathname.startsWith("/sign-in"), { timeout: 20_000 });
    await expect(page.getByRole("heading", { name: "Acesso aguardando aprovação" })).toBeVisible({ timeout: 20_000 });
  });

  test("Esqueci a senha: com sessão de recuperação, 'Criar nova senha' troca a senha e a nova senha entra", async ({ page }) => {
    // O painel usa PKCE: o link do e-mail só funciona no navegador que pediu. Sem caixa de e-mail,
    // abrimos a sessão de recuperação pelo código de recuperação do Supabase e testamos a tela de nova senha.
    await ensureUser(resetEmail, `Antiga!${Date.now()}`);
    const link = await (await admin("/generate_link", { method: "POST", body: JSON.stringify({ type: "recovery", email: resetEmail }) })).json();
    const otp = link.email_otp ?? link.properties?.email_otp;
    const publishable = process.env.VITE_SUPABASE_PUBLISHABLE_KEY!;
    const verify = await fetch(`${process.env.SUPABASE_URL}/auth/v1/verify`, {
      method: "POST",
      headers: { apikey: publishable, "Content-Type": "application/json" },
      body: JSON.stringify({ type: "recovery", email: resetEmail, token: otp }),
    });
    expect(verify.status, "código de recuperação recusado").toBe(200);
    const session = await verify.json();
    const ref = new URL(process.env.SUPABASE_URL!).hostname.split(".")[0];
    await page.goto("/sign-in");
    await page.evaluate(([key, value]) => localStorage.setItem(key, value), [`sb-${ref}-auth-token`, JSON.stringify(session)]);
    await page.goto("/redefinir-senha");
    await expect(page.getByRole("heading", { name: "Criar nova senha" })).toBeVisible({ timeout: 15_000 });
    // Validações da tela.
    await page.getByLabel("Nova senha", { exact: true }).fill("1234567");
    await page.getByLabel("Confirmar nova senha").fill("1234567");
    await page.locator('form button[type="submit"]').click();
    await expect(page.getByText(/pelo menos 8 caracteres/).first()).toBeVisible();
    const newPassword = `Nova!${Date.now()}`;
    await page.getByLabel("Nova senha", { exact: true }).fill(newPassword);
    await page.getByLabel("Confirmar nova senha").fill(newPassword);
    await page.locator('form button[type="submit"]').click();
    await page.waitForTimeout(2500);
    test.info().annotations.push({ type: "depois de salvar a nova senha", description: page.url() });
    await page.context().clearCookies();
    await page.evaluate(() => localStorage.clear());
    await page.goto("/sign-in");
    await page.getByLabel("E-mail").fill(resetEmail);
    await page.getByLabel("Senha", { exact: true }).fill(newPassword);
    await page.getByRole("button", { name: "Entrar", exact: true }).click();
    await page.waitForURL((u) => !u.pathname.startsWith("/sign-in"), { timeout: 20_000 });
  });

  test("'Entrar com Google' só aparece com o provedor ativo e nunca leva a erro cru", async ({ page }) => {
    const settings = await (await fetch(`${process.env.SUPABASE_URL}/auth/v1/settings`, { headers: { apikey: process.env.VITE_SUPABASE_PUBLISHABLE_KEY! } })).json();
    await page.goto("/sign-in");
    await expect(page.getByRole("heading", { name: "Bem-vindo de volta" })).toBeVisible();
    await page.waitForTimeout(1500);
    const button = page.getByRole("button", { name: /Entrar com Google/ });
    test.info().annotations.push({ type: "provedor Google no Supabase", description: String(settings.external?.google) });
    if (!settings.external?.google) {
      await expect(button, "botão do Google aparece com o provedor desligado").toHaveCount(0);
      return;
    }
    await button.click();
    await page.waitForLoadState("domcontentloaded");
    await page.waitForTimeout(2000);
    const body = (await page.locator("body").innerText()).slice(0, 200);
    test.info().annotations.push({ type: "página depois do clique", description: `${page.url().replace(/\?.*/, "?…")} → ${body}` });
    expect(body, "o botão do Google abriu um erro").not.toMatch(/Unsupported provider|provider is not enabled|validation_failed/);
  });

  test("Cadastro: validações de senha curta e confirmação diferente", async ({ page }) => {
    await page.goto("/sign-up");
    await page.getByLabel("Nome completo").fill("E2E Cadastro");
    await page.getByLabel("E-mail").fill("e2e-cadastro@example.com");
    await page.getByLabel("Senha", { exact: true }).fill("12345678");
    await page.getByLabel("Confirmar senha").fill("87654321");
    await page.getByRole("button", { name: /Solicitar|Criar|Cadastrar/ }).last().click();
    await expect(page.getByText("A confirmação não corresponde à senha.")).toBeVisible();
  });

  test("[ROTEIRO] Cadastro pede o código de 6 dígitos enviado por e-mail", async ({ page }) => {
    // O roteiro de teste diz que o cadastro usa código de 6 dígitos; a tela atual fala em "link de confirmação".
    const source = await (await fetch(new URL("/src/pages/auth-pages.tsx", "http://localhost:5173"))).text().catch(() => "");
    expect(source.includes("Enviamos um link de confirmação"), "a tela de cadastro manda link, não código").toBe(false);
    void page; void credentials;
  });
});
