import { test, expect, type Page } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { Api, json } from "../../support/api.ts";
import { BH_POSITION, stores } from "../../support/fixtures-data.ts";
import { courierOnline, deliveryInput } from "../../support/helpers.ts";
import { setCourierStatus, wipeDeliveries } from "../../support/db.ts";
import { loginAs, serveSourceAs5173 } from "../../support/ui.ts";

/** Roteiro da nova versão — app do motoboy no celular (390×844, GPS em BH). */
const shots = "test-results/roteiro-v2-motoboy";
mkdirSync(shots, { recursive: true });
const note = (type: string, description: string) => test.info().annotations.push({ type, description });
const shot = (page: Page, name: string) => page.screenshot({ path: `${shots}/${name}.png` });
test.use({ geolocation: BH_POSITION, permissions: ["geolocation"] });
if (process.env.E2E_SOURCE_URL) test.use({ baseURL: "http://localhost:5173" });
test.beforeEach(async ({ context }) => serveSourceAs5173(context));
test.describe.configure({ mode: "default" });

const WHATSAPP = /wa\.me\/5535998782266\?text=/;
const create = async (overrides: Record<string, unknown> = {}) =>
  json(await (await Api.as("manager")).post("/deliveries", deliveryInput({ storeId: stores.a.id, ...overrides })));
const statusOf = async (id: string) => (await json(await (await Api.as("admin")).get(`/deliveries/${id}`))).status;

test.beforeAll(async () => {
  await wipeDeliveries();
});

test("4.4 Perfil: nome, telefone, cidade (sem Filial), GPS, notificações, Ajuda e Sair alinhado", async ({ page }) => {
  await courierOnline(await Api.as("courier"));
  await loginAs(page, "courier");
  await page.getByTestId("button-courier-profile").click();
  const sheet = page.getByRole("dialog");
  await expect(sheet).toBeVisible();
  await page.waitForTimeout(800);
  await shot(page, "04-perfil");
  const text = await sheet.innerText();
  note("perfil", text.replace(/\s+/g, " ").slice(0, 400));
  expect(text).toMatch(/Cidade/i);
  expect(text).toContain("Belo Horizonte");
  expect(text, "ainda aparece 'Filial' no perfil").not.toMatch(/^Filial$/im);
  const help = sheet.getByRole("link", { name: /Ajuda e Suporte/ });
  await expect(help).toHaveAttribute("href", WHATSAPP);
  const pass = sheet.getByTestId("link-courier-password");
  const out = sheet.getByTestId("button-courier-sign-out");
  const [p, o] = [await pass.boundingBox(), await out.boundingBox()];
  note("Alterar senha × Sair", `x ${Math.round(p!.x)}/${Math.round(o!.x)} · largura ${Math.round(p!.width)}/${Math.round(o!.width)} · altura ${Math.round(p!.height)}/${Math.round(o!.height)}`);
  expect(Math.abs(p!.x - o!.x)).toBeLessThanOrEqual(2);
  expect(Math.abs(p!.width - o!.width)).toBeLessThanOrEqual(2);
  const [cp, co] = [await pass.getAttribute("class"), await out.getAttribute("class")];
  note("classes", `${cp} | ${co}`);
});

test("4.4b Celular pequeno (375×667): o menu do perfil rola e 'Sair da conta' é alcançável", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 667 });
  await loginAs(page, "courier");
  await page.getByTestId("button-courier-profile").click();
  const out = page.getByTestId("button-courier-sign-out");
  await out.scrollIntoViewIfNeeded();
  await expect(out).toBeInViewport();
  await shot(page, "04-perfil-pequeno");
});

test("5.2 Oferta: retirada, destino, distância, tempo e pagamento em destaque, sem valor em R$ da entrega", async ({ page }) => {
  await wipeDeliveries();
  await courierOnline(await Api.as("courier"));
  const d = await create({ paymentMethod: "CASH", changeFor: 50 });
  await loginAs(page, "courier");
  const card = page.getByTestId(`card-delivery-${d.id}`);
  await expect(card).toBeVisible({ timeout: 20_000 });
  await shot(page, "05-oferta");
  const text = (await card.innerText()).replace(/ /g, " ");
  note("oferta", text.replace(/\s+/g, " ").slice(0, 400));
  expect(text).toMatch(/Retirada/);
  expect(text).toMatch(/Destino/);
  expect(text).toMatch(/\d\s?(m|km)\b/);
  expect(text).toMatch(/min/);
  expect(text).toMatch(/Dinheiro/);
  expect(text, "a oferta mostra o valor da entrega (R$ 8,50)").not.toContain("R$ 8,50");
  const decline = card.getByRole("button", { name: /Dispensar|Recusar/ }).first();
  note("botão de dispensar", (await decline.innerText()).trim());
});

test("5.3 Outro motoboy aceita primeiro: A vê 'Outro motoboy aceitou esta entrega primeiro' e a oferta some", async ({ page }) => {
  await wipeDeliveries();
  await courierOnline(await Api.as("courier"));
  await courierOnline(await Api.as("courierB"));
  const d = await create();
  await loginAs(page, "courier");
  const card = page.getByTestId(`card-delivery-${d.id}`);
  await expect(card).toBeVisible({ timeout: 20_000 });
  // B aceita enquanto A ainda está com a oferta na tela.
  expect((await (await Api.as("courierB")).patch(`/deliveries/${d.id}/status`, { status: "ACCEPTED" })).status()).toBe(200);
  const answer = page.waitForResponse((r) => r.url().includes(`/deliveries/${d.id}/status`), { timeout: 10_000 });
  await card.getByRole("button", { name: /Aceitar entrega/ }).click();
  const res = await answer;
  note("resposta da API para A", `${res.status()} ${(await res.text()).slice(0, 200)}`);
  const seen = page.getByTestId("alert-courier-offer-notice");
  await seen.waitFor({ timeout: 5000 }).catch(() => undefined);
  await shot(page, "05-outro-aceitou");
  const msg = (await seen.isVisible()) ? await seen.innerText() : "(nenhuma mensagem visível)";
  note("mensagem para A", msg.slice(0, 300));
  expect(msg, "mensagem errada para quem perdeu a disputa").toMatch(/Outro motoboy aceitou esta entrega primeiro/);
  await expect(card).toBeHidden({ timeout: 15_000 });
});

test("5.4 Dispensar: a oferta some só para A", async ({ page }) => {
  await wipeDeliveries();
  await courierOnline(await Api.as("courier"));
  await courierOnline(await Api.as("courierB"));
  const d = await create();
  await loginAs(page, "courier");
  const card = page.getByTestId(`card-delivery-${d.id}`);
  await expect(card).toBeVisible({ timeout: 20_000 });
  await card.getByRole("button", { name: /Dispensar|Recusar/ }).first().click();
  const confirm = page.getByTestId(`button-decline-delivery-${d.id}-yes`);
  await shot(page, "05-recusar-confirmacao");
  note("confirmação", (await page.getByTestId(`button-decline-delivery-${d.id}-confirm`).innerText()).replace(/\s+/g, " "));
  await confirm.click();
  await expect(card).toBeHidden({ timeout: 10_000 });
  const bOffers = (await json(await (await Api.as("courierB")).get("/deliveries"))).map((x: any) => x.id);
  expect(bOffers).toContain(d.id);
});

test("6.1–6.5 Entrega com receita: navegar até a loja, 'Retirei o pedido na loja', aviso da receita e deslizar travado", async ({ page }) => {
  await wipeDeliveries();
  await courierOnline(await Api.as("courier"));
  const d = await create({ requiresPrescription: true, paymentMethod: "CARD", bringCardMachine: true });
  await loginAs(page, "courier");
  const card = page.getByTestId(`card-delivery-${d.id}`);
  await expect(card).toBeVisible({ timeout: 20_000 });
  await card.getByRole("button", { name: /Aceitar entrega/ }).click();
  await expect.poll(() => statusOf(d.id), { timeout: 15_000 }).toBe("ACCEPTED");
  await page.waitForTimeout(1200);
  await shot(page, "06-aceita");
  const accepted = (await page.locator("main").innerText()).replace(/\s+/g, " ");
  note("tela após aceitar", accepted.slice(0, 400));
  expect(accepted).toMatch(/Navegar até a loja/);
  expect(accepted).toMatch(/Cartão/);
  expect(accepted, "ainda existe 'Cheguei na loja'").not.toMatch(/Cheguei na loja/);
  const pickup = page.getByRole("button", { name: /Retirei o pedido na loja/ });
  await expect(pickup).toBeVisible();
  await pickup.click();
  await expect.poll(() => statusOf(d.id), { timeout: 15_000 }).toBe("IN_TRANSIT");
  await page.waitForTimeout(1200);
  await shot(page, "06-em-entrega");
  const transit = (await page.locator("main").innerText()).replace(/\s+/g, " ");
  note("tela em entrega", transit.slice(0, 400));
  expect(transit, "sem aviso de receita na tela da entrega").toMatch(/receita/i);
  const photo = await page.screenshot({ type: "jpeg", quality: 70 });
  await page.getByTestId(`input-evidence-${d.id}`).setInputFiles({ name: "foto.jpg", mimeType: "image/jpeg", buffer: photo });
  await page.waitForTimeout(800);
  await shot(page, "06-receita-trava");
  const rx = page.getByText("Peguei a receita do cliente");
  await expect(rx).toBeVisible();
  const handle = page.getByRole("group", { name: "Confirmar entrega" }).locator("button").first();
  note("deslizar antes de marcar a receita", `desabilitado=${await handle.isDisabled()}`);
  expect(await handle.isDisabled(), "o deslizar libera sem marcar a receita").toBe(true);
  await rx.click();
  expect(await handle.isDisabled()).toBe(false);
});

test("9 Histórico e totais: só quantidades, sem R$; tela inicial com 'Suas entregas de hoje'", async ({ page }) => {
  await loginAs(page, "courier");
  await page.waitForTimeout(1000);
  const home = (await page.locator("main").innerText()).replace(/\s+/g, " ");
  note("início", home.match(/Suas entregas de hoje[^.]{0,60}/)?.[0] ?? "(não achado)");
  await page.getByTestId("nav-courier-history").click();
  await page.waitForTimeout(1000);
  await shot(page, "09-historico");
  const totals = (await page.locator("main").innerText()).replace(/ /g, " ");
  note("totais", totals.replace(/\s+/g, " ").slice(0, 300));
  expect(totals, "aparecem valores em R$ no histórico/totais").not.toMatch(/R\$\s?\d/);
});

test("13.4 Sem internet: aviso; ao voltar, atualiza", async ({ page, context }) => {
  await loginAs(page, "courier");
  await context.setOffline(true);
  await expect(page.getByTestId("alert-courier-no-internet")).toBeVisible({ timeout: 15_000 });
  await shot(page, "13-sem-internet");
  await context.setOffline(false);
  await expect(page.getByTestId("alert-courier-no-internet")).toBeHidden({ timeout: 20_000 });
});

test.afterAll(async () => {
  for (const id of ["e2e-courier-1", "e2e-courier-b", "e2e-courier-c"]) await setCourierStatus(id, "OFFLINE");
});

test("4.1 Chave online/offline: bolinha dentro do trilho, centralizada, nos dois estados", async ({ page }) => {
  await courierOnline(await Api.as("courier"));
  await loginAs(page, "courier");
  const toggle = page.getByTestId("toggle-courier-availability");
  for (const state of ["online", "offline"]) {
    await page.waitForTimeout(400);
    const geo = await toggle.evaluate((el) => {
      const t = el.getBoundingClientRect();
      const track = getComputedStyle(el, "::before");
      const k = el.querySelector(".courier-online-knob")!.getBoundingClientRect();
      const inset = parseFloat(track.top);
      const insetX = parseFloat(track.left);
      return { trackTop: t.top + inset, trackBottom: t.bottom - inset, trackLeft: t.left + insetX, trackRight: t.right - insetX, k: { top: k.top, bottom: k.bottom, left: k.left, right: k.right } };
    });
    note(`chave ${state}`, JSON.stringify(geo));
    expect(geo.k.top).toBeGreaterThanOrEqual(geo.trackTop);
    expect(geo.k.bottom).toBeLessThanOrEqual(geo.trackBottom);
    expect(geo.k.left).toBeGreaterThanOrEqual(geo.trackLeft);
    expect(geo.k.right).toBeLessThanOrEqual(geo.trackRight);
    expect(Math.abs((geo.k.top - geo.trackTop) - (geo.trackBottom - geo.k.bottom))).toBeLessThanOrEqual(1);
    const box = (await page.locator(".courier-availability, section:has([data-testid=toggle-courier-availability])").first().boundingBox())!;
    await page.screenshot({ path: `${shots}/04-chave-${state}.png`, clip: { x: box.x, y: box.y, width: box.width, height: box.height } });
    if (state === "online") await toggle.click();
  }
});
