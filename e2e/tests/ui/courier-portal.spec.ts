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

  test("Navegação inferior: início, mapa, ganhos e histórico", async ({ page }) => {
    await loginAs(page, "courier");
    await page.getByTestId("nav-courier-history").click();
    await expect(page.locator("h1:visible").filter({ hasText: /^Ganhos$/ })).toBeVisible();
    await page.getByRole("tab", { name: "Histórico" }).filter({ visible: true }).first().click();
    await expect(page.locator("h1:visible").filter({ hasText: /^Histórico$/ })).toBeVisible();
    await page.getByTestId("nav-courier-map").click();
    await page.getByTestId("nav-courier-home").click();
    await expect(page.getByTestId("toggle-courier-availability")).toBeVisible();
  });

  test("Aba de ganhos mostra o resumo em R$", async ({ page }) => {
    await loginAs(page, "courier");
    await page.getByTestId("nav-courier-history").click();
    await page.getByRole("tab", { name: "Ganhos" }).first().click();
    await expect(page.locator("h1:visible, h2:visible").filter({ hasText: /^Ganhos$/ }).first()).toBeVisible();
    await expect(page.getByText(/R\$\s?\d/).filter({ visible: true }).first()).toBeVisible();
  });

  test("Botão 'Ganhos' da barra inferior abre a tela de Ganhos", async ({ page }) => {
    await loginAs(page, "courier");
    const nav = page.getByTestId("nav-courier-history");
    await expect(nav).toHaveText(/Ganhos/);
    await nav.click();
    await expect(page.getByRole("heading", { level: 1, name: "Ganhos", exact: true })).toBeVisible();
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
