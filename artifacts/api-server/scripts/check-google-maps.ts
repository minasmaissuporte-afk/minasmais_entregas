/**
 * Testa a integração com o Google Maps usando as chaves do .env da raiz.
 * Uso: pnpm check:google
 *
 * Chama as mesmas funções que a API usa (src/lib/googleMaps.ts) com endereços
 * reais de Belo Horizonte e mostra, para cada serviço, se funcionou ou o motivo
 * da falha. Nunca imprime o valor das chaves.
 */
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const rootEnv = path.resolve(here, "..", "..", "..", ".env");
if (existsSync(rootEnv)) process.loadEnvFile(rootEnv);

const {
  autocompleteAddresses,
  computeDrivingRoute,
  geocodeAddress,
  optimizeShipments,
} = await import("../src/lib/googleMaps.ts");

type Result = { name: string; ok: boolean; detail: string };
const results: Result[] = [];

function configured(name: string) {
  return process.env[name]?.trim() ? "definida" : "VAZIA";
}

async function check(name: string, run: () => Promise<string>) {
  process.stdout.write(`• ${name}… `);
  try {
    const detail = await run();
    results.push({ name, ok: true, detail });
    console.log(`OK — ${detail}`);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    results.push({ name, ok: false, detail });
    console.log(`FALHOU — ${detail}`);
  }
}

console.log("Variáveis no .env:");
for (const name of [
  "GOOGLE_MAPS_API_KEY",
  "GOOGLE_SERVICE_ACCOUNT_JSON",
  "FIREBASE_SERVICE_ACCOUNT_JSON",
  "VITE_GOOGLE_MAPS_API_KEY",
  "VITE_GOOGLE_MAPS_MAP_ID",
]) {
  console.log(`  ${name}: ${configured(name)}`);
}
console.log("");

// Praça Sete e Savassi, em Belo Horizonte.
const store = { latitude: -19.9191, longitude: -43.9386 };
const customerA = { latitude: -19.9385, longitude: -43.9345 };
const customerB = { latitude: -19.9322, longitude: -43.9550 };

await check("Busca de endereço (Places API New)", async () => {
  const suggestions = await autocompleteAddresses("Rua Pernambuco 1000 Belo Horizonte");
  if (!suggestions.length) throw new Error("nenhuma sugestão retornada");
  const first = suggestions[0]!;
  return `${suggestions.length} sugestões; 1ª: ${first.formatted} (${first.city ?? "?"}/${first.stateCode ?? "?"})`;
});

await check("Geocodificação (Geocoding API)", async () => {
  const point = await geocodeAddress("Avenida Afonso Pena, 1500, Belo Horizonte, Minas Gerais, Brasil");
  return `${point.latitude.toFixed(5)}, ${point.longitude.toFixed(5)}`;
});

await check("Traçado da rota (Routes API)", async () => {
  const route = await computeDrivingRoute([store, customerA]);
  const km = route.distanceMeters !== null ? (route.distanceMeters / 1000).toFixed(1) : "?";
  const min = route.durationSeconds !== null ? Math.round(route.durationSeconds / 60) : "?";
  return `${km} km, ${min} min, ${route.geometry.length} pontos no traçado`;
});

await check("Otimização de rotas agrupadas (Route Optimization API)", async () => {
  const visits = await optimizeShipments({
    start: { latitude: -19.9250, longitude: -43.9450 },
    shipments: [
      { id: "pedido-A", pickup: store, delivery: customerA, pickupDurationSeconds: 120, deliveryDurationSeconds: 90 },
      { id: "pedido-B", pickup: store, delivery: customerB, pickupDurationSeconds: 120, deliveryDurationSeconds: 90 },
    ],
  });
  if (visits.length !== 4) throw new Error(`esperava 4 paradas, vieram ${visits.length}`);
  for (const id of ["pedido-A", "pedido-B"]) {
    const pickup = visits.findIndex((v) => v.shipmentId === id && v.kind === "pickup");
    const delivery = visits.findIndex((v) => v.shipmentId === id && v.kind === "delivery");
    if (pickup < 0 || delivery < 0 || pickup > delivery) {
      throw new Error(`ordem inválida para ${id}: a coleta precisa vir antes da entrega`);
    }
  }
  return visits.map((v) => `${v.kind === "pickup" ? "coleta" : "entrega"} ${v.shipmentId}`).join(" → ");
});

const failed = results.filter((result) => !result.ok);
console.log("");
console.log(
  failed.length
    ? `${results.length - failed.length}/${results.length} serviços funcionando. Corrija os itens que falharam e rode de novo.`
    : `Tudo certo: ${results.length}/${results.length} serviços do Google funcionando.`,
);
console.log(
  "Obs.: o mapa do painel (VITE_GOOGLE_MAPS_API_KEY e Map ID) só pode ser testado no navegador.",
);
process.exitCode = failed.length ? 1 : 0;
