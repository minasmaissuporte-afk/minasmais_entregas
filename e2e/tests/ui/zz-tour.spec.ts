import { test, type Page } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { Api } from "../../support/api.ts";
import { stores } from "../../support/fixtures-data.ts";
import { courierOnline, createDelivery, setStatus } from "../../support/helpers.ts";
import { setCourierStatus, wipeDeliveries } from "../../support/db.ts";
import { loginAs } from "../../support/ui.ts";

// Tour visual: fotografa cada tela (desktop e celular) em e2e/test-results/tour para revisão do layout.
const outDir = resolve(import.meta.dirname, "..", "..", "test-results", "tour");
mkdirSync(outDir, { recursive: true });
const shot = (page: Page, name: string) => page.screenshot({ path: resolve(outDir, `${name}.png`), fullPage: true });
let detailId = "";

test.describe.configure({ mode: "serial" });
// Só roda quando pedido: pnpm --filter @workspace/e2e run tour
test.skip(!process.env.E2E_TOUR, "Tour visual roda só com E2E_TOUR=1");

test.beforeAll(async () => {
  await wipeDeliveries();
  const central = await Api.as("central");
  const courier = await Api.as("courier");
  await createDelivery(central, { storeId: stores.a.id, customerName: "E2E Maria Aparecida", priority: "urgent" });
  await createDelivery(central, { storeId: stores.b.id, customerName: "E2E José Conceição" });
  await courierOnline(courier);
  const d = await createDelivery(central, { storeId: stores.a.id, customerName: "E2E Ana Lúcia" });
  await central.post(`/deliveries/${d.id}/dispatch`, { mode: "single", courierId: "e2e-courier-1" });
  for (const s of ["ACCEPTED", "AT_STORE", "IN_TRANSIT"]) await setStatus(central, d.id, s);
  detailId = d.id;
  await setCourierStatus("e2e-courier-2", "AVAILABLE");
});

for (const [label, size] of [["desktop", { width: 1440, height: 900 }], ["celular", { width: 390, height: 844 }]] as const) {
  test(`Tour ${label}: páginas públicas`, async ({ page }) => {
    await page.setViewportSize(size);
    for (const [name, path] of [["inicio", "/"], ["entrar", "/sign-in"], ["cadastro", "/sign-up"], ["esqueci-senha", "/esqueci-senha"], ["motoboy-pwa", "/motoboy-pwa"], ["404", "/nao-existe"]]) {
      await page.goto(path);
      await page.waitForLoadState("networkidle").catch(() => undefined);
      await shot(page, `${label}-publico-${name}`);
    }
  });

  test(`Tour ${label}: Central`, async ({ page }) => {
    await page.setViewportSize(size);
    await loginAs(page, "central");
    await shot(page, `${label}-central-home`);
    for (const [name, path] of [["entregas", "/entregas"], ["mapa", "/mapa"], ["motoboys", "/motoboys"], ["detalhe", `/deliveries/${detailId}`], ["relatorios", "/reports"], ["conta", "/account"]]) {
      await page.goto(path);
      await page.waitForLoadState("networkidle").catch(() => undefined);
      await page.waitForTimeout(1500);
      await shot(page, `${label}-central-${name}`);
    }
    await page.goto("/entregas");
    const novo = page.getByTestId("button-new-delivery");
    if (await novo.isVisible().catch(() => false)) {
      await novo.click();
      await page.waitForTimeout(500);
      await shot(page, `${label}-central-nova-entrega`);
    }
  });

  test(`Tour ${label}: Admin, loja e pendente`, async ({ page }) => {
    await page.setViewportSize(size);
    await loginAs(page, "admin", "/access");
    await shot(page, `${label}-admin-acessos`);
    await page.goto("/filiais");
    await page.waitForLoadState("networkidle").catch(() => undefined);
    await shot(page, `${label}-admin-filiais`);
    await page.context().clearCookies();
    await page.evaluate(() => localStorage.clear());
    await loginAs(page, "manager");
    await page.waitForTimeout(1500);
    await shot(page, `${label}-loja-home`);
    await page.evaluate(() => localStorage.clear());
    await loginAs(page, "pending");
    await shot(page, `${label}-pendente-home`);
  });

  test(`Tour ${label}: Motoboy`, async ({ page, context }) => {
    await context.grantPermissions(["geolocation"]);
    await context.setGeolocation({ latitude: -19.9367, longitude: -43.9345 });
    await page.setViewportSize(size);
    await loginAs(page, "courier");
    await page.waitForTimeout(2000);
    await shot(page, `${label}-motoboy-home`);
    for (const id of ["nav-courier-map", "nav-courier-history"]) {
      const tab = page.getByTestId(id);
      if (await tab.isVisible().catch(() => false)) {
        await tab.click();
        await page.waitForTimeout(1500);
        await shot(page, `${label}-motoboy-${id.replace("nav-courier-", "")}`);
      }
    }
  });
}
