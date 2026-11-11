import { test, expect } from "@playwright/test";
import { Api, describe, json } from "../../support/api.ts";
import { stores } from "../../support/fixtures-data.ts";
import { createDelivery, expectError } from "../../support/helpers.ts";
import { wipeDeliveries } from "../../support/db.ts";

const validStore = {
  name: "E2E Filial Pampulha Ação",
  address: "Av. Otacílio Negrão de Lima, 3000 - Pampulha, Belo Horizonte - MG",
  street: "Av. Otacílio Negrão de Lima",
  number: "3000",
  complement: "Loja 2",
  neighborhood: "Pampulha",
  city: "Belo Horizonte",
  stateCode: "mg",
  postalCode: "31365-450",
  phone: "(31) 3456-7890",
  managerName: "E2E Gerente Pampulha",
  managerPhone: "(31) 99111-2222",
  latitude: -19.8517,
  longitude: -43.9686,
  deliveryFee: 12.5,
};

test.describe("Filiais (lojas)", () => {
  test.beforeAll(wipeDeliveries);

  test("Admin cria, edita e exclui filial; tarifa em reais vira centavos sem perder precisão", async () => {
    const admin = await Api.as("admin");
    const created = await admin.post("/stores", validStore);
    expect(created.status(), await describe(created)).toBe(201);
    const store = await json(created);
    expect(store).toMatchObject({
      name: validStore.name,
      city: "Belo Horizonte",
      active: true,
      deliveryFee: 12.5,
      deliveryCount: 0,
    });
    expect(store.code).toMatch(/^FIL-[0-9A-F]{8}$/);
    expect(store.stateCode).toBe("MG");

    const updated = await admin.put(`/stores/${store.id}`, { ...validStore, name: "E2E Filial Pampulha Editada", deliveryFee: 9.99 });
    expect(updated.status(), await describe(updated)).toBe(200);
    expect(await json(updated)).toMatchObject({ name: "E2E Filial Pampulha Editada", deliveryFee: 9.99 });

    const list = await json(await admin.get("/stores"));
    expect(list.map((s: any) => s.id)).toContain(store.id);

    const removed = await admin.delete(`/stores/${store.id}`);
    expect(removed.status(), await describe(removed)).toBe(204);
    await expectError(await admin.delete(`/stores/${store.id}`), 404);
    await expectError(await admin.put(`/stores/${store.id}`, validStore), 404);
  });

  const invalid: [string, Record<string, unknown>][] = [
    ["nome curto", { name: "A" }],
    ["sem endereço", { address: "" }],
    ["UF com 3 letras", { stateCode: "MGX" }],
    ["latitude fora do intervalo", { latitude: -91 }],
    ["longitude fora do intervalo", { longitude: 181 }],
    ["tarifa negativa", { deliveryFee: -1 }],
    ["gerente vazio", { managerName: "" }],
    ["tarifa como texto", { deliveryFee: "dez reais" }],
  ];
  for (const [label, patch] of invalid) {
    test(`Validação ao criar filial: ${label} → 400`, async () => {
      const admin = await Api.as("admin");
      await expectError(await admin.post("/stores", { ...validStore, ...patch }), 400);
    });
  }

  test("Gerente e atendente só enxergam a própria filial", async () => {
    const manager = await json(await (await Api.as("manager")).get("/stores"));
    expect(manager.map((s: any) => s.id)).toEqual([stores.a.id]);
    const staff = await json(await (await Api.as("staff")).get("/stores"));
    expect(staff.map((s: any) => s.id)).toEqual([stores.b.id]);
  });

  test("Central vê todas as filiais E2E, inclusive a inativa", async () => {
    const all = await json(await (await Api.as("central")).get("/stores"));
    const ids = all.map((s: any) => s.id);
    for (const s of Object.values(stores)) expect(ids).toContain(s.id);
    expect(all.find((s: any) => s.id === stores.inactive.id).active).toBe(false);
  });

  test("Não exclui filial com entregas vinculadas nem com conta vinculada", async () => {
    const admin = await Api.as("admin");
    await createDelivery(admin, { storeId: stores.b.id });
    await expectError(await admin.delete(`/stores/${stores.b.id}`), 409, "entregas vinculadas");
    await expectError(await admin.delete(`/stores/${stores.a.id}`), 409);
  });

  test("Contagem de entregas da filial acompanha as entregas criadas", async () => {
    const admin = await Api.as("admin");
    const before = (await json(await admin.get("/stores"))).find((s: any) => s.id === stores.a.id).deliveryCount;
    await createDelivery(admin, { storeId: stores.a.id });
    const after = (await json(await admin.get("/stores"))).find((s: any) => s.id === stores.a.id).deliveryCount;
    expect(after).toBe(before + 1);
  });
});

test.describe("Busca de endereço (Google Maps)", () => {
  test("Texto com menos de 3 caracteres → 422", async () => {
    const api = await Api.as("central");
    await expectError(await api.get("/enderecos/autocomplete?texto=ab"), 422, "3 caracteres");
    await expectError(await api.get("/enderecos/autocomplete?texto=%20%20%20ab%20"), 422);
  });

  test("[BUG] Sem o parâmetro texto → 422 (hoje o coerce transforma undefined em \"undefined\" e consulta o Google Maps)", async () => {
    const api = await Api.as("central");
    await expectError(await api.get("/enderecos/autocomplete"), 422);
  });

  test("Busca real devolve sugestões em MG com coordenadas válidas", async () => {
    test.skip(!process.env.GOOGLE_MAPS_API_KEY, "GOOGLE_MAPS_API_KEY não configurada");
    const api = await Api.as("manager");
    const res = await api.get(`/enderecos/autocomplete?texto=${encodeURIComponent("Rua Pernambuco 1000 Belo Horizonte")}`);
    expect(res.status(), await describe(res)).toBe(200);
    const list = await json(res);
    expect(list.length).toBeGreaterThan(0);
    for (const item of list) {
      expect(item.latitude).toBeGreaterThanOrEqual(-90);
      expect(item.longitude).toBeLessThanOrEqual(180);
      expect(typeof item.formatted).toBe("string");
    }
    expect(list.some((item: any) => item.stateCode === "MG" || /Belo Horizonte/.test(item.formatted))).toBe(true);
  });
});
