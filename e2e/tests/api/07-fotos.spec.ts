import { test, expect } from "@playwright/test";
import { Api, describe, json } from "../../support/api.ts";
import { stores } from "../../support/fixtures-data.ts";
import { courierOnline, createDelivery, expectError, expectStatus, setStatus } from "../../support/helpers.ts";
import { seedAcceptedRoute, wipeDeliveries } from "../../support/db.ts";

// JPEG 1×1 válido. Para "foto grande", completamos com bytes até o tamanho desejado.
const TINY_JPEG = Buffer.from(
  "/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=",
  "base64",
);
const jpegOfSize = (bytes: number) => Buffer.concat([TINY_JPEG, Buffer.alloc(Math.max(0, bytes - TINY_JPEG.length))]);

/** Pede a URL assinada e envia a foto direto ao Supabase, como o app faz. */
async function uploadEvidence(courier: Api, deliveryId: string, photo: Buffer, contentType = "image/jpeg") {
  const res = await courier.post(`/deliveries/${deliveryId}/evidence/upload-url`, { name: "comprovante.jpg", size: photo.length, contentType });
  expect(res.status(), await describe(res)).toBe(200);
  const { uploadURL, objectPath } = await json(res);
  const started = Date.now();
  const put = await fetch(uploadURL, { method: "PUT", headers: { "Content-Type": contentType }, body: new Uint8Array(photo) });
  const seconds = (Date.now() - started) / 1000;
  expect(put.status, `upload no Supabase: ${put.status} ${(await put.text()).slice(0, 200)}`).toBeLessThan(300);
  return { objectPath: objectPath as string, seconds };
}

async function inTransit() {
  const central = await Api.as("central");
  const courier = await Api.as("courier");
  await courierOnline(courier);
  const d = await createDelivery(central, { storeId: stores.a.id });
  await central.post(`/deliveries/${d.id}/dispatch`, { mode: "single", courierId: "e2e-courier-1" });
  for (const s of ["ACCEPTED", "AT_STORE", "IN_TRANSIT"]) await setStatus(central, d.id, s);
  return { central, courier, d };
}

test.describe("Fotos de comprovação (Supabase Storage)", () => {
  test.beforeEach(wipeDeliveries);

  test("Motoboy envia foto e conclui; Central, gerente da filial e o motoboy veem a foto; outra filial não", async () => {
    const { central, courier, d } = await inTransit();
    const { objectPath } = await uploadEvidence(courier, d.id, TINY_JPEG);
    const done = await setStatus(courier, d.id, "COMPLETED", { evidencePath: objectPath });
    expect(done.status(), await describe(done)).toBe(200);
    await expectStatus(central, d.id, "COMPLETED");
    expect((await json(await central.get(`/deliveries/${d.id}`))).evidenceAvailable).toBe(true);

    for (const role of ["central", "admin", "manager", "courier"] as const) {
      const photo = await (await Api.as(role)).get(`/deliveries/${d.id}/evidence`);
      expect(photo.status(), `${role}: ${await describe(photo)}`).toBe(200);
      expect(photo.headers()["content-type"]).toMatch(/image\/jpeg/);
      expect((await photo.body()).subarray(0, 2).toString("hex")).toBe("ffd8");
    }
    await expectError(await (await Api.as("staff")).get(`/deliveries/${d.id}/evidence`), 403);

    // Pedir nova URL depois de concluída → 409 (não troca a foto de entrega já fechada).
    const again = await courier.post(`/deliveries/${d.id}/evidence/upload-url`, { name: "x.jpg", size: 100, contentType: "image/jpeg" });
    expect(again.status(), await describe(again)).toBe(409);
  });

  test("Foto grande (7,5 MB) dentro do limite: envia, conclui e mede o tempo de upload", async () => {
    const { courier, d } = await inTransit();
    const { objectPath, seconds } = await uploadEvidence(courier, d.id, jpegOfSize(7.5 * 1024 * 1024));
    test.info().annotations.push({ type: "tempo", description: `Upload de 7,5 MB levou ${seconds.toFixed(1)} s nesta rede` });
    const done = await setStatus(courier, d.id, "COMPLETED", { evidencePath: objectPath });
    expect(done.status(), await describe(done)).toBe(200);
  });

  test("Envio maior que o declarado (> 8 MB) não pode concluir a entrega", async () => {
    const { courier, d } = await inTransit();
    const res = await courier.post(`/deliveries/${d.id}/evidence/upload-url`, { name: "f.jpg", size: 1000, contentType: "image/jpeg" });
    const { uploadURL, objectPath } = await json(res);
    const put = await fetch(uploadURL, { method: "PUT", headers: { "Content-Type": "image/jpeg" }, body: new Uint8Array(jpegOfSize(9 * 1024 * 1024)) });
    if (put.status < 300) {
      // Se o Storage aceitou o arquivo, a API precisa recusar na conclusão.
      await expectError(await setStatus(courier, d.id, "COMPLETED", { evidencePath: objectPath }), 422);
    } else {
      await expectError(await setStatus(courier, d.id, "COMPLETED", { evidencePath: objectPath }), 422);
    }
  });

  test("Arquivo que não é imagem (texto com content-type de PDF) não conclui a entrega", async () => {
    const { courier, d } = await inTransit();
    const res = await courier.post(`/deliveries/${d.id}/evidence/upload-url`, { name: "f.jpg", size: 20, contentType: "image/jpeg" });
    const { uploadURL, objectPath } = await json(res);
    await fetch(uploadURL, { method: "PUT", headers: { "Content-Type": "application/pdf" }, body: new Uint8Array(Buffer.from("isto não é uma foto")) });
    await expectError(await setStatus(courier, d.id, "COMPLETED", { evidencePath: objectPath }), 422);
  });

  test("URL pedida mas foto não enviada: concluir → 422", async () => {
    const { courier, d } = await inTransit();
    const res = await courier.post(`/deliveries/${d.id}/evidence/upload-url`, { name: "f.jpg", size: 1000, contentType: "image/jpeg" });
    const { objectPath } = await json(res);
    await expectError(await setStatus(courier, d.id, "COMPLETED", { evidencePath: objectPath }), 422, "foto");
  });

  test("Foto de outra entrega não serve para concluir esta", async () => {
    const { courier, d } = await inTransit();
    const { objectPath } = await uploadEvidence(courier, d.id, TINY_JPEG);
    const central = await Api.as("central");
    const other = await createDelivery(central, { storeId: stores.a.id });
    await central.post(`/deliveries/${other.id}/dispatch`, { mode: "single", courierId: "e2e-courier-1" });
    await expectError(await setStatus(courier, other.id, "COMPLETED", { evidencePath: objectPath }), 422);
  });

  test("Rota: entrega concluída com foto pela parada; rota termina e motoboy fica livre", async () => {
    const central = await Api.as("central");
    const courier = await Api.as("courier");
    const d1 = await createDelivery(central, { storeId: stores.a.id });
    const d2 = await createDelivery(central, { storeId: stores.a.id });
    const { routeId, stops } = await seedAcceptedRoute([d1, d2]);
    const base = `/courier/routes/${routeId}/stops`;
    // Retirada única na loja: uma chegada e uma saída valem para os dois pedidos.
    await courier.post(`${base}/${stops[0].id}/arrive`);
    expect((await courier.post(`${base}/${stops[0].id}/complete`, {})).status()).toBe(200);
    for (const stop of stops.slice(2)) {
      const { objectPath } = await uploadEvidence(courier, stop.deliveryId, TINY_JPEG);
      const res = await courier.post(`${base}/${stop.id}/complete`, { evidencePath: objectPath });
      expect(res.status(), await describe(res)).toBe(200);
      await expectStatus(central, stop.deliveryId, "COMPLETED");
    }
    const mine = await json(await courier.get("/courier/routes"));
    expect(mine.find((r: any) => r.id === routeId)).toBeFalsy();
    const earnings = await json(await courier.get("/courier/earnings?period=day"));
    expect(earnings.completedDeliveries).toBeGreaterThanOrEqual(2);
  });

  test("Admin exclui entrega concluída: foto some junto (GET /evidence → 404)", async () => {
    const { courier, d } = await inTransit();
    const { objectPath } = await uploadEvidence(courier, d.id, TINY_JPEG);
    await setStatus(courier, d.id, "COMPLETED", { evidencePath: objectPath });
    const admin = await Api.as("admin");
    expect((await admin.delete(`/deliveries/${d.id}`)).status()).toBe(204);
    await expectError(await admin.get(`/deliveries/${d.id}/evidence`), 404);
  });
});
