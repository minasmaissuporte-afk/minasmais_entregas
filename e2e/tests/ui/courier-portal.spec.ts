import { test, expect } from "@playwright/test";
import { BH_POSITION } from "../../support/fixtures-data.ts";
import { setCourierStatus, wipeDeliveries } from "../../support/db.ts";
import { Api } from "../../support/api.ts";
import { createDelivery } from "../../support/helpers.ts";
import { expectAccessible, expectNoHorizontalScroll, loginAs, trackErrors } from "../../support/ui.ts";

// PWA do motoboy em celular (390×844), com GPS simulado em BH.
test.use({
  geolocation: BH_POSITION,
  permissions: ["geolocation"],
});

test.describe("PWA do motoboy (celular)", () => {
  test.beforeEach(wipeDeliveries);

  test("Motoboy entra e vê o portal sem erros e sem rolagem horizontal", async ({ page }) => {
    const errors = trackErrors(page);
    await loginAs(page, "courier");
    await expect(page.getByTestId("text-brand-name")).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId("toggle-courier-availability")).toBeVisible();
    await expectNoHorizontalScroll(page);
    await page.waitForLoadState("networkidle");
    expect(errors).toEqual([]);
  });

  test("Botão de disponibilidade alterna online/offline e grava no servidor", async ({ page }) => {
    await setCourierStatus("e2e-courier-1", "OFFLINE");
    await loginAs(page, "courier");
    const toggle = page.getByTestId("toggle-courier-availability");
    await expect(toggle).toBeVisible({ timeout: 20_000 });
    await toggle.click();
    await expect.poll(async () => {
      const list = await (await (await Api.as("central")).get("/couriers")).json();
      return list.find((c: any) => c.id === "e2e-courier-1")?.status;
    }, { timeout: 15_000 }).toBe("AVAILABLE");
    await toggle.click();
    await expect.poll(async () => {
      const list = await (await (await Api.as("central")).get("/couriers")).json();
      return list.find((c: any) => c.id === "e2e-courier-1")?.status;
    }, { timeout: 15_000 }).toBe("OFFLINE");
  });

  // A barra inferior agora é Início / Mapa / Histórico; a antiga tela "Ganhos" virou "Entregas feitas" (aba Totais).
  test("Navegação inferior: início, mapa e histórico (Entregas feitas e Histórico)", async ({ page }) => {
    await loginAs(page, "courier");
    await page.getByTestId("nav-courier-history").click();
    await expect(page.locator("h1:visible").filter({ hasText: /^Histórico$/ })).toBeVisible();
    await page.getByRole("tab", { name: "Totais" }).filter({ visible: true }).first().click();
    await expect(page.locator("h1:visible").filter({ hasText: /^Entregas feitas$/ })).toBeVisible();
    await page.getByTestId("nav-courier-map").click();
    await page.getByTestId("nav-courier-home").click();
    await expect(page.getByTestId("toggle-courier-availability")).toBeVisible();
  });

  test("Aba Totais mostra só a quantidade de entregas, sem valores em R$", async ({ page }) => {
    await loginAs(page, "courier");
    await page.getByTestId("nav-courier-history").click();
    await page.getByRole("tab", { name: "Totais" }).filter({ visible: true }).first().click();
    await expect(page.locator("h1:visible").filter({ hasText: /^Entregas feitas$/ })).toBeVisible();
    const summary = page.getByTestId("summary-courier-earnings");
    await expect(summary).toBeVisible();
    await expect(summary).toContainText(/\d+ entregas?/);
    await expect(summary).not.toContainText(/R\$/);
    await expect(page.getByRole("tab", { name: "Ganhos" })).toHaveCount(0);
  });

  test("Botão 'Histórico' da barra inferior abre o histórico de entregas", async ({ page }) => {
    await loginAs(page, "courier");
    const nav = page.getByTestId("nav-courier-history");
    await expect(nav).toHaveText(/Histórico/);
    await expect(nav).not.toHaveText(/Ganhos/);
    await nav.click();
    await expect(page.getByRole("heading", { level: 1, name: "Histórico", exact: true })).toBeVisible();
  });

  test("Oferta enviada pela Central aparece no celular do motoboy online", async ({ page }) => {
    await setCourierStatus("e2e-courier-1", "AVAILABLE");
    const central = await Api.as("central");
    const d = await createDelivery(central, { customerName: "E2E Cliente Oferta Celular" });
    await central.post(`/deliveries/${d.id}/dispatch`, { mode: "single", courierId: "e2e-courier-1" });
    await loginAs(page, "courier");
    await expect(page.getByText(new RegExp(`${d.code}|E2E Cliente Oferta Celular`)).first()).toBeVisible({ timeout: 25_000 });
  });

  test("Sem internet: aviso de conexão aparece", async ({ page, context }) => {
    await loginAs(page, "courier");
    await expect(page.getByTestId("toggle-courier-availability")).toBeVisible({ timeout: 20_000 });
    await context.setOffline(true);
    await expect(page.getByTestId("alert-courier-no-internet").or(page.getByRole("heading", { name: "Sem conexão" }))).toBeVisible({ timeout: 15_000 });
    await context.setOffline(false);
  });

  test("Portal do motoboy: acessibilidade WCAG AA", async ({ page }) => {
    await loginAs(page, "courier");
    await expect(page.getByTestId("toggle-courier-availability")).toBeVisible({ timeout: 20_000 });
    await expectAccessible(page, "Portal do motoboy");
  });
});
