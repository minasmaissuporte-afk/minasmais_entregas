import { test, expect } from "@playwright/test";
import { expectNoHorizontalScroll, loginAs, trackErrors } from "../../support/ui.ts";

/** Tela do Painel técnico: abas carregam sem erro, no computador e no celular. */
const shots = process.env.E2E_SHOTS_DIR;

test.describe("Painel técnico (tela)", () => {
  test("Administrador navega pelas abas", async ({ page }) => {
    const errors = trackErrors(page);
    await loginAs(page, "developer", "/painel-tecnico");
    await expect(page.getByRole("heading", { level: 1, name: "Painel técnico" })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId("dev-api-status")).toBeVisible();
    await expect(page.getByTestId("dev-service-database")).toContainText("Configurado");
    if (shots) await page.screenshot({ path: `${shots}/dev-visao-geral.png`, fullPage: true });

    await page.getByTestId("tab-requisicoes").click();
    await expect(page).toHaveURL(/aba=requisicoes/);
    await expect(page.getByRole("heading", { name: "Rotas mais chamadas" })).toBeVisible();
    await expect(page.getByTestId("dev-route-row").first()).toBeVisible();
    if (shots) await page.screenshot({ path: `${shots}/dev-requisicoes.png`, fullPage: true });

    await page.getByTestId("tab-erros").click();
    await expect(page.getByRole("heading", { name: "Erros recentes" })).toBeVisible();

    await page.getByTestId("tab-banco").click();
    await expect(page.getByTestId("dev-table-row").filter({ hasText: "deliveries" }).first()).toBeVisible();
    if (shots) await page.screenshot({ path: `${shots}/dev-banco.png`, fullPage: true });

    await page.getByTestId("tab-referencia").click();
    await expect(page.getByRole("heading", { name: "Comandos úteis" })).toBeVisible();

    // Recarregar mantém a aba.
    await page.reload();
    await expect(page.getByRole("heading", { name: "Comandos úteis" })).toBeVisible({ timeout: 15_000 });
    expect(errors).toEqual([]);
  });

  test("Celular: abas e conteúdo sem rolagem horizontal", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await loginAs(page, "developer", "/painel-tecnico");
    await expect(page.getByRole("heading", { level: 1, name: "Painel técnico" })).toBeVisible({ timeout: 15_000 });
    await expectNoHorizontalScroll(page);
    if (shots) await page.screenshot({ path: `${shots}/dev-mobile.png`, fullPage: true });
    await page.getByTestId("tab-requisicoes").click();
    await expect(page.getByRole("heading", { name: "Rotas mais chamadas" })).toBeVisible();
    await expectNoHorizontalScroll(page);
  });
});
