import { test, expect } from "@playwright/test";
import { stores } from "../../support/fixtures-data.ts";
import { query, wipeDeliveries, setCourierStatus } from "../../support/db.ts";
import { Api, json } from "../../support/api.ts";
import { createDelivery, setStatus } from "../../support/helpers.ts";
import { expectAccessible, loginAs, trackErrors } from "../../support/ui.ts";

test.describe("Central: visão geral e entregas", () => {
  test.beforeAll(wipeDeliveries);

  // A página inicial do Admin/Central agora é "Entregas" (mapa grande + fila + motoboys ativos).
  test("Central entra e cai na página Entregas sem erros", async ({ page }) => {
    const errors = trackErrors(page);
    await loginAs(page, "central");
    await expect(page.getByRole("heading", { level: 1, name: "Entregas" })).toBeVisible({ timeout: 20_000 });
    await expect(page.locator("#operation-title")).toHaveText("Entregas");
    await expect(page.getByRole("heading", { name: /Todas as entregas/ })).toBeVisible();
    await expect(page.getByRole("navigation", { name: "Navegação principal" }).getByRole("link", { name: /^Entregas/ })).toBeVisible();
    expect(errors).toEqual([]);
  });

  test("Menu lateral leva a Motoboys, Relatórios e Entregas (sem a aba Mapa)", async ({ page }) => {
    await loginAs(page, "central");
    const nav = page.getByRole("navigation", { name: "Navegação principal" });
    // A aba "Mapa em tempo real" saiu: o mapa está na página Entregas.
    await expect(nav.getByRole("link", { name: /Mapa/ })).toHaveCount(0);
    for (const [link, heading, path] of [["Motoboys", /^Motoboys$/, /\/motoboys$/], ["Relatórios", /Relatórios e indicadores/, /\/reports$/], ["Entregas", /^Entregas$/, /^https?:\/\/[^/]+\/$/]] as const) {
      await nav.getByRole("link", { name: new RegExp(`^${link}`) }).click();
      await expect(page).toHaveURL(path);
      await expect(page.getByRole("heading", { level: 1, name: heading })).toBeVisible({ timeout: 15_000 });
    }
  });

  test("Registrar entrega pelo formulário: tarifa da filial em R$, pagamento e pedido aparece na fila", async ({ page }) => {
    await loginAs(page, "central", "/entregas");
    await page.getByTestId("button-new-delivery").click();
    const dialog = page.getByRole("dialog", { name: "Registrar entrega" });
    await expect(dialog).toBeVisible();
    // O campo Prioridade saiu do formulário.
    await expect(dialog.getByText(/Prioridade/)).toHaveCount(0);
    const order = `PED-UI-${Date.now()}`;
    await dialog.getByTestId("input-customer-name").fill("E2E Cliente Formulário Ávila");
    await dialog.getByTestId("input-customer-phone").fill("(31) 98765-4321");
    // Endereço em 2 passos: escolher a sugestão e digitar o número.
    await dialog.getByTestId("input-destination").pressSequentially("Rua Cláudio Manoel, Belo Horizonte", { delay: 30 });
    const option = page.getByRole("listbox", { name: "Sugestões de endereço" }).getByRole("option").first();
    await expect(option, "nenhuma sugestão de endereço").toBeVisible({ timeout: 20_000 });
    await option.click();
    const number = dialog.getByTestId("input-new-delivery-number");
    await expect(number).toBeVisible();
    await number.fill("500");
    await dialog.getByTestId("input-order-number").fill(order);
    await dialog.getByTestId("select-store").selectOption(stores.a.id);
    await expect(dialog.getByTestId("text-delivery-fee")).toHaveValue(/R\$\s?8,50/);
    await dialog.getByText("Pix", { exact: true }).click();
    await expect(dialog.getByTestId("radio-payment-pix")).toBeChecked();
    await dialog.getByTestId("input-notes").fill("Interfone 102");
    await dialog.getByRole("button", { name: "Registrar pedido" }).click();
    await expect(dialog).toBeHidden({ timeout: 15_000 });
    await page.getByTestId("input-search-deliveries").fill(order);
    await page.getByRole("button", { name: "Buscar" }).click();
    const row = page.getByRole("row").filter({ hasText: "E2E Cliente Formulário Ávila" });
    await expect(row).toBeVisible();
    // Ao registrar, a entrega já vai para os motoboys da cidade (Solicitada / OFFERED).
    await expect(row).toContainText("Solicitada");
    const [saved] = await query("select status, payment_method from deliveries where order_number=$1", [order]);
    expect(saved.status).toBe("OFFERED");
    expect(saved.payment_method).toBe("PIX");
  });

  test("Formulário exige a forma de pagamento; Dinheiro pede troco e Cartão pergunta da maquininha", async ({ page }) => {
    await loginAs(page, "central", "/entregas");
    await page.getByTestId("button-new-delivery").click();
    const dialog = page.getByRole("dialog", { name: "Registrar entrega" });
    await dialog.getByTestId("input-customer-name").fill("E2E Sem Pagamento");
    await dialog.getByTestId("input-destination").fill("Rua Qualquer 123, Belo Horizonte");
    await dialog.getByTestId("input-order-number").fill(`PED-SEMPAG-${Date.now()}`);
    await dialog.getByTestId("select-store").selectOption(stores.a.id);
    await dialog.getByRole("button", { name: "Registrar pedido" }).click();
    await expect(dialog).toBeVisible();
    expect(await dialog.getByTestId("radio-payment-pix").evaluate((el: HTMLInputElement) => !el.validity.valid), "o pagamento não é obrigatório").toBe(true);
    await dialog.getByText("Dinheiro", { exact: true }).click();
    await expect(dialog.getByTestId("input-change-for")).toBeVisible();
    await dialog.getByText("Cartão", { exact: true }).click();
    await expect(dialog.getByText("Levar a maquininha?")).toBeVisible();
    await expect(dialog.getByTestId("input-change-for")).toHaveCount(0);
  });

  test("Formulário não envia sem os campos obrigatórios", async ({ page }) => {
    await loginAs(page, "central", "/entregas");
    await page.getByTestId("button-new-delivery").click();
    const dialog = page.getByRole("dialog", { name: "Registrar entrega" });
    await dialog.getByRole("button", { name: "Registrar pedido" }).click();
    await expect(dialog).toBeVisible();
    expect(await dialog.getByTestId("input-customer-name").evaluate((el: HTMLInputElement) => !el.validity.valid)).toBe(true);
  });

  test("Fechar formulário preenchido pede confirmação; cancelar mantém os dados", async ({ page }) => {
    await loginAs(page, "central", "/entregas");
    await page.getByTestId("button-new-delivery").click();
    const dialog = page.getByRole("dialog", { name: "Registrar entrega" });
    await dialog.getByTestId("input-customer-name").fill("E2E Rascunho");
    page.once("dialog", (d) => d.dismiss());
    await dialog.getByRole("button", { name: "Cancelar" }).click();
    await expect(dialog).toBeVisible();
    await expect(dialog.getByTestId("input-customer-name")).toHaveValue("E2E Rascunho");
    page.once("dialog", (d) => d.accept());
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
  });

  // Não existe mais "Despachar" na fila: a entrega já nasce oferecida à cidade. Quando o motoboy
  // devolve (AWAITING_COURIER), a fila mostra "Reenviar aos motoboys" (um clique).
  test("Entrega devolvida pelo motoboy: 'Reenviar aos motoboys' volta a oferta para a cidade", async ({ page }) => {
    const central = await Api.as("central");
    const d = await createDelivery(central, { customerName: "E2E Reenvio Pela Tela" });
    // Preparação: simula a devolução pelo motoboy direto no banco.
    await query("update deliveries set status='AWAITING_COURIER', courier_id=null, updated_at=now() where id=$1", [d.id]);
    await loginAs(page, "central", "/entregas");
    const row = page.getByTestId(`row-delivery-${d.id}`);
    await expect(row).toContainText("Devolvida pelo motoboy", { timeout: 20_000 });
    await expect(row.getByRole("button", { name: "Despachar" })).toHaveCount(0);
    await row.getByRole("button", { name: "Reenviar aos motoboys" }).click();
    await expect.poll(async () => (await json(await central.get(`/deliveries/${d.id}`))).status, { timeout: 15_000 }).toBe("OFFERED");
    await expect(page.getByText(`${d.code} voltou para a fila dos motoboys.`)).toBeVisible();
  });

  test("Detalhe: 'Enviar só para um motoboy' manda a oferta ao motoboy escolhido", async ({ page }) => {
    await setCourierStatus("e2e-courier-1", "AVAILABLE");
    const central = await Api.as("central");
    const d = await createDelivery(central, { customerName: "E2E Envio Individual" });
    await loginAs(page, "central", `/deliveries/${d.id}`);
    await expect(page.getByText("ENVIAR SÓ PARA UM MOTOBOY")).toBeVisible({ timeout: 20_000 });
    await page.getByLabel("ENVIAR SÓ PARA UM MOTOBOY").selectOption("e2e-courier-1");
    await page.getByRole("button", { name: "Enviar", exact: true }).click();
    await expect.poll(async () => {
      const body = await json(await central.get(`/deliveries/${d.id}`));
      return `${body.status}/${body.courierId}`;
    }, { timeout: 15_000 }).toBe("OFFERED/e2e-courier-1");
    await setCourierStatus("e2e-courier-1", "OFFLINE");
  });

  test("Detalhe da entrega: informações, histórico em português e voltar para a fila", async ({ page }) => {
    const central = await Api.as("central");
    await setCourierStatus("e2e-courier-1", "AVAILABLE");
    const d = await createDelivery(central, { customerName: "E2E Detalhe Cliente" });
    await central.post(`/deliveries/${d.id}/dispatch`, { mode: "single", courierId: "e2e-courier-1" });
    await setStatus(central, d.id, "ACCEPTED");
    await loginAs(page, "central", `/deliveries/${d.id}`);
    await expect(page.getByRole("heading", { name: "Informações da entrega" })).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText(d.code).first()).toBeVisible();
    await expect(page.getByRole("heading", { name: "Histórico de eventos" })).toBeVisible();
    await expect(page.getByRole("link", { name: /Voltar para a fila/ })).toBeVisible();
  });

  test("[BUG] Histórico de eventos não mostra códigos internos em inglês (requested, offered…)", async ({ page }) => {
    const central = await Api.as("central");
    const d = await createDelivery(central);
    await loginAs(page, "central", `/deliveries/${d.id}`);
    await expect(page.getByRole("heading", { name: "Histórico de eventos" })).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText(/·\s*(requested|offered|accepted|at_store|in_transit|completed|cancelled)\b/)).toHaveCount(0);
  });

  test("Filtro por filial na fila esconde as outras filiais", async ({ page }) => {
    const central = await Api.as("central");
    await createDelivery(central, { storeId: stores.a.id, customerName: "E2E Filtro Savassi" });
    await createDelivery(central, { storeId: stores.b.id, customerName: "E2E Filtro Contagem" });
    await loginAs(page, "central", "/entregas");
    await page.getByTestId("filter-store").selectOption(stores.b.id);
    await expect(page.getByText("E2E Filtro Contagem").first()).toBeVisible();
    await expect(page.getByText("E2E Filtro Savassi")).toHaveCount(0);
  });

  test("Relatórios: filtros, tabela e exportação", async ({ page }) => {
    await loginAs(page, "central", "/reports");
    await expect(page.getByTestId("report-delivery-table")).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId("filter-report-from")).toBeVisible();
    await expect(page.getByTestId("button-export-report")).toBeEnabled();
  });

  test("[BUG] Gráfico diário dos relatórios não mostra 'Invalid Date'", async ({ page }) => {
    await createDelivery(await Api.as("central"));
    await loginAs(page, "central", "/reports");
    await expect(page.getByTestId("report-delivery-table")).toBeVisible({ timeout: 20_000 });
    await page.waitForTimeout(1500);
    await expect(page.getByText("Invalid Date")).toHaveCount(0);
  });

  test("Central não acessa Acessos nem Filiais (Acesso restrito)", async ({ page }) => {
    await loginAs(page, "central", "/access");
    await expect(page.getByRole("heading", { name: "Acesso restrito" })).toBeVisible({ timeout: 20_000 });
    await page.goto("/filiais");
    await expect(page.getByRole("heading", { name: "Acesso restrito" })).toBeVisible();
  });

  for (const path of ["/user-portal", "/entregas"]) {
    test(`Acessibilidade WCAG AA: ${path}`, async ({ page }) => {
      await loginAs(page, "central", path);
      await page.waitForTimeout(1500);
      await expectAccessible(page, path);
    });
  }
});

test.describe("Admin", () => {
  test("Acessos e perfis lista as contas E2E", async ({ page }) => {
    await loginAs(page, "admin", "/access");
    await expect(page.getByText("Contas cadastradas")).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText("e2e-gerente@example.com").first()).toBeVisible();
    await expectAccessible(page, "Acessos");
  });

  test("Filiais lista as filiais E2E com tarifa", async ({ page }) => {
    await loginAs(page, "admin", "/filiais");
    await expect(page.getByText("Filiais cadastradas")).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText(stores.a.name).first()).toBeVisible();
    await expect(page.getByText("R$ 8,50 / entrega")).toBeVisible();
    await expectAccessible(page, "Filiais");
  });

  test("[MELHORIA] Filial inativa aparece marcada como inativa na lista", async ({ page }) => {
    await loginAs(page, "admin", "/filiais");
    const row = page.locator("div, li, article").filter({ hasText: stores.inactive.name }).last();
    await expect(row.getByText(/inativa/i).nth(1)).toBeVisible({ timeout: 20_000 });
  });

  test("Admin vê o item Filiais no menu", async ({ page }) => {
    await loginAs(page, "admin");
    await expect(page.getByRole("link", { name: /^Filiais/ })).toBeVisible({ timeout: 20_000 });
  });
});

test.describe("Loja, conta pendente e minha conta", () => {
  test("Gerente vê só entregas da própria filial", async ({ page }) => {
    const central = await Api.as("central");
    await createDelivery(central, { storeId: stores.a.id, customerName: "E2E Cliente Da Savassi" });
    await createDelivery(central, { storeId: stores.b.id, customerName: "E2E Cliente De Contagem" });
    await loginAs(page, "manager");
    await expect(page.getByRole("heading", { name: "Entregas da loja" })).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText("E2E Cliente Da Savassi").first()).toBeVisible();
    await expect(page.getByText("E2E Cliente De Contagem")).toHaveCount(0);
    await expectAccessible(page, "Portal da loja");
  });

  test("Gerente não abre telas da Central", async ({ page }) => {
    await loginAs(page, "manager", "/access");
    await expect(page.getByText("Contas cadastradas")).toHaveCount(0);
    await page.goto("/entregas");
    await expect(page.getByTestId("button-new-delivery")).toHaveCount(0);
  });

  test("Conta pendente vê a tela de aprovação e nada além", async ({ page }) => {
    await loginAs(page, "pending");
    await expect(page.getByRole("heading", { name: "Acesso aguardando aprovação" })).toBeVisible({ timeout: 20_000 });
    await page.goto("/reports");
    await expect(page.getByTestId("report-delivery-table")).toHaveCount(0);
  });

  test("Minha conta (alterar senha) abre para usuário logado", async ({ page }) => {
    await loginAs(page, "central", "/account");
    await expect(page.getByRole("heading", { name: "Alterar senha" })).toBeVisible({ timeout: 20_000 });
  });

  test("Sair encerra a sessão e protege as telas", async ({ page }) => {
    await loginAs(page, "manager");
    await page.getByRole("button", { name: "Sair" }).click();
    await expect(page.getByRole("heading", { name: "Entregas da loja" })).toHaveCount(0, { timeout: 15_000 });
    await expect.poll(() => page.evaluate(() => Object.keys(localStorage).filter((k) => k.includes("auth-token")).length), { timeout: 10_000 }).toBe(0);
    await page.goto("/entregas");
    await expect(page.getByRole("heading", { name: "Entregas da loja" })).toHaveCount(0);
  });
});
