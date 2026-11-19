import { test, expect, request } from "@playwright/test";
import { stores } from "../../support/fixtures-data.ts";
import { query, wipeDeliveries } from "../../support/db.ts";
import { API_URL } from "../../support/env.ts";
import { expectNoHorizontalScroll, loginAs, trackErrors } from "../../support/ui.ts";

/** Tela "Integração ERP" (só administrador): credencial, código da filial e histórico. */
const shots = process.env.E2E_SHOTS_DIR;

test.describe("Painel: Integração ERP", () => {
  test.beforeAll(wipeDeliveries);
  test.afterAll(async () => {
    await query(`update stores set erp_code = null where id like 'e2e-%'`);
    await query(`delete from erp_integration_events where credential_id in (select id from erp_api_credentials where name like 'E2E %')`);
    await query(`delete from erp_api_credentials where name like 'E2E %'`);
  });

  test("Administrador gera credencial, vincula a filial e vê a venda chegar no histórico", async ({ page }) => {
    const errors = trackErrors(page);
    await loginAs(page, "admin");
    const nav = page.getByRole("navigation", { name: "Navegação principal" });
    await nav.getByRole("link", { name: /Integração ERP/ }).click();
    await expect(page).toHaveURL(/\/integracao-erp$/);
    await expect(page.getByRole("heading", { level: 1, name: "Integração ERP" })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId("erp-status-operational")).toBeVisible();
    await expect(page.getByTestId("text-erp-base-url")).toHaveText(/\/api\/v1\/erp$/);
    await expect(page.getByTestId("link-erp-docs")).toHaveAttribute("href", /\/api\/v1\/erp\/docs$/);

    await page.getByTestId("input-erp-credential-name").fill("E2E ERP tela");
    await page.getByTestId("button-erp-create-credential").click();
    const tokenText = page.getByTestId("text-erp-token");
    await expect(tokenText).toHaveText(/^mmerp_/);
    const token = (await tokenText.textContent())!.trim();
    await expect(page.getByRole("row", { name: /E2E ERP tela/ })).toContainText("Ativa");

    await page.getByTestId(`input-erp-code-${stores.a.id}`).fill("e2e-tela");
    await page.getByTestId(`button-erp-code-${stores.a.id}`).click();
    await expect(page.getByText("código do ERP E2E-TELA salvo")).toBeVisible();

    // O ERP envia uma venda válida e uma com filial desconhecida.
    const erp = await request.newContext({ baseURL: `${API_URL}/api/v1/erp/`, extraHTTPHeaders: { Authorization: `Bearer ${token}` } });
    const base = {
      cliente: { nome: "E2E Cliente Tela ERP" },
      endereco: { rua: "Rua Paraíba", numero: "1200", bairro: "Savassi", cidade: "Belo Horizonte", estado: "MG" },
      pedido: { valorTotal: 20, formaPagamento: "PIX" },
    };
    expect((await erp.post("entregas", { data: { ...base, idVenda: "E2E-TELA-1", codigoFilial: "E2E-TELA" } })).status()).toBe(201);
    expect((await erp.post("entregas", { data: { ...base, idVenda: "E2E-TELA-2", codigoFilial: "E2E-NAO" } })).status()).toBe(422);
    await erp.dispose();

    await page.getByRole("button", { name: "Atualizar" }).first().click();
    const history = page.locator("#erp-historico");
    await expect(history.getByRole("row", { name: /E2E-TELA-1/ })).toContainText("Cadastrada");
    const failedRow = history.getByRole("row", { name: /E2E-TELA-2/ });
    await expect(failedRow).toContainText("FILIAL_NAO_CADASTRADA");
    await expect(failedRow.getByRole("button", { name: "Reprocessar" })).toBeVisible();
    if (shots) await page.screenshot({ path: `${shots}/erp-desktop.png`, fullPage: true });

    // Filtro "Com erro" mostra só a falha.
    await page.getByTestId("select-erp-outcome").selectOption("FAILED");
    await expect(history.getByRole("row", { name: /E2E-TELA-1/ })).toHaveCount(0);
    await expect(history.getByRole("row", { name: /E2E-TELA-2/ })).toBeVisible();

    // A entrega cadastrada pelo ERP aparece na fila da central.
    await page.goto("/");
    await expect(page.getByText("E2E Cliente Tela ERP").first()).toBeVisible({ timeout: 20_000 });
    expect(errors).toEqual([]);
  });

  test("Celular: tela sem rolagem horizontal", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await loginAs(page, "admin", "/integracao-erp");
    await expect(page.getByRole("heading", { level: 1, name: "Integração ERP" })).toBeVisible({ timeout: 15_000 });
    await expectNoHorizontalScroll(page);
    if (shots) await page.screenshot({ path: `${shots}/erp-mobile.png`, fullPage: true });
  });

  test("Central não vê o menu nem a tela", async ({ page }) => {
    await loginAs(page, "central");
    const nav = page.getByRole("navigation", { name: "Navegação principal" });
    await expect(nav.getByRole("link", { name: /Entregas/ }).first()).toBeVisible({ timeout: 15_000 });
    await expect(nav.getByRole("link", { name: /Integração ERP/ })).toHaveCount(0);
    await page.goto("/integracao-erp");
    await expect(page.getByRole("heading", { name: "Acesso restrito" })).toBeVisible();
  });
});
