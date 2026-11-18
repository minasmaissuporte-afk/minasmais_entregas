import { test, expect, type Page } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import { Api, json } from "../../support/api.ts";
import { BH_POSITION, stores } from "../../support/fixtures-data.ts";
import { createDelivery } from "../../support/helpers.ts";
import { setCourierStatus, wipeDeliveries } from "../../support/db.ts";
import { loginAs } from "../../support/ui.ts";

/**
 * Jornada do motoboy, como ele usa no celular (390×844, toque, GPS em BH).
 * Mede: toques por etapa, tempo de resposta, tempo até a oferta chegar,
 * tamanho dos alvos de toque e se a ação principal fica na zona do polegar.
 * Gera e2e/test-results/jornada/*.png e jornada.json.
 */
test.use({ geolocation: BH_POSITION, permissions: ["geolocation"] });
test.skip(!process.env.E2E_JORNADA, "Jornada medida: rode com E2E_JORNADA=1");
test.describe.configure({ mode: "serial" });

// A chave do Google Maps só aceita a página em localhost:5173. Com E2E_SOURCE_URL (ex.: o painel
// com o código atual em http://localhost:5174), o navegador abre "localhost:5173" e recebe esse código.
const sourceUrl = process.env.E2E_SOURCE_URL;
if (sourceUrl) test.use({ baseURL: "http://localhost:5173" });
test.beforeEach(async ({ context }) => {
  if (!sourceUrl) return;
  await context.route("http://localhost:5173/**", async (route) => {
    const url = route.request().url().replace("http://localhost:5173", sourceUrl);
    const response = await route.fetch({ url });
    await route.fulfill({ response });
  });
  // Recarga automática do Vite (websocket): mantém a conexão aberta sem servidor real.
  await context.routeWebSocket(/localhost:5173/, () => {});
});

type Step = { etapa: string; toques: number; ms: number; obs?: string };
const steps: Step[] = [];
const audits: Record<string, unknown> = {};
const outDir = "test-results/jornada";
mkdirSync(outDir, { recursive: true });

async function shot(page: Page, name: string) {
  await page.screenshot({ path: `${outDir}/${name}.png` });
}

/** Alvos de toque visíveis menores que 44px (mínimo recomendado para dedo/luva) e ação principal fora da zona do polegar. */
async function audit(page: Page, name: string, primary?: string) {
  const data = await page.evaluate((primaryText) => {
    const vh = window.innerHeight;
    const small: string[] = [];
    for (const el of Array.from(document.querySelectorAll<HTMLElement>("button, a[href], [role=button], input[type=checkbox]"))) {
      const r = el.getBoundingClientRect();
      const style = getComputedStyle(el);
      if (!r.width || !r.height || style.visibility === "hidden" || r.bottom < 0 || r.top > vh) continue;
      if (el.closest(".gm-style")) continue; // controles do Google Maps
      if (r.height < 44 || r.width < 44) {
        const label = (el.getAttribute("aria-label") || el.innerText || el.getAttribute("title") || el.tagName).trim().replace(/\s+/g, " ").slice(0, 40);
        small.push(`${label} (${Math.round(r.width)}×${Math.round(r.height)})`);
      }
    }
    let primaryPos: string | null = null;
    if (primaryText) {
      const btn = Array.from(document.querySelectorAll<HTMLElement>("button, a")).find((b) => b.innerText.includes(primaryText) && b.getBoundingClientRect().height > 0);
      if (btn) {
        const r = btn.getBoundingClientRect();
        // A barra inferior fixa cobre a parte de baixo da tela.
        const nav = document.querySelector<HTMLElement>(".courier-bottom-nav");
        const usableBottom = nav ? nav.getBoundingClientRect().top : vh;
        const where = r.bottom > usableBottom ? "ATRÁS da barra inferior, precisa rolar" : r.top > vh * 0.45 ? "zona do polegar" : "metade de cima";
        primaryPos = `${Math.round(r.top)}px do topo (${where}) · ${Math.round(r.width)}×${Math.round(r.height)}`;
      }
    }
    const tiny = Array.from(document.querySelectorAll<HTMLElement>("main *")).filter((el) => {
      const s = getComputedStyle(el);
      return el.childElementCount === 0 && (el.innerText || "").trim().length > 2 && parseFloat(s.fontSize) < 12 && el.getBoundingClientRect().height > 0;
    }).map((el) => `${el.innerText.trim().slice(0, 30)} (${getComputedStyle(el).fontSize})`);
    return { small, primaryPos, tiny: [...new Set(tiny)].slice(0, 12), scrollHeight: document.documentElement.scrollHeight, vh };
  }, primary ?? null);
  audits[name] = data;
}

async function timed<T>(etapa: string, toques: number, fn: () => Promise<T>, obs?: string) {
  const t = Date.now();
  const result = await fn();
  steps.push({ etapa, toques, ms: Date.now() - t, obs });
  return result;
}

const scrollsNeeded: string[] = [];
async function swipeConfirm(page: Page, label = "") {
  const group = page.getByRole("group", { name: "Confirmar entrega" });
  await expect(group).toBeAttached({ timeout: 15_000 });
  // O controle está visível sem rolar? (a barra inferior fixa cobre os últimos ~110px da tela)
  const visibleWithoutScroll = await group.evaluate((el) => {
    const r = el.getBoundingClientRect();
    return r.top >= 0 && r.bottom <= window.innerHeight - 110;
  });
  if (!visibleWithoutScroll) {
    scrollsNeeded.push(label || "deslizar para concluir");
    await group.evaluate((el) => el.scrollIntoView({ block: "center" }));
    await page.waitForTimeout(300);
  }
  const handle = group.locator("button").first();
  const track = (await group.boundingBox())!;
  const hb = (await handle.boundingBox())!;
  await page.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2);
  await page.mouse.down();
  await page.mouse.move(track.x + track.width - 4, hb.y + hb.height / 2, { steps: 12 });
  await page.mouse.up();
}

async function waitStatus(id: string, status: string, timeout = 30_000) {
  const central = await Api.as("central");
  await expect.poll(async () => (await json(await central.get(`/deliveries/${id}`))).status, { timeout, intervals: [300] }).toBe(status);
}

test.beforeAll(async () => {
  await wipeDeliveries();
  await setCourierStatus("e2e-courier-1", "OFFLINE");
});

test.afterAll(() => {
  writeFileSync(`${outDir}/jornada.json`, JSON.stringify({ steps, audits, scrollsNeeded }, null, 2));
});

test("Entrega individual: do celular bloqueado até a entrega concluída", async ({ page }) => {
  const central = await Api.as("central");

  // 1. Abrir o app (já logado)
  await loginAs(page, "courier");
  await timed("Abrir o app até poder trabalhar (recarregar)", 0, async () => {
    await page.reload();
    await expect(page.getByTestId("toggle-courier-availability")).toBeVisible({ timeout: 20_000 });
  });
  await shot(page, "01-inicio-offline");
  await audit(page, "inicio-offline");

  // 2. Ficar online
  await timed("Ficar online", 1, async () => {
    await page.getByTestId("toggle-courier-availability").click();
    await expect.poll(async () => (await (await central.get("/couriers")).json()).find((c: any) => c.id === "e2e-courier-1")?.status, { intervals: [300] }).toBe("AVAILABLE");
  });
  await shot(page, "02-online");

  // 3. A loja registra; a entrega já nasce oferecida aos motoboys da cidade. Quanto tempo leva para aparecer no celular?
  const d = await createDelivery(central, { storeId: stores.a.id, customerName: "E2E Dona Conceição", customerPhone: "(31) 98877-6655" });
  await timed("Oferta chegar no celular (sem notificação push)", 0, async () => {
    await expect(page.getByTestId(`card-delivery-${d.id}`).or(page.getByText("Aceitar entrega").first()).first()).toBeVisible({ timeout: 30_000 });
  });
  await shot(page, "03-oferta");
  await audit(page, "oferta", "Aceitar entrega");

  // 4. Aceitar
  await timed("Aceitar a entrega", 1, async () => {
    await page.getByRole("button", { name: /Aceitar entrega/ }).first().click();
    await waitStatus(d.id, "ACCEPTED");
  });
  await shot(page, "04-aceita");
  await audit(page, "aceita", "Retirei o pedido na loja");
  // Atalho: navegação até a loja já no cartão (1 toque).
  const navStore = page.getByTestId(`button-navigate-${d.id}`);
  await expect(navStore, "botão Navegar até a loja").toBeVisible();
  expect(await navStore.getAttribute("href")).toContain(`destination=${stores.a.lat},${stores.a.lng}`);
  steps.push({ etapa: "Abrir navegação até a loja", toques: 1, ms: 0, obs: "botão no cartão" });
  // Distâncias na oferta foram mostradas? (checado na captura 03; aqui só o registro)
  // Perto da loja (GPS em BH a ~80 m da filial E2E): o botão de retirada fica em destaque.
  const attention = await page.locator(".courier-action-attention").count();
  steps.push({ etapa: "Botão 'Retirei o pedido na loja' em destaque perto da filial", toques: 0, ms: 0, obs: attention ? "sim" : "não" });
  // "Cheguei na loja" saiu: chegada e retirada são um toque só (ACCEPTED → IN_TRANSIT).
  await expect(page.getByRole("button", { name: /Cheguei na loja/ })).toHaveCount(0);

  // 5. Retirada na loja
  await timed("Retirei o pedido na loja", 1, async () => {
    const button = page.getByRole("button", { name: /Retirei o pedido na loja/ }).first();
    await button.scrollIntoViewIfNeeded();
    await button.click();
    await waitStatus(d.id, "IN_TRANSIT");
  });
  await shot(page, "07-em-entrega");
  await audit(page, "07-em-entrega", "Navegar até o cliente");

  // 8. Navegar até o cliente (1 toque, direto no cartão)
  const nav = page.getByTestId(`button-navigate-${d.id}`);
  await expect(nav, "botão Navegar até o cliente").toBeVisible();
  expect(await nav.getAttribute("href")).toMatch(/destination=-19\.9/);
  steps.push({ etapa: "Abrir navegação até o cliente", toques: 1, ms: 0, obs: `link direto: ${await nav.getAttribute("href")}` });

  // 9. Foto + deslizar
  const photo = await page.screenshot({ type: "jpeg", quality: 80 });
  await timed("Tirar foto e deslizar para concluir", 2, async () => {
    await page.getByTestId(`input-evidence-${d.id}`).setInputFiles({ name: "foto.jpg", mimeType: "image/jpeg", buffer: photo });
    await shot(page, "08-foto-escolhida");
    await audit(page, "foto-escolhida");
    await swipeConfirm(page, "entrega individual");
    await waitStatus(d.id, "COMPLETED");
  });
  await page.waitForTimeout(800);
  await shot(page, "09-concluida");
  await audit(page, "concluida");
});

test("Rota agrupada: 2 pedidos da mesma loja", async ({ page, context, baseURL }) => {
  await context.grantPermissions(["geolocation"], { origin: new URL(baseURL!).origin });
  const central = await Api.as("central");
  await setCourierStatus("e2e-courier-1", "AVAILABLE");
  const d1 = await createDelivery(central, { storeId: stores.a.id, customerName: "E2E Seu Geraldo" });
  const d2 = await createDelivery(central, { storeId: stores.a.id, customerName: "E2E Dona Lúcia", destination: "Rua da Bahia, 1148 - Centro, Belo Horizonte - MG", customerLatitude: -19.9233, customerLongitude: -43.9362 });
  await loginAs(page, "courier");
  const route = await json(await central.post("/delivery-routes", { deliveryIds: [d1.id, d2.id] }));
  const accept = page.getByTestId(`button-accept-route-${route.id}`);
  await timed("Oferta de rota chegar no celular", 0, async () => {
    await expect(accept).toBeVisible({ timeout: 30_000 });
  });
  await shot(page, "10-oferta-rota");
  await audit(page, "oferta-rota", "Aceitar e calcular rota");

  await timed("Aceitar a rota (GPS + otimização Google)", 1, async () => {
    await accept.scrollIntoViewIfNeeded();
    await accept.click();
    await expect.poll(async () => {
      const r = await json(await (await Api.as("courier")).get("/courier/routes"));
      return r.find((x: any) => x.id === route.id)?.status;
    }, { timeout: 30_000, intervals: [500] }).toBe("ACCEPTED");
  }).catch(async (error) => {
    const alert = await page.getByTestId(`alert-route-${route.id}`).textContent().catch(() => null);
    steps.push({ etapa: "Aceitar a rota — FALHOU", toques: 1, ms: 0, obs: alert ?? String(error).slice(0, 200) });
    throw error;
  });
  await page.waitForTimeout(1000);
  await shot(page, "11-rota-aceita");
  await audit(page, "rota-aceita", "Retirei os pedidos na loja");

  // Chegada e retirada na loja são um toque só para os 2 pedidos da rota.
  await timed("Retirei os pedidos na loja (rota)", 1, async () => {
    await page.getByRole("button", { name: /Retirei os pedidos na loja/ }).click();
    await waitStatus(d1.id, "IN_TRANSIT");
    await waitStatus(d2.id, "IN_TRANSIT");
  });
  await shot(page, "12-rota-saida");
  await audit(page, "rota-em-entrega", "Enviar foto");

  for (const [i, d] of [[1, d1], [2, d2]] as const) {
    const photo = await page.screenshot({ type: "jpeg", quality: 70 });
    await timed(`Entrega ${i} da rota: foto + deslizar`, 2, async () => {
      const input = page.locator(`[data-testid^="input-evidence-"]`).first();
      await input.setInputFiles({ name: "foto.jpg", mimeType: "image/jpeg", buffer: photo });
      await swipeConfirm(page, `entrega ${i} da rota`);
      await expect.poll(async () => {
        const [a, b] = await Promise.all([d1, d2].map(async (x) => (await json(await central.get(`/deliveries/${x.id}`))).status));
        return [a, b].filter((s) => s === "COMPLETED").length;
      }, { timeout: 30_000, intervals: [300] }).toBe(i);
    });
    await page.waitForTimeout(800);
    await shot(page, `13-rota-entrega-${i}`);
  }

});
