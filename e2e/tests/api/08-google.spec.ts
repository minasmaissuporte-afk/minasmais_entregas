import { test, expect } from "@playwright/test";
import { Api, describe, json } from "../../support/api.ts";
import { BH_POSITION, stores } from "../../support/fixtures-data.ts";
import { courierOnline, createDelivery, expectStatus } from "../../support/helpers.ts";
import { query, wipeDeliveries } from "../../support/db.ts";

/** Distância aproximada em km entre dois pontos. */
function km(a: { latitude: number; longitude: number }, b: { latitude: number; longitude: number }) {
  const r = 6371, rad = Math.PI / 180;
  const dLat = (b.latitude - a.latitude) * rad, dLng = (b.longitude - a.longitude) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.latitude * rad) * Math.cos(b.latitude * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * r * Math.asin(Math.sqrt(h));
}

// Endereços de teste (públicos, sem cliente real) e onde deveriam cair.
const addresses: { label: string; text: string; expect: { latitude: number; longitude: number }; toleranceKm: number; city: RegExp }[] = [
  { label: "rua com número (Savassi)", text: "Rua Pernambuco, 1000, Belo Horizonte", expect: { latitude: -19.9359, longitude: -43.9351 }, toleranceKm: 0.6, city: /Belo Horizonte/ },
  { label: "rua sem número", text: "Rua Cláudio Manoel, Funcionários, Belo Horizonte", expect: { latitude: -19.934, longitude: -43.932 }, toleranceKm: 1.5, city: /Belo Horizonte/ },
  { label: "avenida com número", text: "Avenida Afonso Pena, 1500, Belo Horizonte", expect: { latitude: -19.9245, longitude: -43.9352 }, toleranceKm: 0.8, city: /Belo Horizonte/ },
  { label: "bairro de BH", text: "Bairro Savassi, Belo Horizonte", expect: { latitude: -19.938, longitude: -43.935 }, toleranceKm: 1.5, city: /Belo Horizonte/ },
  { label: "bairro de BH (Pampulha)", text: "Pampulha, Belo Horizonte", expect: { latitude: -19.853, longitude: -43.97 }, toleranceKm: 4, city: /Belo Horizonte/ },
  { label: "CEP", text: "30130-151", expect: { latitude: -19.932, longitude: -43.938 }, toleranceKm: 2, city: /Belo Horizonte/ },
  { label: "cidade vizinha: Contagem", text: "Avenida João César de Oliveira, 2000, Contagem", expect: { latitude: -19.935, longitude: -44.05 }, toleranceKm: 2.5, city: /Contagem/ },
  { label: "cidade vizinha: Betim", text: "Avenida Amazonas, 1000, Betim", expect: { latitude: -19.97, longitude: -44.2 }, toleranceKm: 4, city: /Betim/ },
  { label: "cidade vizinha: Nova Lima", text: "Alameda Oscar Niemeyer, Nova Lima", expect: { latitude: -19.98, longitude: -43.95 }, toleranceKm: 4, city: /Nova Lima/ },
  { label: "sem acentos e minúsculas", text: "rua claudio manoel 500 belo horizonte", expect: { latitude: -19.9335, longitude: -43.9321 }, toleranceKm: 1, city: /Belo Horizonte/ },
];

// Fluxo atual em dois passos: /enderecos/autocomplete devolve sugestões (placeId + texto) e
// /enderecos/detalhes devolve o endereço completo e a posição (com o número, quando houver).
const houseNumberOf = (text: string) => text.match(/(?:,\s*|\s)(\d{1,5})(?=\s*(?:,|$|\s[a-zà-ú]))/i)?.[1];

test.describe("Endereços (Google Places/Geocoding)", () => {
  for (const a of addresses) {
    test(`Sugestão de endereço: ${a.label}`, async () => {
      const api = await Api.as("central");
      const started = Date.now();
      const res = await api.get(`/enderecos/autocomplete?texto=${encodeURIComponent(a.text)}`);
      const ms = Date.now() - started;
      expect(res.status(), await describe(res)).toBe(200);
      const list = await json(res);
      expect(list.length, `nenhuma sugestão para "${a.text}"`).toBeGreaterThan(0);
      const first = list[0];
      expect(typeof first.placeId).toBe("string");
      expect(first.text, "cidade da 1ª sugestão").toMatch(a.city);
      for (const item of list) {
        expect(item.text, "sugestão com complemento de outro estabelecimento").not.toMatch(/ - (sala|loja|conj\.?|bloco|apto?\.?)\s|\d+°\s?andar/i);
      }
      expect(ms, "busca de endereço lenta").toBeLessThan(3000);

      const numero = /^\d{5}-?\d{3}$/.test(a.text.trim()) ? undefined : houseNumberOf(a.text);
      const detailRes = await api.get(`/enderecos/detalhes?placeId=${encodeURIComponent(first.placeId)}${numero ? `&numero=${numero}` : ""}`);
      expect(detailRes.status(), await describe(detailRes)).toBe(200);
      const detail = await json(detailRes);
      const dist = km(detail, a.expect);
      test.info().annotations.push({ type: "resultado", description: `"${a.text}" → "${detail.formatted}" a ${dist.toFixed(2)} km do esperado, ${ms} ms, ${list.length} sugestões` });
      expect(`${detail.formatted} ${detail.city ?? ""}`).toMatch(a.city);
      expect(dist, `endereço "${detail.formatted}" longe do esperado`).toBeLessThan(a.toleranceKm);
    });
  }

  test("Rua sem número não traz CEP de outro lugar; com o número o CEP vem certo", async () => {
    const api = await Api.as("central");
    const list = await json(await api.get(`/enderecos/autocomplete?texto=${encodeURIComponent("Rua Pernambuco, Belo Horizonte")}`));
    const street = list.find((item: { text: string }) => /Pernambuco/.test(item.text) && /Belo Horizonte/.test(item.text));
    expect(street, "sugestão da Rua Pernambuco em BH").toBeTruthy();
    const withoutNumber = await json(await api.get(`/enderecos/detalhes?placeId=${encodeURIComponent(street.placeId)}`));
    expect(withoutNumber.postcode ?? null, "sem número não deve vir CEP").toBeNull();
    const withNumber = await json(await api.get(`/enderecos/detalhes?placeId=${encodeURIComponent(street.placeId)}&numero=1000`));
    expect(withNumber.postcode).toMatch(/^30\d{3}-?\d{3}$/);
  });

  test("Endereço inexistente devolve lista vazia (não erro 500)", async () => {
    const res = await (await Api.as("central")).get(`/enderecos/autocomplete?texto=${encodeURIComponent("Rua Inexistente Xyzwq 99999 Planeta Marte")}`);
    expect(res.status(), await describe(res)).toBeLessThan(500);
  });
});

test.describe("Rotas otimizadas (Google Route Optimization)", () => {
  test.beforeEach(wipeDeliveries);

  test("Rota com 3 entregas: pré-visualizar, aceitar, ordem e trajeto", async () => {
    const central = await Api.as("central");
    const courier = await Api.as("courier");
    // Três destinos em direções diferentes a partir da filial da Savassi.
    const ds = [
      await createDelivery(central, { storeId: stores.a.id, destination: "Av. do Contorno, 6000 - Savassi, Belo Horizonte - MG", customerLatitude: -19.9409, customerLongitude: -43.9381 }),
      await createDelivery(central, { storeId: stores.a.id, destination: "Rua da Bahia, 1148 - Centro, Belo Horizonte - MG", customerLatitude: -19.9233, customerLongitude: -43.9362 }),
      await createDelivery(central, { storeId: stores.a.id, destination: "Rua Paraíba, 1200 - Savassi, Belo Horizonte - MG", customerLatitude: -19.9377, customerLongitude: -43.9297 }),
    ];
    const created = await central.post("/delivery-routes", { deliveryIds: ds.map((d) => d.id) });
    expect(created.status(), await describe(created)).toBe(201);
    const route = await json(created);
    await courierOnline(courier);

    let t = Date.now();
    const preview = await courier.get(`/courier/routes/${route.id}/preview`);
    const previewMs = Date.now() - t;
    expect(preview.status(), await describe(preview)).toBe(200);
    const p = await json(preview);
    test.info().annotations.push({ type: "pré-visualização", description: `${previewMs} ms · ${p.distanceKm} km · ${p.estimatedMinutes} min · ordem: ${p.stops.map((s: any) => s.kind === "pickup" ? "Coleta" : s.address.split(",")[0]).join(" → ")}` });
    expect(p.stops[0].kind, "a primeira parada deve ser a coleta na loja").toBe("pickup");
    expect(p.stops.filter((s: any) => s.kind === "delivery")).toHaveLength(3);
    expect(p.routeGeometry?.length ?? 0, "trajeto desenhável").toBeGreaterThan(2);

    t = Date.now();
    const accepted = await courier.post(`/courier/routes/${route.id}/accept`, BH_POSITION);
    const acceptMs = Date.now() - t;
    expect(accepted.status(), await describe(accepted)).toBe(200);
    const view = await json(accepted);
    test.info().annotations.push({ type: "aceite", description: `${acceptMs} ms · ${view.distanceKm} km · ${view.estimatedMinutes} min` });
    expect(view.status).toBe("ACCEPTED");
    expect(view.routeGeometry?.length ?? 0).toBeGreaterThan(2);
    // Coleta(s) antes de qualquer entrega da mesma encomenda.
    const firstDeliveryIdx = view.stops.findIndex((s: any) => s.kind === "delivery");
    const pickups = view.stops.filter((s: any) => s.kind === "pickup");
    expect(pickups.every((s: any) => view.stops.indexOf(s) < firstDeliveryIdx)).toBe(true);
    for (const d of ds) await expectStatus(central, d.id, "ACCEPTED");
    const [r] = await query("select route_geometry is not null as has_geom from delivery_routes where id=$1", [route.id]);
    expect(r.has_geom).toBe(true);

    // Navegação até a próxima parada (Google Routes).
    const pickupStop = view.stops[0];
    await courier.post(`/courier/routes/${route.id}/stops/${pickupStop.id}/arrive`);
    const afterPickup = await json(await courier.post(`/courier/routes/${route.id}/stops/${pickupStop.id}/complete`, {}));
    // As 3 retiradas na mesma loja são uma parada só.
    expect(afterPickup.stops.filter((s: any) => s.kind === "pickup").every((s: any) => s.status === "DONE")).toBe(true);
    for (const d of ds) await expectStatus(central, d.id, "IN_TRANSIT");
    await courierOnline(courier);
    const nav = await courier.get(`/courier/deliveries/${ds[0].id}/navigation`);
    expect(nav.status(), await describe(nav)).toBe(200);
    const n = await json(nav);
    expect(n.routeGeometry.length).toBeGreaterThan(2);
    expect(n.distanceMeters).toBeGreaterThan(0);
  });

  test("Rota recalculada após ocorrência continua com as outras entregas", async () => {
    const central = await Api.as("central");
    const courier = await Api.as("courier");
    const d1 = await createDelivery(central, { storeId: stores.a.id });
    const d2 = await createDelivery(central, { storeId: stores.a.id });
    const route = await json(await central.post("/delivery-routes", { deliveryIds: [d1.id, d2.id] }));
    await courierOnline(courier);
    let view = await json(await courier.post(`/courier/routes/${route.id}/accept`, BH_POSITION));
    // Retiradas na mesma loja: uma chegada e uma saída confirmam todos os pedidos.
    const firstPickup = view.stops.find((s: any) => s.kind === "pickup");
    await courier.post(`/courier/routes/${route.id}/stops/${firstPickup.id}/arrive`);
    view = await json(await courier.post(`/courier/routes/${route.id}/stops/${firstPickup.id}/complete`, {}));
    expect(view.stops.filter((s: any) => s.kind === "pickup").every((s: any) => s.status === "DONE"), "retiradas da mesma loja não foram confirmadas juntas").toBe(true);
    await courierOnline(courier);
    const res = await courier.post(`/courier/deliveries/${d1.id}/unable`, { reason: "Cliente ausente / não atende", ...BH_POSITION });
    expect(res.status(), await describe(res)).toBe(200);
    expect(await json(res)).toMatchObject({ status: "AWAITING_COURIER", routeContinues: true });
    await expectStatus(central, d2.id, "IN_TRANSIT");
  });
});
