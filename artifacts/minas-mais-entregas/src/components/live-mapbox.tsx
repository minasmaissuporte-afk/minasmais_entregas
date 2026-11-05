import { useEffect, useRef, useState } from "react";
import mapboxgl, {
  type GeoJSONSource,
  type Map as MapboxMap,
  type Marker,
} from "mapbox-gl";
import { Crosshair, LocateFixed } from "lucide-react";
import "mapbox-gl/dist/mapbox-gl.css";

export type MapCoordinate = {
  latitude: number;
  longitude: number;
};

export type MapSize = "default" | "compact" | "full-screen";

export type MapMarker = MapCoordinate & {
  id: string;
  title: string;
  detail: string;
  kind: "courier" | "stop" | "current" | "store";
  sequence?: number;
  label?: string;
  completed?: boolean;
  stale?: boolean;
  draggable?: boolean;
  onDrag?: (coordinate: MapCoordinate) => void;
};

type MarkerEntry = {
  marker: Marker;
  popup: mapboxgl.Popup;
  onDrag?: MapMarker["onDrag"];
};

const STYLE_URL = "mapbox://styles/mapbox/streets-v12";
const ROUTE_SOURCE_ID = "minas-mais-active-route";
const ROUTE_LAYER_ID = "minas-mais-active-route-line";
const INITIAL_CENTER: [number, number] = [-43.9386, -19.9191];

function logMapError(context: string, error: unknown, requestUrl?: string) {
  const details = error as {
    message?: unknown;
    status?: unknown;
    url?: unknown;
  } | null;
  const rawMessage =
    typeof details?.message === "string" ? details.message : "Erro Mapbox sem detalhes";
  const safeMessage = rawMessage.replace(
    /(access_token=)[^&\s]+/gi,
    "$1[redigido]",
  );
  const rawUrl =
    requestUrl ??
    (typeof details?.url === "string" ? details.url : undefined);
  const safeUrl = rawUrl
    ? rawUrl.replace(/([?&](?:access_token|token)=)[^&\s]+/gi, "$1[redigido]")
    : "URL não informada pelo Mapbox";
  console.error(`[Mapbox GL] ${context}: ${safeMessage}; URL: ${safeUrl}`, {
    status: typeof details?.status === "number" ? details.status : undefined,
  });
  return safeMessage;
}

function markerColor(marker: MapMarker) {
  if (marker.stale) return "#6b7280";
  if (marker.kind === "courier" || marker.kind === "current") return "#1769aa";
  if (marker.kind === "store") return "#16804a";
  if (marker.completed) return "#6b7280";
  return "#b91c2c";
}

function markerLabel(marker: MapMarker) {
  if (marker.label) return marker.label;
  if (marker.kind === "stop") return String(marker.sequence ?? "");
  if (marker.kind === "store") return "F";
  if (marker.kind === "courier" || marker.kind === "current") return "M";
  return "•";
}

function createMarkerElement(marker: MapMarker) {
  const element = document.createElement("span");
  element.setAttribute("aria-label", marker.title);
  element.setAttribute("role", "img");
  element.dataset.mapMarker = marker.id;
  Object.assign(element.style, {
    display: "grid",
    placeItems: "center",
    minWidth: `${marker.label ? 52 : 32}px`,
    height: "32px",
    padding: marker.label ? "0 8px" : "0",
    border: "3px solid #fff",
    borderRadius: "18px",
    background: markerColor(marker),
    color: "#fff",
    font: `700 ${marker.label ? 11 : 13}px/1 system-ui`,
    whiteSpace: "nowrap",
    boxShadow: "0 2px 8px #1115",
    cursor: marker.draggable ? "grab" : "pointer",
  });
  element.textContent = markerLabel(marker);
  return element;
}

function createPopupContent(marker: MapMarker) {
  const content = document.createElement("div");
  const title = document.createElement("strong");
  title.textContent = marker.title;
  content.append(title);
  if (marker.detail) {
    const detail = document.createElement("p");
    detail.textContent = marker.detail;
    detail.style.margin = "4px 0 0";
    content.append(detail);
  }
  return content;
}

function getLineCoordinates(
  markers: MapMarker[],
  routeGeometry?: MapCoordinate[] | null,
) {
  const route = routeGeometry?.length
    ? routeGeometry
    : markers
        .filter((marker) => marker.kind === "stop")
        .sort((a, b) => (a.sequence ?? 0) - (b.sequence ?? 0));
  return route.map(
    ({ latitude, longitude }) => [longitude, latitude] as [number, number],
  );
}

function getAllCoordinates(
  markers: MapMarker[],
  routeGeometry?: MapCoordinate[] | null,
) {
  return [
    ...markers.map(
      ({ latitude, longitude }) => [longitude, latitude] as [number, number],
    ),
    ...getLineCoordinates(markers, routeGeometry),
  ];
}

function fitMapToCoordinates(
  map: MapboxMap,
  coordinates: [number, number][],
  fitBehindBottomPanel = false,
  fitPadding?: { top?: number; right?: number; bottom?: number; left?: number },
) {
  if (!coordinates.length) return;
  if (coordinates.length === 1) {
    map.flyTo({ center: coordinates[0], zoom: 15, essential: true });
    return;
  }
  const bounds = new mapboxgl.LngLatBounds();
  coordinates.forEach((coordinate) => bounds.extend(coordinate));
  const bottomPadding = fitBehindBottomPanel
    ? Math.max(60, Math.round(map.getContainer().clientHeight * 0.32))
    : 60;
  map.fitBounds(bounds, {
    padding: fitPadding ?? {
      top: 60,
      right: 60,
      bottom: bottomPadding,
      left: 60,
    },
    maxZoom: 15,
    duration: 350,
  });
}

function syncRouteLayer(
  map: MapboxMap,
  markers: MapMarker[],
  routeGeometry?: MapCoordinate[] | null,
) {
  const coordinates = getLineCoordinates(markers, routeGeometry);
  const source = map.getSource(ROUTE_SOURCE_ID) as GeoJSONSource | undefined;

  if (coordinates.length < 2) {
    if (map.getLayer(ROUTE_LAYER_ID)) map.removeLayer(ROUTE_LAYER_ID);
    if (map.getSource(ROUTE_SOURCE_ID)) map.removeSource(ROUTE_SOURCE_ID);
    return coordinates;
  }

  const data = {
    type: "Feature",
    properties: {},
    geometry: { type: "LineString", coordinates },
  } as const;
  if (source) {
    source.setData(data);
  } else {
    map.addSource(ROUTE_SOURCE_ID, { type: "geojson", data });
  }
  if (!map.getLayer(ROUTE_LAYER_ID)) {
    const firstSymbolLayer = map
      .getStyle()
      .layers?.find((layer) => layer.type === "symbol")?.id;
    map.addLayer(
      {
        id: ROUTE_LAYER_ID,
        type: "line",
        source: ROUTE_SOURCE_ID,
        layout: {
          "line-cap": "round",
          "line-join": "round",
        },
        paint: {
          "line-color": "#b91c2c",
          "line-opacity": 0.88,
          "line-width": 5,
        },
      },
      firstSymbolLayer,
    );
  }
  return coordinates;
}

function syncMarkers(
  map: MapboxMap,
  markers: MapMarker[],
  markerEntries: Map<string, MarkerEntry>,
) {
  const markerIds = new Set(markers.map((marker) => marker.id));
  for (const [id, entry] of markerEntries) {
    if (!markerIds.has(id)) {
      entry.marker.remove();
      markerEntries.delete(id);
    }
  }

  for (const marker of markers) {
    const existing = markerEntries.get(marker.id);
    const element = existing?.marker.getElement() ?? createMarkerElement(marker);
    element.textContent = markerLabel(marker);
    element.setAttribute("aria-label", marker.title);
    element.style.background = markerColor(marker);
    element.style.minWidth = `${marker.label ? 52 : 32}px`;
    element.style.padding = marker.label ? "0 8px" : "0";
    element.style.font = `700 ${marker.label ? 11 : 13}px/1 system-ui`;
    element.style.cursor = marker.draggable ? "grab" : "pointer";

    const entry =
      existing ??
      {
        marker: new mapboxgl.Marker({
          element,
          anchor: "center",
          draggable: Boolean(marker.draggable && marker.onDrag),
        }),
        popup: new mapboxgl.Popup({ offset: 20, closeButton: true }),
      };
    entry.onDrag = marker.onDrag;
    entry.marker
      .setLngLat([marker.longitude, marker.latitude])
      .setDraggable(Boolean(marker.draggable && marker.onDrag));
    entry.popup.setDOMContent(createPopupContent(marker));
    if (!existing) {
      entry.marker.setPopup(entry.popup);
      entry.marker.on("dragend", () => {
        const position = entry.marker.getLngLat();
        entry.onDrag?.({
          latitude: position.lat,
          longitude: position.lng,
        });
      });
      entry.marker.addTo(map);
    }
    markerEntries.set(marker.id, entry);
  }
}

export default function LiveMapbox({
  markers,
  routeGeometry,
  ariaLabel,
  size = "default",
  showCenterControls = false,
  centerOnStoresOnly = false,
  showCenterOnMe = true,
  controlsAboveAttribution = false,
  fitBehindBottomPanel = false,
  controlsBottomOffset,
  controlsTopOffset,
  controlsRightOffset,
  compactCenterControls = false,
  fitPadding,
  resizeKey,
  autoFitOnGeometryChange = true,
  singleAttribution = false,
}: {
  markers: MapMarker[];
  routeGeometry?: MapCoordinate[] | null;
  ariaLabel: string;
  size?: MapSize;
  showCenterControls?: boolean;
  centerOnStoresOnly?: boolean;
  showCenterOnMe?: boolean;
  controlsAboveAttribution?: boolean;
  fitBehindBottomPanel?: boolean;
  controlsBottomOffset?: string | number;
  controlsTopOffset?: string | number;
  controlsRightOffset?: string | number;
  compactCenterControls?: boolean;
  fitPadding?: { top?: number; right?: number; bottom?: number; left?: number };
  resizeKey?: string | number;
  autoFitOnGeometryChange?: boolean;
  singleAttribution?: boolean;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<MapboxMap | null>(null);
  const markerEntriesRef = useRef(new Map<string, MarkerEntry>());
  const userLocationMarkerRef = useRef<Marker | null>(null);
  const syncMapDataRef = useRef<() => void>(() => {});
  const currentDataRef = useRef({ markers, routeGeometry });
  const fitPaddingRef = useRef(fitPadding);
  const fitBehindBottomPanelRef = useRef(fitBehindBottomPanel);
  const autoFitOnGeometryChangeRef = useRef(autoFitOnGeometryChange);
  fitPaddingRef.current = fitPadding;
  fitBehindBottomPanelRef.current = fitBehindBottomPanel;
  autoFitOnGeometryChangeRef.current = autoFitOnGeometryChange;
  const initialViewSetRef = useRef(false);
  const lastFitGeometryRef = useRef<string | null>(null);
  const [mapMessage, setMapMessage] = useState<string | null>(null);
  const [locationMessage, setLocationMessage] = useState<string | null>(null);
  const mapboxToken = import.meta.env.VITE_MAPBOX_PUBLIC_TOKEN?.trim() ?? "";
  currentDataRef.current = { markers, routeGeometry };

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    if (!mapboxToken) {
      setMapMessage("Token público do Mapbox ausente nesta compilação.");
      return;
    }

    let map: MapboxMap | null = null;
    try {
      mapboxgl.accessToken = mapboxToken;
      map = new mapboxgl.Map({
        container,
        style: STYLE_URL,
        center: INITIAL_CENTER,
        zoom: 12,
        language: "pt",
        attributionControl: !singleAttribution,
        logoPosition: "bottom-left",
        cooperativeGestures: true,
      });
      map.addControl(
        new mapboxgl.NavigationControl({ showCompass: false }),
        "top-right",
      );
      if (singleAttribution) {
        map.addControl(
          new mapboxgl.AttributionControl({ compact: true }),
          "bottom-right",
        );
      }
    } catch (error) {
      logMapError("Não foi possível iniciar o mapa.", error);
      map?.remove();
      setMapMessage("Não foi possível iniciar o mapa Mapbox.");
      return;
    }
    if (!map) return;

    mapRef.current = map;
    let resizeFrame = 0;

    const syncAfterStyleLoad = () => {
      const { markers: currentMarkers, routeGeometry: currentGeometry } =
        currentDataRef.current;
      try {
        const lineCoordinates = syncRouteLayer(map!, currentMarkers, currentGeometry);
        syncMarkers(map!, currentMarkers, markerEntriesRef.current);
        const markerCoordinates = currentMarkers.map(
          ({ longitude, latitude }) => [longitude, latitude] as [number, number],
        );
        const fitCoordinates = markerCoordinates.length
          ? [...markerCoordinates, ...lineCoordinates]
          : lineCoordinates;
        const geometryKey = currentGeometry?.length
          ? currentGeometry
              .map((point) => `${point.latitude.toFixed(6)},${point.longitude.toFixed(6)}`)
              .join(";")
          : "";
        const shouldFit =
          !initialViewSetRef.current ||
          (autoFitOnGeometryChangeRef.current &&
            geometryKey !== lastFitGeometryRef.current);
        if (fitCoordinates.length && shouldFit) {
          fitMapToCoordinates(
            map!,
            fitCoordinates,
            fitBehindBottomPanelRef.current,
            fitPaddingRef.current,
          );
          initialViewSetRef.current = true;
          lastFitGeometryRef.current = geometryKey;
        }
      } catch (error) {
        logMapError("Falha ao desenhar marcadores ou rota.", error);
        setMapMessage(
          "O mapa carregou, mas não foi possível desenhar a rota ou os marcadores.",
        );
      }
    };
    syncMapDataRef.current = syncAfterStyleLoad;

    const scheduleResize = () => {
      if (resizeFrame) window.cancelAnimationFrame(resizeFrame);
      resizeFrame = window.requestAnimationFrame(() => map!.resize());
    };
    const onStyleLoad = () => {
      setMapMessage(null);
      syncAfterStyleLoad();
      scheduleResize();
    };
    const onMapError = (event: { error: Error & { status?: number; url?: string } }) => {
      const error = event.error as Error & {
        status?: number;
        url?: string;
      };
      const safeMessage = logMapError(
        "Erro ao carregar mapa, estilo ou tiles",
        error,
        error.url,
      );
      setMapMessage(
        `Erro no Mapbox${error.status ? ` (${error.status})` : ""}: ${safeMessage}`,
      );
    };
    const onMapLoad = () => map!.resize();
    const resizeObserver =
      typeof ResizeObserver === "undefined"
        ? null
        : new ResizeObserver(scheduleResize);
    resizeObserver?.observe(container);

    map.on("style.load", onStyleLoad);
    map.on("error", onMapError);
    map.on("load", onMapLoad);
    window.addEventListener("resize", scheduleResize);
    scheduleResize();

    return () => {
      if (resizeFrame) window.cancelAnimationFrame(resizeFrame);
      resizeObserver?.disconnect();
      window.removeEventListener("resize", scheduleResize);
      map!.off("style.load", onStyleLoad);
      map!.off("error", onMapError);
      map!.off("load", onMapLoad);
      userLocationMarkerRef.current?.remove();
      map!.remove();
      mapRef.current = null;
      markerEntriesRef.current.clear();
      userLocationMarkerRef.current = null;
      syncMapDataRef.current = () => {};
      initialViewSetRef.current = false;
      lastFitGeometryRef.current = null;
    };
  }, [mapboxToken]);

  useEffect(() => {
    const map = mapRef.current;
    if (map?.isStyleLoaded()) syncMapDataRef.current();
  }, [markers, routeGeometry]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const frame = window.requestAnimationFrame(() => {
      map.resize();
      if (!initialViewSetRef.current && map.isStyleLoaded()) {
        syncMapDataRef.current();
      }
    });
    return () => window.cancelAnimationFrame(frame);
  }, [resizeKey]);

  const centerAll = () => {
    const map = mapRef.current;
    if (!map) return;
    const coordinates = centerOnStoresOnly
      ? currentDataRef.current.markers
          .filter((marker) => marker.kind === "store")
          .map((marker) => [marker.longitude, marker.latitude] as [number, number])
      : getAllCoordinates(
          currentDataRef.current.markers,
          currentDataRef.current.routeGeometry,
        );
    if (!coordinates.length) {
      setLocationMessage(
        centerOnStoresOnly
          ? "Não há filiais com coordenadas para centralizar."
          : "Não há posições ou paradas para centralizar.",
      );
      return;
    }
    setLocationMessage(null);
    fitMapToCoordinates(map, coordinates, fitBehindBottomPanel, fitPaddingRef.current);
  };

  const centerOnMe = () => {
    const map = mapRef.current;
    if (!map) return;
    if (!navigator.geolocation) {
      setLocationMessage("Este aparelho não disponibiliza localização pelo navegador.");
      return;
    }
    setLocationMessage("Buscando sua localização…");
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => {
        if (mapRef.current !== map) return;
        const center: [number, number] = [coords.longitude, coords.latitude];
        let element: HTMLSpanElement;
        if (userLocationMarkerRef.current) {
          userLocationMarkerRef.current.setLngLat(center);
        } else {
          element = document.createElement("span");
          element.setAttribute("aria-label", "Minha localização");
          element.setAttribute("role", "img");
          Object.assign(element.style, {
            display: "block",
            width: "20px",
            height: "20px",
            border: "3px solid #fff",
            borderRadius: "50%",
            background: "#1769aa",
            boxShadow: "0 1px 8px #1118",
          });
          userLocationMarkerRef.current = new mapboxgl.Marker({
            element,
            anchor: "center",
          })
            .setLngLat(center)
            .addTo(map);
        }
        map.flyTo({ center, zoom: 15, essential: true });
        setLocationMessage(null);
      },
      () => {
        setLocationMessage(
          "Não foi possível obter sua localização. Confira a permissão de GPS do navegador.",
        );
      },
      { enableHighAccuracy: true, timeout: 12_000, maximumAge: 15_000 },
    );
  };

  return (
    <div
      className="relative w-full overflow-hidden bg-[#f3f2ef]"
      role="region"
      aria-label={ariaLabel}
      data-testid="map-live"
    >
      <div
        ref={containerRef}
        className={`live-mapbox-frame live-mapbox-frame--${size}`}
      />
      {!mapboxToken && (
        <div
          className="pointer-events-none absolute inset-0 z-10 grid place-items-center bg-[#f3f2ef]/90 p-4 text-center text-sm text-muted-foreground"
          role="status"
        >
          {mapMessage ?? "Token público do Mapbox ausente nesta compilação."}
        </div>
      )}
      {mapboxToken && mapMessage && (
        <div
          className="absolute left-3 top-3 z-10 max-w-[min(90%,28rem)] rounded-lg border border-amber-200 bg-white/95 px-3 py-2 text-xs text-amber-950 shadow-sm"
          role="status"
          data-testid="map-status-message"
        >
          {mapMessage}
        </div>
      )}
      {showCenterControls && (
        <div
          className="absolute z-10 flex max-w-[calc(100%-1.5rem)] flex-col items-end gap-2"
          style={{
            ...(controlsTopOffset != null
              ? { top: controlsTopOffset }
              : {
                  bottom:
                    controlsBottomOffset ??
                    (controlsAboveAttribution ? 40 : 12),
                }),
            right: controlsRightOffset ?? 12,
          }}
        >
          <div className={compactCenterControls ? "flex flex-col gap-2" : "flex flex-wrap justify-end gap-2"}>
            <button
              className={compactCenterControls
                ? "grid h-12 w-12 place-items-center rounded-xl border border-border bg-white text-foreground shadow-md hover:bg-muted"
                : "rounded-lg border border-border bg-white px-3 py-2 text-xs font-semibold text-foreground shadow-md hover:bg-muted"}
              type="button"
              onClick={centerAll}
              data-testid="button-map-center-all"
              aria-label={centerOnStoresOnly ? "Centralizar filiais" : "Centralizar todos"}
              title={centerOnStoresOnly ? "Centralizar filiais" : "Centralizar todos"}
            >
              {compactCenterControls ? <Crosshair size={18} /> : (centerOnStoresOnly ? "Centralizar filiais" : "Centralizar todos")}
            </button>
            {showCenterOnMe && (
              <button
                className={compactCenterControls
                  ? "grid h-12 w-12 place-items-center rounded-xl border border-border bg-white text-foreground shadow-md hover:bg-muted"
                  : "rounded-lg border border-border bg-white px-3 py-2 text-xs font-semibold text-foreground shadow-md hover:bg-muted"}
                type="button"
                onClick={centerOnMe}
                data-testid="button-map-center-me"
                aria-label="Centralizar em mim"
                title="Centralizar em mim"
              >
                {compactCenterControls ? <LocateFixed size={18} /> : "Centralizar em mim"}
              </button>
            )}
          </div>
          {locationMessage && (
            <p
              className="max-w-64 rounded-lg bg-white/95 px-3 py-2 text-right text-xs text-muted-foreground shadow-md"
              role="status"
              data-testid="map-location-status"
            >
              {locationMessage}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
