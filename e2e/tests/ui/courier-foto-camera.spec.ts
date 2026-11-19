import { test, expect } from "@playwright/test";
import { Api, json } from "../../support/api.ts";
import { stores } from "../../support/fixtures-data.ts";
import { courierOnline, createDelivery, setStatus } from "../../support/helpers.ts";
import { wipeDeliveries } from "../../support/db.ts";
import { loginAs } from "../../support/ui.ts";

/** BMP 24 bits pequeno (formato que o servidor não aceita): precisa virar JPEG antes do envio. */
function bmp(width = 16, height = 16) {
  const rowSize = Math.ceil((width * 3) / 4) * 4;
  const size = 54 + rowSize * height;
  const buffer = Buffer.alloc(size);
  buffer.write("BM", 0);
  buffer.writeUInt32LE(size, 2);
  buffer.writeUInt32LE(54, 10);
  buffer.writeUInt32LE(40, 14);
  buffer.writeInt32LE(width, 18);
  buffer.writeInt32LE(height, 22);
  buffer.writeUInt16LE(1, 26);
  buffer.writeUInt16LE(24, 28);
  buffer.writeUInt32LE(rowSize * height, 34);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const offset = 54 + y * rowSize + x * 3;
      buffer[offset] = 40;
      buffer[offset + 1] = 120;
      buffer[offset + 2] = 200;
    }
  }
  return buffer;
}

test.describe("Foto de comprovação pela câmera", () => {
  test.beforeEach(wipeDeliveries);

  test("Campo abre a câmera traseira direto (image/* + capture) e foto em outro formato vira JPEG", async ({ page }) => {
    const central = await Api.as("central");
    const courier = await Api.as("courier");
    await courierOnline(courier);
    const d = await createDelivery(central, { storeId: stores.a.id, customerName: "E2E Foto Câmera" });
    await central.post(`/deliveries/${d.id}/dispatch`, { mode: "single", courierId: "e2e-courier-1" });
    for (const s of ["ACCEPTED", "AT_STORE", "IN_TRANSIT"]) await setStatus(central, d.id, s);
    await loginAs(page, "courier");

    const input = page.getByTestId(`input-evidence-${d.id}`);
    await expect(input).toBeAttached({ timeout: 20_000 });
    // O app Android (Capacitor) só abre a câmera quando o campo aceita exatamente "image/*".
    await expect(input).toHaveAttribute("accept", "image/*");
    await expect(input).toHaveAttribute("capture", "environment");
    await expect(page.getByText("Tirar foto de comprovação")).toBeVisible();

    const uploads: string[] = [];
    page.on("request", (request) => {
      if (request.method() === "PUT") uploads.push(request.headers()["content-type"] ?? "");
    });
    // Nome longo como o da câmera do Android: não pode empurrar o cartão para fora da tela.
    await input.setInputFiles({ name: "JPEG_20261119_132824_2606579040691234567890.bmp", mimeType: "image/bmp", buffer: bmp() });
    await expect(page.getByText("Tirar outra foto")).toBeVisible();
    await expect(page.getByText("Foto da câmera")).toBeVisible();
    await page.waitForTimeout(800);
    // O painel da aba Entregas não pode ganhar rolagem lateral (era o que empurrava o cartão).
    const shifted = await page.evaluate(() => {
      const panel = document.querySelector<HTMLElement>(".courier-tab-panel--deliveries");
      return panel && (panel.scrollLeft > 0 || panel.scrollWidth > panel.clientWidth + 1)
        ? [`scrollLeft=${panel.scrollLeft} ${panel.scrollWidth}/${panel.clientWidth}`]
        : [];
    });
    expect(shifted, "cartão da entrega saiu da largura da tela").toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
    const group = page.getByRole("group", { name: "Confirmar entrega" });
    await expect(group).toBeVisible({ timeout: 10_000 });
    const handle = group.locator("button").first();
    const track = (await group.boundingBox())!;
    const hb = (await handle.boundingBox())!;
    await page.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2);
    await page.mouse.down();
    await page.mouse.move(track.x + track.width - 4, hb.y + hb.height / 2, { steps: 20 });
    await page.mouse.up();
    await expect.poll(async () => (await json(await central.get(`/deliveries/${d.id}`))).status, { timeout: 30_000 }).toBe("COMPLETED");
    expect(uploads).toContain("image/jpeg");
  });
});
