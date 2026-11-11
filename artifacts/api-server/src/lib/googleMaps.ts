/**
 * Integração com a Google Maps Platform.
 *
 * - Busca de endereços: Places API (New) — Text Search
 * - Geocodificação: Geocoding API
 * - Traçado viário: Routes API — computeRoutes
 * - Otimização de rotas agrupadas: Route Optimization API — optimizeTours
 *
 * As três primeiras usam a chave GOOGLE_MAPS_API_KEY. A Route Optimization API
 * não aceita chave de API: exige uma conta de serviço do Google Cloud
 * (GOOGLE_SERVICE_ACCOUNT_JSON, ou FIREBASE_SERVICE_ACCOUNT_JSON como reserva).
 */
import { GoogleAuth } from "google-auth-library";

export type Coordinate = {
  latitude: number;
  longitude: number;
};

export type AddressSuggestion = {
  formatted: string;
  street: string | null;
  houseNumber: string | null;
  suburb: string | null;
  district: string | null;
  city: string | null;
  stateCode: string | null;
  postcode: string | null;
  latitude: number;
  longitude: number;
};

export type DrivingRoute = {
  geometry: Coordinate[];
  distanceMeters: number | null;
  durationSeconds: number | null;
};

export type OptimizationShipment = {
  id: string;
  /** null quando o motoboy já está com o pedido (não há coleta a fazer). */
  pickup: Coordinate | null;
  delivery: Coordinate;
  pickupDurationSeconds: number;
  deliveryDurationSeconds: number;
};

export type OptimizedVisit = {
  shipmentId: string;
  kind: "pickup" | "delivery";
};

export class MapsApiError extends Error {
  constructor(
    message: string,
    readonly status = 502,
  ) {
    super(message);
  }
}

const REQUEST_TIMEOUT_MS = 15_000;

// Retângulo que cobre o território brasileiro: restringe a busca de endereços ao país.
const BRAZIL_BOUNDS = {
  low: { latitude: -33.9, longitude: -74.1 },
  high: { latitude: 5.4, longitude: -34.7 },
};

function apiKey() {
  const key = process.env.GOOGLE_MAPS_API_KEY?.trim();
  if (!key) {
    throw new MapsApiError(
      "A integração com o Google Maps não está configurada no servidor.",
      503,
    );
  }
  return key;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function validCoordinate(latitude: unknown, longitude: unknown): Coordinate | null {
  if (
    typeof latitude !== "number" ||
    typeof longitude !== "number" ||
    !Number.isFinite(latitude) ||
    !Number.isFinite(longitude) ||
    latitude < -90 ||
    latitude > 90 ||
    longitude < -180 ||
    longitude > 180
  ) {
    return null;
  }
  return { latitude, longitude };
}

async function request(
  url: string | URL,
  init: RequestInit,
  failureMessage: string,
  timeoutMs = REQUEST_TIMEOUT_MS,
): Promise<Response> {
  try {
    return await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
  } catch {
    throw new MapsApiError(failureMessage);
  }
}

/** Converte respostas de erro HTTP das APIs do Google em mensagens para o usuário. */
async function readJson(
  response: Response,
  service: string,
): Promise<Record<string, unknown>> {
  if (!response.ok) {
    if (response.status === 401 || response.status === 403) {
      throw new MapsApiError(
        `A chave do Google Maps não tem permissão para ${service}. Confira se a API está ativada no Google Cloud.`,
        503,
      );
    }
    if (response.status === 429) {
      throw new MapsApiError(
        "O limite de consultas do Google Maps foi atingido. Tente novamente em instantes.",
        503,
      );
    }
    if (response.status === 400) {
      throw new MapsApiError(`O Google Maps não conseguiu ${service} com os dados enviados.`, 422);
    }
    throw new MapsApiError(`O Google Maps não conseguiu ${service}.`);
  }
  return (await response.json()) as Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Busca de endereços (Places API New — Text Search)
// ---------------------------------------------------------------------------

type AddressComponent = { longText?: string; shortText?: string; types?: string[] };

function component(
  components: AddressComponent[],
  type: string,
  variant: "longText" | "shortText" = "longText",
): string | null {
  const value = components.find((item) => item.types?.includes(type))?.[variant];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export async function autocompleteAddresses(
  query: string,
): Promise<AddressSuggestion[]> {
  const response = await request(
    "https://places.googleapis.com/v1/places:searchText",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": apiKey(),
        "X-Goog-FieldMask":
          "places.formattedAddress,places.location,places.addressComponents",
      },
      body: JSON.stringify({
        textQuery: query,
        languageCode: "pt-BR",
        regionCode: "BR",
        pageSize: 5,
        locationRestriction: { rectangle: BRAZIL_BOUNDS },
      }),
    },
    "Não foi possível consultar o Google Maps agora.",
  );
  const payload = await readJson(response, "buscar endereços");
  const places = Array.isArray(payload.places) ? payload.places : [];

  return places.flatMap((value) => {
    const place = asRecord(value);
    const location = asRecord(place?.location);
    const coordinate = validCoordinate(location?.latitude, location?.longitude);
    const formatted =
      typeof place?.formattedAddress === "string" ? place.formattedAddress.trim() : "";
    if (!place || !coordinate || !formatted) return [];

    const components = (
      Array.isArray(place.addressComponents) ? place.addressComponents : []
    ) as AddressComponent[];
    return [{
      formatted,
      street: component(components, "route"),
      houseNumber: component(components, "street_number"),
      suburb:
        component(components, "sublocality_level_1") ??
        component(components, "sublocality") ??
        component(components, "neighborhood"),
      district: component(components, "sublocality_level_2"),
      city:
        component(components, "administrative_area_level_2") ??
        component(components, "locality"),
      stateCode: component(components, "administrative_area_level_1", "shortText"),
      postcode: component(components, "postal_code"),
      ...coordinate,
    }];
  });
}

// ---------------------------------------------------------------------------
// Geocodificação (Geocoding API)
// ---------------------------------------------------------------------------

export async function geocodeAddress(query: string): Promise<Coordinate> {
  const url = new URL("https://maps.googleapis.com/maps/api/geocode/json");
  url.searchParams.set("address", query);
  url.searchParams.set("components", "country:BR");
  url.searchParams.set("language", "pt-BR");
  url.searchParams.set("region", "br");
  url.searchParams.set("key", apiKey());

  const response = await request(url, {}, "Não foi possível consultar o Google Maps agora.");
  const payload = await readJson(response, "localizar o endereço");
  const status = typeof payload.status === "string" ? payload.status : "UNKNOWN_ERROR";

  if (status === "REQUEST_DENIED") {
    throw new MapsApiError(
      "A chave do Google Maps não tem permissão para geocodificação. Ative a Geocoding API no Google Cloud.",
      503,
    );
  }
  if (status === "OVER_QUERY_LIMIT" || status === "OVER_DAILY_LIMIT") {
    throw new MapsApiError(
      "O limite de consultas do Google Maps foi atingido. Tente novamente em instantes.",
      503,
    );
  }

  const results = Array.isArray(payload.results) ? payload.results : [];
  const location = asRecord(asRecord(asRecord(results[0])?.geometry)?.location);
  const coordinate = validCoordinate(location?.lat, location?.lng);
  if (status !== "OK" || !coordinate) {
    throw new MapsApiError(
      `Não foi possível localizar o endereço "${query}". Confira o endereço e tente novamente.`,
      422,
    );
  }
  return coordinate;
}

// ---------------------------------------------------------------------------
// Traçado viário (Routes API — computeRoutes)
// ---------------------------------------------------------------------------

/** Decodifica o formato "encoded polyline" usado pelo Google. */
export function decodePolyline(encoded: string): Coordinate[] {
  const points: Coordinate[] = [];
  let index = 0;
  let latitude = 0;
  let longitude = 0;

  const readValue = () => {
    let result = 0;
    let shift = 0;
    let byte: number;
    do {
      byte = encoded.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20 && index < encoded.length);
    return result & 1 ? ~(result >> 1) : result >> 1;
  };

  while (index < encoded.length) {
    latitude += readValue();
    longitude += readValue();
    points.push({ latitude: latitude / 1e5, longitude: longitude / 1e5 });
  }
  return points;
}

function parseDurationSeconds(value: unknown): number | null {
  if (typeof value !== "string") return null;
  const seconds = Number.parseFloat(value.replace(/s$/, ""));
  return Number.isFinite(seconds) ? seconds : null;
}

function toWaypoint({ latitude, longitude }: Coordinate) {
  return { location: { latLng: { latitude, longitude } } };
}

export async function computeDrivingRoute(
  coordinates: Coordinate[],
): Promise<DrivingRoute> {
  const routeCoordinates = coordinates.filter(
    (coordinate, index) =>
      index === 0 ||
      coordinate.latitude !== coordinates[index - 1]?.latitude ||
      coordinate.longitude !== coordinates[index - 1]?.longitude,
  );
  // computeRoutes aceita origem + destino + até 25 pontos intermediários.
  if (routeCoordinates.length < 2 || routeCoordinates.length > 27) {
    throw new MapsApiError("A rota precisa conter entre 2 e 27 pontos.", 422);
  }

  const origin = routeCoordinates[0]!;
  const destination = routeCoordinates.at(-1)!;
  const response = await request(
    "https://routes.googleapis.com/directions/v2:computeRoutes",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": apiKey(),
        "X-Goog-FieldMask":
          "routes.distanceMeters,routes.duration,routes.polyline.encodedPolyline",
      },
      body: JSON.stringify({
        origin: toWaypoint(origin),
        destination: toWaypoint(destination),
        intermediates: routeCoordinates.slice(1, -1).map(toWaypoint),
        travelMode: "DRIVE",
        routingPreference: "TRAFFIC_UNAWARE",
        languageCode: "pt-BR",
        regionCode: "BR",
        units: "METRIC",
      }),
    },
    "Não foi possível calcular a rota no Google Maps.",
    20_000,
  );
  const payload = await readJson(response, "calcular a rota");
  const routes = Array.isArray(payload.routes) ? payload.routes : [];
  const route = asRecord(routes[0]);
  const encoded = asRecord(route?.polyline)?.encodedPolyline;
  if (!route || typeof encoded !== "string" || !encoded) {
    throw new MapsApiError(
      "O Google Maps não encontrou uma rota viária para os endereços informados.",
      422,
    );
  }
  return {
    geometry: decodePolyline(encoded),
    distanceMeters:
      typeof route.distanceMeters === "number" ? route.distanceMeters : null,
    durationSeconds: parseDurationSeconds(route.duration),
  };
}

// ---------------------------------------------------------------------------
// Otimização de rotas agrupadas (Route Optimization API — optimizeTours)
// ---------------------------------------------------------------------------

type ServiceAccount = { project_id?: string; client_email?: string; private_key?: string };

let optimizationAuth: { projectId: string; auth: GoogleAuth } | null = null;

function getOptimizationAuth() {
  if (optimizationAuth) return optimizationAuth;
  const raw =
    process.env.GOOGLE_SERVICE_ACCOUNT_JSON?.trim() ||
    process.env.FIREBASE_SERVICE_ACCOUNT_JSON?.trim();
  if (!raw) {
    throw new MapsApiError(
      "A otimização de rotas do Google não está configurada no servidor (conta de serviço ausente).",
      503,
    );
  }
  let account: ServiceAccount;
  try {
    account = JSON.parse(raw) as ServiceAccount;
  } catch {
    throw new MapsApiError(
      "A conta de serviço do Google configurada no servidor não é um JSON válido.",
      503,
    );
  }
  const projectId = process.env.GOOGLE_CLOUD_PROJECT?.trim() || account.project_id;
  if (!projectId || !account.client_email || !account.private_key) {
    throw new MapsApiError(
      "A conta de serviço do Google está incompleta (project_id, client_email ou private_key).",
      503,
    );
  }
  optimizationAuth = {
    projectId,
    auth: new GoogleAuth({
      credentials: {
        client_email: account.client_email,
        private_key: account.private_key.replace(/\\n/g, "\n"),
      },
      projectId,
      scopes: ["https://www.googleapis.com/auth/cloud-platform"],
    }),
  };
  return optimizationAuth;
}

function toLatLng({ latitude, longitude }: Coordinate) {
  return { latitude, longitude };
}

/**
 * Ordena coletas e entregas para um único motoboy, minimizando o tempo de deslocamento.
 * A API garante que a coleta de cada pedido vem antes da entrega correspondente.
 * A rota é aberta: termina na última entrega.
 */
export async function optimizeShipments(input: {
  start: Coordinate;
  shipments: OptimizationShipment[];
}): Promise<OptimizedVisit[]> {
  const { projectId, auth } = getOptimizationAuth();
  let accessToken: string | null | undefined;
  try {
    accessToken = await auth.getAccessToken();
  } catch {
    throw new MapsApiError(
      "Não foi possível autenticar a conta de serviço do Google para otimizar a rota.",
      503,
    );
  }
  if (!accessToken) {
    throw new MapsApiError(
      "Não foi possível autenticar a conta de serviço do Google para otimizar a rota.",
      503,
    );
  }

  const response = await request(
    `https://routeoptimization.googleapis.com/v1/projects/${encodeURIComponent(projectId)}:optimizeTours`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({
        timeout: "15s",
        model: {
          shipments: input.shipments.map((shipment) => ({
            label: shipment.id,
            ...(shipment.pickup
              ? {
                  pickups: [{
                    arrivalLocation: toLatLng(shipment.pickup),
                    duration: `${shipment.pickupDurationSeconds}s`,
                  }],
                }
              : {}),
            deliveries: [{
              arrivalLocation: toLatLng(shipment.delivery),
              duration: `${shipment.deliveryDurationSeconds}s`,
            }],
          })),
          vehicles: [{
            label: "courier",
            startLocation: toLatLng(input.start),
            travelMode: "DRIVING",
            costPerTraveledHour: 1,
          }],
        },
      }),
    },
    "Não foi possível enviar a rota para otimização no Google Maps.",
    25_000,
  );
  const payload = await readJson(response, "otimizar as entregas");

  if (Array.isArray(payload.skippedShipments) && payload.skippedShipments.length) {
    throw new MapsApiError(
      "O Google Maps não conseguiu incluir todas as entregas. Confira os endereços e tente novamente.",
      422,
    );
  }
  const routes = Array.isArray(payload.routes) ? payload.routes : [];
  const visits = asRecord(routes[0])?.visits;
  if (!Array.isArray(visits)) {
    throw new MapsApiError("O Google Maps não retornou uma rota para estas entregas.");
  }

  // Em JSON, a API omite campos com valor padrão: shipmentIndex 0 e isPickup false vêm ausentes.
  return visits.flatMap((value) => {
    const visit = asRecord(value);
    if (!visit) return [];
    const shipmentIndex =
      typeof visit.shipmentIndex === "number" ? visit.shipmentIndex : 0;
    const shipment = input.shipments[shipmentIndex];
    if (!shipment) return [];
    return [{
      shipmentId: shipment.id,
      kind: visit.isPickup === true ? ("pickup" as const) : ("delivery" as const),
    }];
  });
}
