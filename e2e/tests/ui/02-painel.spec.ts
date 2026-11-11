import { test, expect } from "@playwright/test";
import { stores } from "../../support/fixtures-data.ts";
import { wipeDeliveries, setCourierStatus } from "../../support/db.ts";
import { Api } from "../../support/api.ts";
import { createDelivery, setStatus } from "../../support/helpers.ts";
import { expectAccessible, loginAs, trackErrors } from "../../support/ui.ts";

test.describe("Central: visão geral e entregas", () => {
  test.beforeAll(wipeDeliveries);

  test("Central entra e cai na Visão Geral sem erros", async ({ page }) => {
    const errors = trackErrors(page);
    await loginAs(page, "central");
    await expect(page.getByRole("heading", { name: /Sua operação, em tempo real/ })).toBeVisible({ timeout: 20_000 });
    await expect(page.getByRole("link", { name: /Entregas/ }).first()).toBeVisible();
    expect(errors).toEqual([]);
  });

  test("Menu lateral leva a Entregas, Mapa, Motoboys e Relatórios", async ({ page }) => {
    await loginAs(page, "central");
    for (const [link, heading] of [["Entregas", /^Entregas$/], ["Mapa em Tempo Real", /Mapa em tempo real/], ["Motoboys", /^Motoboys$/], ["Relatórios", /Relatórios e indicadores/]] as const) {
      await page.getByRole("link", { name: new RegExp(`^${link}`) }).first().click();
      await expect(page.getByRole("heading", { level: 1, name: heading })).toBeVisible({ timeout: 15_000 });
    }
  });

  test("Registrar entrega pelo formulário: tarifa da filial em R$ e pedido aparece na fila", async ({ page }) => {
    await loginAs(page, "central", "/entregas");
    await page.getByTestId("button-new-delivery").click();
    const dialog = page.getByRole("dialog", { name: "Registrar entrega" });
    await expect(dialog).toBeVisible();
    const order = `PED-UI-${Date.now()}`;
    await dialog.getByTestId("input-customer-name").fill("E2E Cliente Formulário Ávila");
    await dialog.getByTestId("input-customer-phone").fill("(31) 98765-4321");
    await dialog.getByTestId("input-destination").fill("Rua Cláudio Manoel, 500 - Funcionários, Belo Horizonte - MG");
    await dialog.getByTestId("input-order-number").fill(order);
    await dialog.getByTestId("select-store").selectOption(stores.a.id);
    await expect(dialog.getByTestId("text-delivery-fee")).toHaveValue(/R\$\s?8,50/);
    await dialog.getByTestId("select-priority").selectOption("urgent");
    await dialog.getByTestId("input-notes").fill("Interfone 102");
    await dialog.getByRole("button", { name: "Registrar pedido" }).click();
    await expect(dialog).toBeHidden({ timeout: 15_000 });
    await page.getByTestId("input-search-deliveries").fill(order);
    await page.getByRole("button", { name: "Buscar" }).click();
    await expect(page.getByText("E2E Cliente Formulário Ávila").first()).toBeVisible();
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

  test("Despachar pela fila envia a oferta ao motoboy disponível", async ({ page }) => {
    await setCourierStatus("e2e-courier-1", "AVAILABLE");
    const d = await createDelivery(await Api.as("central"), { customerName: "E2E Despacho Pela Tela" });
    await loginAs(page, "central", "/entregas");
    const row = page.getByRole("row").filter({ hasText: d.code });
    await row.getByRole("button", { name: "Despachar" }).click();
    const modal = page.getByRole("dialog", { name: "Escolher motoboy" });
    await expect(modal).toBeVisible();
    await expect(modal.getByRole("button", { name: "Enviar oferta" })).toBeDisabled();
    await modal.getByTestId("select-courier").selectOption("e2e-courier-1");
    await modal.getByRole("button", { name: "Enviar oferta" }).click();
    await expect.poll(async () => (await (await (await Api.as("central")).get(`/deliveries/${d.id}`)).json()).status, { timeout: 15_000 }).toBe("OFFERED");
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
