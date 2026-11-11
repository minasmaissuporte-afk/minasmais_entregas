import { expect } from "@playwright/test";
import { Api, describe, json } from "./api.ts";
import { BH_POSITION, destinations, stores } from "./fixtures-data.ts";

let counter = 0;

export function deliveryInput(overrides: Record<string, unknown> = {}) {
  counter += 1;
  const dest = destinations[counter % destinations.length];
  return {
    customerName: `E2E Cliente ${counter} Conceição`,
    customerPhone: "(31) 99876-5432",
    destination: dest.address,
    customerLatitude: dest.lat,
    customerLongitude: dest.lng,
    orderNumber: `PED-${Date.now()}-${counter}`,
    notes: "Entregar na portaria. Troco para R$ 50,00.",
    storeId: stores.a.id,
    priority: "normal",
    ...overrides,
  };
}

/** Cria uma entrega como `role` e devolve o corpo (falha o teste se não for 201). */
export async function createDelivery(api: Api, overrides: Record<string, unknown> = {}) {
  const res = await api.post("/deliveries", deliveryInput(overrides));
  expect(res.status(), await describe(res)).toBe(201);
  return json(res);
}

export async function setStatus(api: Api, deliveryId: string, status: string, extra: Record<string, unknown> = {}) {
  return api.patch(`/deliveries/${deliveryId}/status`, { status, ...extra });
}

export async function expectStatus(api: Api, deliveryId: string, status: string) {
  const res = await api.get(`/deliveries/${deliveryId}`);
  expect(res.status(), await describe(res)).toBe(200);
  expect((await json(res)).status).toBe(status);
}

/** Motoboy fica online e envia uma posição GPS atual. */
export async function courierOnline(courier: Api, position = BH_POSITION) {
  const on = await courier.patch("/courier/availability", { online: true });
  expect(on.status(), await describe(on)).toBe(200);
  const loc = await courier.post("/courier/location", {
    ...position,
    accuracyMeters: 8,
    speedMetersPerSecond: 0,
    measuredAt: new Date().toISOString(),
  });
  expect(loc.status(), await describe(loc)).toBeLessThan(300);
}

export async function expectError(res: Awaited<ReturnType<Api["get"]>>, status: number, messagePart?: string) {
  expect(res.status(), await describe(res)).toBe(status);
  if (messagePart) expect((await json(res)).error).toContain(messagePart);
}
