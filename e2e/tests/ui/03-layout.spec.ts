import { test, expect } from "@playwright/test";
import { Api } from "../../support/api.ts";
import { createDelivery } from "../../support/helpers.ts";
import { expectNoHorizontalScroll, loginAs } from "../../support/ui.ts";
import type { RoleKey } from "../../support/fixtures-data.ts";

// Layout responsivo: nenhuma tela logada pode rolar na horizontal em celular (390) ou tablet (768).
const pages: [RoleKey, string][] = [
  ["central", "/user-portal"],
  ["central", "/entregas"],
  ["central", "/mapa"],
  ["central", "/motoboys"],
  ["central", "/reports"],
  ["admin", "/access"],
  ["admin", "/filiais"],
  ["manager", "/user-portal"],
  ["pending", "/user-portal"],
];

test.beforeAll(async () => {
  await createDelivery(await Api.as("central"), { customerName: "E2E Layout Cliente Com Nome Bem Comprido Da Silva" });
});

for (const width of [390, 768]) {
  for (const [role, path] of pages) {
    test(`${width}px sem rolagem horizontal: ${role} ${path}`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await loginAs(page, role, path);
      await page.waitForTimeout(1500);
      await expectNoHorizontalScroll(page);
    });
  }
}

test("Menu lateral: rótulo 'WORKSPACE' alinhado com os itens do menu", async ({ page }) => {
  await loginAs(page, "central");
  const label = page.getByText(/^workspace$/i).first();
  const item = page.getByRole("link", { name: /Visão Geral/ }).first();
  await expect(label).toBeVisible({ timeout: 20_000 });
  // Mede onde o TEXTO começa (não a caixa do elemento, que ocupa a largura toda).
  const textLeft = await label.evaluate((el) => {
    const range = document.createRange();
    range.selectNodeContents(el);
    return range.getBoundingClientRect().left;
  });
  const itemBox = await item.boundingBox();
  expect(textLeft, "rótulo encostado na borda da tela").toBeGreaterThanOrEqual(itemBox!.x - 2);
});

test("Campo de busca de Filiais: ícone não cobre o texto", async ({ page }) => {
  await loginAs(page, "admin", "/filiais");
  const input = page.getByPlaceholder(/filial, cidade ou endereço/i);
  await expect(input).toBeVisible({ timeout: 20_000 });
  const paddingLeft = await input.evaluate((el) => parseFloat(getComputedStyle(el).paddingLeft));
  expect(paddingLeft, "padding-left do campo (o ícone ocupa ~16px)").toBeGreaterThanOrEqual(28);
});

test("Formulário Nova entrega: selects com o mesmo estilo dos outros campos", async ({ page }) => {
  await loginAs(page, "central", "/entregas");
  await page.getByTestId("button-new-delivery").click();
  const border = (sel: string) => page.getByTestId(sel).evaluate((el) => getComputedStyle(el).borderTopWidth);
  expect(await border("select-store")).toBe(await border("input-order-number"));
  expect(await border("select-priority")).toBe(await border("input-order-number"));
});
