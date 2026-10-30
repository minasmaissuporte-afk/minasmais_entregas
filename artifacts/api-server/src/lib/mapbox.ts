export type Coordinate = {
  latitude: number;
  longitude: number;
};

export type MapboxAddressSuggestion = {
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

type MapboxFeature = {
  geometry?: { coordinates?: unknown };
  properties?: Record<string, unknown>;
};

export type MapboxOptimizationStop = {
  type?: string;
  location?: string;
  pickups?: unknown;
  dropoffs?: unknown;
};

export type MapboxOptimizationSolution = {
  dropped?: { shipments?: unknown[] };
  routes?: Array<{
    vehicle?: string;
    stops?: MapboxOptimizationStop[];
  }>;
};

export type MapboxDirectionRoute = {
  geometry?: { coordinates?: unknown };
  distance?: number;
  duration?: number;
};

export class MapboxApiError extends Error {
  constructor(
    message: string,
    readonly status = 502,
  ) {
    super(message);
  }
}

function accessToken() {
  const token = process.env.MAPBOX_ACCESS_TOKEN;
  if (!token) {
    throw new MapboxApiError(
      "A integração Mapbox não está configurada no servidor.",
      503,
    );
  }
  return token;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function recordName(value: unknown): string | null {
  const name = asRecord(value)?.name;
  return typeof name === "string" && name.trim() ? name : null;
}

function featureCoordinate(feature: MapboxFeature): Coordinate | null {
  const coordinates = feature.geometry?.coordinates;
  if (!Array.isArray(coordinates) || coordinates.length < 2) return null;
  const [longitude, latitude] = coordinates;
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

async function getFeatures(
  query: string,
  options: { limit: number; autocomplete: boolean },
): Promise<MapboxFeature[]> {
  const url = new URL("https://api.mapbox.com/search/geocode/v6/forward");
  url.searchParams.set("q", query.replaceAll(";", ","));
  url.searchParams.set("country", "BR");
  url.searchParams.set("language", "pt");
  url.searchParams.set("limit", String(options.limit));
  url.searchParams.set("autocomplete", String(options.autocomplete));
  // The app persists selected coordinates in deliveries, branches, and routes.
  url.searchParams.set("permanent", "true");
  url.searchParams.set("access_token", accessToken());

  let response: Response;
  try {
    response = await fetch(url, { signal: AbortSignal.timeout(15_000) });
  } catch {
    throw new MapboxApiError("Não foi possível consultar o Mapbox agora.");
  }

  if (!response.ok) {
    if (response.status === 401 || response.status === 403) {
      throw new MapboxApiError(
        "O token Mapbox não tem permissão para geocodificação permanente.",
        503,
      );
    }
    if (response.status === 429) {
      throw new MapboxApiError(
        "O limite de consultas do Mapbox foi atingido. Tente novamente em instantes.",
        503,
      );
    }
    throw new MapboxApiError("O Mapbox não conseguiu localizar o endereço.");
  }

  const payload = (await response.json()) as { features?: unknown[] };
  return (payload.features ?? []).flatMap((value) => {
    const feature = asRecord(value);
    if (!feature) return [];
    return [
      {
        geometry: asRecord(feature.geometry) as
          | { coordinates?: unknown }
          | undefined,
        properties: asRecord(feature.properties) ?? undefined,
      },
    ];
  });
}

export async function mapboxAutocomplete(
  query: string,
): Promise<MapboxAddressSuggestion[]> {
  const features = await getFeatures(query, {
    limit: 5,
    autocomplete: true,
  });

  return features.flatMap((feature) => {
    const properties = feature.properties;
    const coordinate = featureCoordinate(feature);
    if (!properties || !coordinate) return [];

    const context = asRecord(properties.context) ?? {};
    const addressContext = asRecord(context.address) ?? {};
    const region = asRecord(context.region) ?? {};
    const rawStateCode =
      (typeof region.region_code_full === "string" &&
      region.region_code_full.trim()
        ? region.region_code_full
        : typeof region.region_code === "string"
          ? region.region_code
          : null) ?? null;
    const stateCode = rawStateCode
      ? (rawStateCode.split("-").at(-1)?.toUpperCase() ?? null)
      : null;
    const featureName =
      typeof properties.name === "string" ? properties.name : null;
    const formatted =
      (typeof properties.full_address === "string" &&
      properties.full_address.trim()
        ? properties.full_address
        : typeof properties.place_formatted === "string"
          ? [featureName, properties.place_formatted].filter(Boolean).join(", ")
          : featureName) ?? null;
    if (!formatted) return [];

    const featureType =
      typeof properties.feature_type === "string"
        ? properties.feature_type
        : null;
    const street =
      (typeof addressContext.street_name === "string"
        ? addressContext.street_name
        : null) ??
      recordName(context.street) ??
      (featureType === "street" ? featureName : null);
    const houseNumber =
      (typeof addressContext.address_number === "string"
        ? addressContext.address_number
        : null) ??
      (typeof properties.address_number === "string"
        ? properties.address_number
        : null);

    return [{
      formatted,
      street,
      houseNumber,
      suburb: recordName(context.neighborhood) ?? recordName(context.locality),
      district: recordName(context.district),
      city:
        recordName(context.place) ??
        recordName(context.locality) ??
        recordName(context.district),
      stateCode,
      postcode: recordName(context.postcode),
      ...coordinate,
    }];
  });
}

export async function mapboxGeocodeAddress(
  query: string,
): Promise<Coordinate> {
  const [feature] = await getFeatures(query, { limit: 1, autocomplete: false });
  const coordinate = feature ? featureCoordinate(feature) : null;
  if (!coordinate) {
    throw new MapboxApiError(
      `Não foi possível localizar o endereço "${query}". Confira o endereço e tente novamente.`,
      422,
    );
  }
  return coordinate;
}

async function readJson(response: Response, service: string) {
  if (!response.ok) {
    if (response.status === 401 || response.status === 403) {
      throw new MapboxApiError(
        `O token Mapbox não tem permissão para ${service}.`,
        503,
      );
    }
    if (response.status === 429) {
      throw new MapboxApiError(
        "O limite de consultas do Mapbox foi atingido. Tente novamente em instantes.",
        503,
      );
    }
    throw new MapboxApiError(`O Mapbox não conseguiu ${service}.`);
  }
  return response.json() as Promise<Record<string, unknown>>;
}

export async function mapboxDirections(
  coordinates: Coordinate[],
): Promise<MapboxDirectionRoute> {
  const routeCoordinates = coordinates.filter(
    (coordinate, index) =>
      index === 0 ||
      coordinate.latitude !== coordinates[index - 1]?.latitude ||
      coordinate.longitude !== coordinates[index - 1]?.longitude,
  );
  if (routeCoordinates.length < 2 || routeCoordinates.length > 25) {
    throw new MapboxApiError(
      "A rota precisa conter entre 2 e 25 pontos.",
      422,
    );
  }

  const path = routeCoordinates
    .map(({ longitude, latitude }) => `${longitude},${latitude}`)
    .join(";");
  const url = new URL(
    `https://api.mapbox.com/directions/v5/mapbox/driving/${path}`,
  );
  url.searchParams.set("geometries", "geojson");
  url.searchParams.set("overview", "full");
  url.searchParams.set("steps", "false");
  url.searchParams.set("access_token", accessToken());

  let response: Response;
  try {
    response = await fetch(url, { signal: AbortSignal.timeout(20_000) });
  } catch {
    throw new MapboxApiError("Não foi possível calcular a rota no Mapbox.");
  }
  const payload = await readJson(response, "calcular a rota");
  const routes = Array.isArray(payload.routes) ? payload.routes : [];
  const route = asRecord(routes[0]);
  if (!route) {
    throw new MapboxApiError(
      "O Mapbox não encontrou uma rota viária para os endereços informados.",
      422,
    );
  }
  return route as MapboxDirectionRoute;
}

export async function mapboxOptimizeShipments(input: {
  locations: Array<{ name: string; coordinates: [number, number] }>;
  shipments: Array<{
    name: string;
    from: string;
    to: string;
    pickup_duration: number;
    dropoff_duration: number;
  }>;
}): Promise<MapboxOptimizationSolution> {
  const token = accessToken();
  const submitUrl = new URL("https://api.mapbox.com/optimized-trips/v2");
  submitUrl.searchParams.set("access_token", token);

  let submitResponse: Response;
  try {
    submitResponse = await fetch(submitUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        version: 1,
        locations: input.locations,
        vehicles: [{
          name: "courier",
          routing_profile: "mapbox/driving",
          start_location: "courier-start",
        }],
        shipments: input.shipments,
        options: { objectives: ["min-total-travel-duration"] },
      }),
      signal: AbortSignal.timeout(20_000),
    });
  } catch {
    throw new MapboxApiError(
      "Não foi possível enviar a rota para otimização no Mapbox.",
    );
  }

  const initialResult = (await readJson(
    submitResponse,
    "otimizar as entregas",
  )) as MapboxOptimizationSolution & { id?: string };
  if (submitResponse.status === 200) return initialResult;
  if (submitResponse.status !== 202 || !initialResult.id) {
    throw new MapboxApiError(
      "O Mapbox não aceitou a solicitação de otimização.",
    );
  }

  const resultUrl = new URL(
    `https://api.mapbox.com/optimized-trips/v2/${encodeURIComponent(initialResult.id)}`,
  );
  resultUrl.searchParams.set("access_token", token);
  const deadline = Date.now() + 30_000;

  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 750));
    const remainingMs = deadline - Date.now();
    if (remainingMs <= 0) break;

    let resultResponse: Response;
    try {
      resultResponse = await fetch(resultUrl, {
        signal: AbortSignal.timeout(Math.min(8_000, remainingMs)),
      });
    } catch {
      throw new MapboxApiError(
        "A otimização da rota foi enviada, mas o Mapbox não respondeu a tempo.",
        504,
      );
    }
    if (resultResponse.status === 202) continue;
    return (await readJson(
      resultResponse,
      "concluir a otimização da rota",
    )) as MapboxOptimizationSolution;
  }

  throw new MapboxApiError(
    "O Mapbox ainda está otimizando a rota. Tente aceitar novamente em instantes.",
    504,
  );
}
