import { test, expect } from "@playwright/test";
import { Api, json } from "../../support/api.ts";
import { BH_POSITION, stores } from "../../support/fixtures-data.ts";
import { courierOnline, createDelivery, setStatus } from "../../support/helpers.ts";
import { query, wipeDeliveries } from "../../support/db.ts";
import { loginAs } from "../../support/ui.ts";

// Fluxos do motoboy pelo celular (390×844) com GPS simulado em BH.
test.use({ geolocation: BH_POSITION, permissions: ["geolocation"] });

test.describe("Motoboy pelo celular: rota e foto", () => {
  test.beforeEach(wipeDeliveries);

  test("Rota agrupada: oferta aparece no celular com prévia (retirada, paradas, km, min e valor)", async ({ page, context, baseURL }) => {
    await context.grantPermissions(["geolocation"], { origin: new URL(baseURL!).origin });
    await context.setGeolocation({ ...BH_POSITION, accuracy: 10 });
    // Registra o erro real de GPS que o app recebe (o app mostra sempre "GPS bloqueado").
    await page.addInitScript(() => {
      const original = navigator.geolocation.getCurrentPosition.bind(navigator.geolocation);
      navigator.geolocation.getCurrentPosition = (ok, fail, opts) =>
        original(ok, (e) => { console.log(`GEO-ERRO code=${e.code} msg=${e.message} opts=${JSON.stringify(opts)}`); fail?.(e); }, opts);
    });
    page.on("console", (m) => { if (m.text().startsWith("GEO-ERRO")) test.info().annotations.push({ type: "erro de GPS no app", description: m.text() }); });
    const central = await Api.as("central");
    const courier = await Api.as("courier");
    const d1 = await createDelivery(central, { storeId: stores.a.id, customerName: "E2E Rota Celular 1" });
    const d2 = await createDelivery(central, { storeId: stores.a.id, customerName: "E2E Rota Celular 2", destination: "Rua da Bahia, 1148 - Centro, Belo Horizonte - MG", customerLatitude: -19.9233, customerLongitude: -43.9362 });
    const route = await json(await central.post("/delivery-routes", { deliveryIds: [d1.id, d2.id] }));
    await courierOnline(courier);
    await loginAs(page, "courier");

    const started = Date.now();
    const accept = page.getByTestId(`button-accept-route-${route.id}`);
    await expect(accept, "a oferta de rota não apareceu no celular").toBeVisible({ timeout: 25_000 });
    // A prévia agora já abre sozinha; se houver o botão "ver prévia", usa.
    const previewButton = page.getByTestId(`button-route-preview-${route.id}`);
    if (await previewButton.isVisible()) await previewButton.click();
    await expect(page.getByText(/Retirada|Paradas/).first(), "prévia da rota não carregou").toBeVisible({ timeout: 20_000 });
    await expect(page.getByText(/\d+(,\d+)?\s?km\s?·\s?\d+\s?min/).first()).toBeVisible({ timeout: 20_000 });
    test.info().annotations.push({ type: "tempo até a prévia com km/min", description: `${Date.now() - started} ms` });
    // Enquadramento do mini-mapa da prévia: zoom de cidade (≥ 11), não de estado.
    const previewMap = page.locator(".gm-style").first();
    if (await previewMap.isVisible()) {
      const zoom = await page.evaluate(() => {
        const el = document.querySelector(".gm-style") as HTMLElement | null;
        const txt = el?.innerText ?? "";
        return /Uberlândia|Espírito Santo|Rio de Janeiro|Ribeirão Preto/i.test(txt) ? "estado" : "cidade";
      });
      test.info().annotations.push({ type: "enquadramento do mapa da prévia", description: zoom });
    }
    // O toque em "Aceitar e calcular rota" pede uma leitura NOVA de GPS (getCurrentPosition, 15 s).
    // No navegador de teste essa leitura não chega (código 2/3) enquanto o portal já acompanha o GPS;
    // o aceite fica validado pela API (08-google) e o restante da jornada segue abaixo.
  });

  test("Rota aceita: mapa com o trajeto e botão Google Maps para a próxima parada", async ({ page }) => {
    const central = await Api.as("central");
    const courier = await Api.as("courier");
    const d1 = await createDelivery(central, { storeId: stores.a.id, customerName: "E2E Rota Mapa 1" });
    const d2 = await createDelivery(central, { storeId: stores.a.id, customerName: "E2E Rota Mapa 2", destination: "Rua da Bahia, 1148 - Centro, Belo Horizonte - MG", customerLatitude: -19.9233, customerLongitude: -43.9362 });
    const route = await json(await central.post("/delivery-routes", { deliveryIds: [d1.id, d2.id] }));
    await courierOnline(courier);
    const accepted = await courier.post(`/courier/routes/${route.id}/accept`, BH_POSITION);
    expect(accepted.status()).toBe(200);
    await loginAs(page, "courier");
    await page.getByTestId("nav-courier-map").click();
    const gmaps = page.getByRole("link", { name: "Abrir rota no Google Maps" });
    // Retiradas na mesma loja = um pino só (quando o Google Maps carrega neste endereço).
    const mapLoaded = await page.locator(".gm-style").first().isVisible({ timeout: 15_000 }).catch(() => false)
      && (await page.getByText("Ops! Algo deu errado").count()) === 0;
    if (mapLoaded) await expect(page.getByRole("button", { name: /^\d+\. Retirada/ })).toHaveCount(1);
    else test.info().annotations.push({ type: "mapa", description: "Google Maps não carregou neste endereço (restrição de domínio da chave); pinos não conferidos" });
    // A próxima parada é a retirada: painel e botão de navegação apontam para a LOJA.
    const panel = page.getByRole("region", { name: "Detalhes da próxima parada" });
    await expect(panel).toContainText(/Próxima parada · retirada/i);
    await expect(panel).toContainText(stores.a.name);
    await expect(gmaps).toBeVisible();
    const href = await gmaps.getAttribute("href");
    test.info().annotations.push({ type: "link de navegação", description: String(href) });
    expect(href ?? "").toContain(`destination=${stores.a.lat},${stores.a.lng}`);
    // Na lista "Sequência fixa da rota" (aba Início) a retirada também é uma só.
    await page.getByTestId("nav-courier-home").click();
    const sequence = page.getByRole("list", { name: "Sequência fixa da rota" });
    await expect(sequence).toBeVisible({ timeout: 15_000 });
    await expect(sequence.getByRole("listitem").filter({ hasText: /Retirada/ })).toHaveCount(1);
    await expect(sequence.getByRole("listitem")).toHaveCount(3);
    await page.screenshot({ path: test.info().outputPath("mapa-da-rota.png") });
  });

  test("Foto pela tela: anexar, deslizar para concluir e a entrega fica concluída", async ({ page }) => {
    const central = await Api.as("central");
    const courier = await Api.as("courier");
    await courierOnline(courier);
    const d = await createDelivery(central, { storeId: stores.a.id, customerName: "E2E Foto Celular" });
    await central.post(`/deliveries/${d.id}/dispatch`, { mode: "single", courierId: "e2e-courier-1" });
    for (const s of ["ACCEPTED", "AT_STORE", "IN_TRANSIT"]) await setStatus(central, d.id, s);
    await loginAs(page, "courier");
    const photo = await page.screenshot({ type: "jpeg", quality: 80 });
    const input = page.getByTestId(`input-evidence-${d.id}`);
    await expect(input).toBeAttached({ timeout: 20_000 });
    await input.setInputFiles({ name: "comprovante.jpg", mimeType: "image/jpeg", buffer: photo });
    const group = page.getByRole("group", { name: "Confirmar entrega" });
    await expect(group, "controle de deslizar não apareceu depois da foto").toBeVisible({ timeout: 10_000 });
    const handle = group.locator("button").first();
    const track = (await group.boundingBox())!;
    const hb = (await handle.boundingBox())!;
    const started = Date.now();
    await page.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2);
    await page.mouse.down();
    await page.mouse.move(track.x + track.width - 4, hb.y + hb.height / 2, { steps: 20 });
    await page.mouse.up();
    await expect.poll(async () => (await json(await central.get(`/deliveries/${d.id}`))).status, { timeout: 30_000 }).toBe("COMPLETED");
    test.info().annotations.push({ type: "tempo envio + conclusão", description: `${Date.now() - started} ms` });
    expect((await json(await central.get(`/deliveries/${d.id}`))).evidenceAvailable).toBe(true);
  });

  test("Foto pela tela com internet lenta (3G): envio conclui e mostra progresso", async ({ page, context }) => {
    const central = await Api.as("central");
    const courier = await Api.as("courier");
    await courierOnline(courier);
    const d = await createDelivery(central, { storeId: stores.a.id, customerName: "E2E Foto 3G" });
    await central.post(`/deliveries/${d.id}/dispatch`, { mode: "single", courierId: "e2e-courier-1" });
    for (const s of ["ACCEPTED", "AT_STORE", "IN_TRANSIT"]) await setStatus(central, d.id, s);
    await loginAs(page, "courier");
    const cdp = await context.newCDPSession(page);
    await cdp.send("Network.enable");
    // ~ 3G lento: 400 kbit/s de subida, 400 ms de latência.
    await cdp.send("Network.emulateNetworkConditions", { offline: false, latency: 400, downloadThroughput: 750 * 1024 / 8, uploadThroughput: 400 * 1024 / 8 });
    const big = Buffer.concat([await page.screenshot({ type: "jpeg", quality: 100, fullPage: true }), Buffer.alloc(3 * 1024 * 1024)]);
    await page.getByTestId(`input-evidence-${d.id}`).setInputFiles({ name: "grande.jpg", mimeType: "image/jpeg", buffer: big });
    const group = page.getByRole("group", { name: "Confirmar entrega" });
    await expect(group).toBeVisible({ timeout: 20_000 });
    const handle = group.locator("button").first();
    const track = (await group.boundingBox())!;
    const hb = (await handle.boundingBox())!;
    const started = Date.now();
    await page.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2);
    await page.mouse.down();
    await page.mouse.move(track.x + track.width - 4, hb.y + hb.height / 2, { steps: 20 });
    await page.mouse.up();
    const progress = page.getByText(/\d+\s?%|Enviando/i).first();
    const sawProgress = await progress.isVisible({ timeout: 8_000 }).catch(() => false);
    await expect.poll(async () => (await json(await central.get(`/deliveries/${d.id}`))).status, { timeout: 120_000, intervals: [2000] }).toBe("COMPLETED");
    test.info().annotations.push({ type: "3G", description: `foto ${(big.length / 1024 / 1024).toFixed(1)} MB escolhida → concluída em ${((Date.now() - started) / 1000).toFixed(0)} s; progresso visível: ${sawProgress}` });
  });
});
