import { useEffect, useRef, useState } from "react";
import { importLibrary, setOptions } from "@googlemaps/js-api-loader";
import { Crosshair, LocateFixed } from "lucide-react";

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
  /** Optional colors for screens with their own legend (e.g. the admin overview). */
  color?: string;
  textColor?: string;
  draggable?: boolean;
  onDrag?: (coordinate: MapCoordinate) => void;
};

type MarkerEntry = {
  marker: google.maps.marker.AdvancedMarkerElement;
  element: HTMLSpanElement;
  infoWindow: google.maps.InfoWindow;
  onDrag?: MapMarker["onDrag"];
};

type Libraries = {
  maps: google.maps.MapsLibrary;
  marker: google.maps.MarkerLibrary;
  core: google.maps.CoreLibrary;
};

const INITIAL_CENTER = { lat: -19.9191, lng: -43.9386 };
const MAX_FIT_ZOOM = 15;
// Marcadores HTML (AdvancedMarkerElement) exigem um Map ID; "DEMO_MAP_ID" serve para desenvolvimento.
const DEFAULT_MAP_ID = "DEMO_MAP_ID";

// ---------------------------------------------------------------------------
// Carregamento único da Maps JavaScript API
// ---------------------------------------------------------------------------

let librariesPromise: Promise<Libraries> | null = null;
const authFailureListeners = new Set<() => void>();

function loadLibraries(apiKey: string): Promise<Libraries> {
  if (!librariesPromise) {
    // Chamado pelo Google quando a chave é inválida ou não autoriza este domínio.
    (window as unknown as { gm_authFailure?: () => void }).gm_authFailure = () => {
      authFailureListeners.forEach((listener) => listener());
    };
    setOptions({ key: apiKey, v: "weekly", language: "pt-BR", region: "BR" });
    librariesPromise = Promise.all([
      importLibrary("maps"),
      importLibrary("marker"),
      importLibrary("core"),
    ])
      .then(([maps, marker, core]) => ({ maps, marker, core }))
      .catch((error: unknown) => {
        librariesPromise = null;
        throw error;
      });
  }
  return librariesPromise;
}

function toLatLng({ latitude, longitude }: MapCoordinate): google.maps.LatLngLiteral {
  return { lat: latitude, lng: longitude };
}

function logMapError(context: string, error: unknown) {
  const message =
    error instanceof Error && error.message ? error.message : "Erro do Google Maps sem detalhes";
  const safeMessage = message.replace(/([?&]key=)[^&\s]+/gi, "$1[redigido]");
  console.error(`[Google Maps] ${context}: ${safeMessage}`);
  return safeMessage;
}

// ---------------------------------------------------------------------------
// Aparência dos marcadores (cores e rótulos usados em todo o app)
// ---------------------------------------------------------------------------

function markerColor(marker: MapMarker) {
  if (marker.color) return marker.color;
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

function styleMarkerElement(element: HTMLSpanElement, marker: MapMarker) {
  element.setAttribute("aria-label", marker.title);
  element.setAttribute("role", "img");
  element.dataset.mapMarker = marker.id;
  element.textContent = markerLabel(marker);
  Object.assign(element.style, {
    display: "grid",
    placeItems: "center",
    minWidth: `${marker.label ? 52 : 32}px`,
    height: "32px",
    padding: marker.label ? "0 8px" : "0",
    border: "3px solid #fff",
    borderRadius: "18px",
    background: markerColor(marker),
    color: marker.textColor ?? "#fff",
    font: `700 ${marker.label ? 11 : 13}px/1 system-ui`,
    whiteSpace: "nowrap",
    boxShadow: "0 2px 8px #1115",
    cursor: marker.draggable ? "grab" : "pointer",
    // O Google ancora o marcador pela base; desloca para ficar centralizado no ponto.
    transform: "translateY(50%)",
  });
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

// ---------------------------------------------------------------------------
// Sincronização de rota, marcadores e enquadramento
// ---------------------------------------------------------------------------

function getLineCoordinates(markers: MapMarker[], routeGeometry?: MapCoordinate[] | null) {
  const route = routeGeometry?.length
    ? routeGeometry
    : markers
        .filter((marker) => marker.kind === "stop")
        .sort((a, b) => (a.sequence ?? 0) - (b.sequence ?? 0));
  return route.map(toLatLng);
}

function getAllCoordinates(markers: MapMarker[], routeGeometry?: MapCoordinate[] | null) {
  return [...markers.map(toLatLng), ...getLineCoordinates(markers, routeGeometry)];
}

function fitMapToCoordinates(
  map: google.maps.Map,
  libraries: Libraries,
  coordinates: google.maps.LatLngLiteral[],
  fitBehindBottomPanel = false,
  fitPadding?: { top?: number; right?: number; bottom?: number; left?: number },
) {
  if (!coordinates.length) return;
  if (coordinates.length === 1) {
    map.panTo(coordinates[0]!);
    map.setZoom(MAX_FIT_ZOOM);
    return;
  }
  const bounds = new libraries.core.LatLngBounds();
  coordinates.forEach((coordinate) => bounds.extend(coordinate));
  const bottomPadding = fitBehindBottomPanel
    ? Math.max(60, Math.round(map.getDiv().clientHeight * 0.32))
    : 60;
  const padding = {
    top: fitPadding?.top ?? 60,
    right: fitPadding?.right ?? 60,
    bottom: fitPadding?.bottom ?? (fitPadding ? 60 : bottomPadding),
    left: fitPadding?.left ?? 60,
  };
  map.fitBounds(bounds, padding);
  // fitBounds não tem limite de zoom: evita aproximar demais quando os pontos estão próximos.
  libraries.core.event.addListenerOnce(map, "idle", () => {
    const zoom = map.getZoom();
    if (zoom !== undefined && zoom > MAX_FIT_ZOOM) map.setZoom(MAX_FIT_ZOOM);
  });
}

function syncRouteLine(
  map: google.maps.Map,
  libraries: Libraries,
  routeLineRef: { current: google.maps.Polyline | null },
  markers: MapMarker[],
  routeGeometry?: MapCoordinate[] | null,
  routeColor = "#b91c2c",
) {
  const path = getLineCoordinates(markers, routeGeometry);
  if (path.length < 2) {
    routeLineRef.current?.setMap(null);
    routeLineRef.current = null;
    return path;
  }
  const options: google.maps.PolylineOptions = {
    path,
    map,
    strokeColor: routeColor,
    strokeOpacity: routeColor === "#E20210" ? 1 : 0.88,
    strokeWeight: 5,
    clickable: false,
    zIndex: 1,
  };
  if (routeLineRef.current) {
    routeLineRef.current.setOptions(options);
  } else {
    routeLineRef.current = new libraries.maps.Polyline(options);
  }
  return path;
}

function syncMarkers(
  map: google.maps.Map,
  libraries: Libraries,
  markers: MapMarker[],
  markerEntries: Map<string, MarkerEntry>,
) {
  const markerIds = new Set(markers.map((marker) => marker.id));
  for (const [id, entry] of markerEntries) {
    if (!markerIds.has(id)) {
      entry.infoWindow.close();
      entry.marker.map = null;
      markerEntries.delete(id);
    }
  }

  for (const marker of markers) {
    const draggable = Boolean(marker.draggable && marker.onDrag);
    const existing = markerEntries.get(marker.id);
    if (existing) {
      styleMarkerElement(existing.element, marker);
      existing.marker.position = toLatLng(marker);
      existing.marker.title = marker.title;
      existing.marker.gmpDraggable = draggable;
      existing.infoWindow.setContent(createPopupContent(marker));
      existing.onDrag = marker.onDrag;
      continue;
    }

    const element = document.createElement("span");
    styleMarkerElement(element, marker);
    const infoWindow = new libraries.maps.InfoWindow({
      content: createPopupContent(marker),
      pixelOffset: new libraries.core.Size(0, -4),
    });
    const advancedMarker = new libraries.marker.AdvancedMarkerElement({
      map,
      position: toLatLng(marker),
      content: element,
      title: marker.title,
      gmpDraggable: draggable,
      zIndex: 2,
    });
    const entry: MarkerEntry = {
      marker: advancedMarker,
      element,
      infoWindow,
      onDrag: marker.onDrag,
    };
    advancedMarker.addListener("click", () => {
      infoWindow.open({ map, anchor: advancedMarker });
    });
    advancedMarker.addListener("dragend", () => {
      const position = advancedMarker.position;
      if (!position) return;
      const latitude =
        typeof position.lat === "function" ? position.lat() : position.lat;
      const longitude =
        typeof position.lng === "function" ? position.lng() : position.lng;
      entry.onDrag?.({ latitude, longitude });
    });
    markerEntries.set(marker.id, entry);
  }
}

// ---------------------------------------------------------------------------
// Componente
// ---------------------------------------------------------------------------

export default function LiveGoogleMap({
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
  // Mantido por compatibilidade: o Google exibe sempre uma única atribuição.
  singleAttribution: _singleAttribution = false,
  interactive = true,
  routeColor,
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
  interactive?: boolean;
  routeColor?: string;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<google.maps.Map | null>(null);
  const librariesRef = useRef<Libraries | null>(null);
  const markerEntriesRef = useRef(new Map<string, MarkerEntry>());
  const routeLineRef = useRef<google.maps.Polyline | null>(null);
  const userLocationMarkerRef = useRef<google.maps.marker.AdvancedMarkerElement | null>(null);
  const syncMapDataRef = useRef<() => void>(() => {});
  const currentDataRef = useRef({ markers, routeGeometry });
  const fitPaddingRef = useRef(fitPadding);
  const fitBehindBottomPanelRef = useRef(fitBehindBottomPanel);
  const autoFitOnGeometryChangeRef = useRef(autoFitOnGeometryChange);
  const routeColorRef = useRef(routeColor);
  fitPaddingRef.current = fitPadding;
  fitBehindBottomPanelRef.current = fitBehindBottomPanel;
  autoFitOnGeometryChangeRef.current = autoFitOnGeometryChange;
  routeColorRef.current = routeColor;
  const initialViewSetRef = useRef(false);
  const lastFitGeometryRef = useRef<string | null>(null);
  const [mapMessage, setMapMessage] = useState<string | null>(null);
  const [locationMessage, setLocationMessage] = useState<string | null>(null);
  const apiKey = import.meta.env.VITE_GOOGLE_MAPS_API_KEY?.trim() ?? "";
  const mapId = import.meta.env.VITE_GOOGLE_MAPS_MAP_ID?.trim() || DEFAULT_MAP_ID;
  currentDataRef.current = { markers, routeGeometry };

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    if (!apiKey) {
      setMapMessage("Chave do Google Maps ausente nesta compilação.");
      return;
    }

    let cancelled = false;
    const markerEntries = markerEntriesRef.current;
    const onAuthFailure = () => {
      setMapMessage(
        "O Google Maps recusou a chave. Confira se a Maps JavaScript API está ativada e se este domínio está autorizado.",
      );
    };
    authFailureListeners.add(onAuthFailure);

    loadLibraries(apiKey)
      .then((libraries) => {
        if (cancelled) return;
        const map = new libraries.maps.Map(container, {
          center: INITIAL_CENTER,
          zoom: 12,
          mapId,
          disableDefaultUI: true,
          zoomControl: interactive,
          zoomControlOptions: { position: libraries.core.ControlPosition.RIGHT_TOP },
          clickableIcons: false,
          keyboardShortcuts: interactive,
          gestureHandling: interactive ? "cooperative" : "none",
        });
        mapRef.current = map;
        librariesRef.current = libraries;

        syncMapDataRef.current = () => {
          const { markers: currentMarkers, routeGeometry: currentGeometry } =
            currentDataRef.current;
          try {
            const lineCoordinates = syncRouteLine(
              map,
              libraries,
              routeLineRef,
              currentMarkers,
              currentGeometry,
              routeColorRef.current,
            );
            syncMarkers(map, libraries, currentMarkers, markerEntries);
            const markerCoordinates = currentMarkers.map(toLatLng);
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
                map,
                libraries,
                fitCoordinates,
                fitBehindBottomPanelRef.current,
                fitPaddingRef.current,
              );
              initialViewSetRef.current = true;
              lastFitGeometryRef.current = geometryKey;
            }
          } catch (error) {
            logMapError("Falha ao desenhar marcadores ou rota", error);
            setMapMessage(
              "O mapa carregou, mas não foi possível desenhar a rota ou os marcadores.",
            );
          }
        };
        setMapMessage(null);
        syncMapDataRef.current();
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        const safeMessage = logMapError("Não foi possível carregar o mapa", error);
        setMapMessage(`Não foi possível carregar o Google Maps: ${safeMessage}`);
      });

    return () => {
      cancelled = true;
      authFailureListeners.delete(onAuthFailure);
      for (const entry of markerEntries.values()) {
        entry.infoWindow.close();
        entry.marker.map = null;
      }
      markerEntries.clear();
      routeLineRef.current?.setMap(null);
      routeLineRef.current = null;
      if (userLocationMarkerRef.current) userLocationMarkerRef.current.map = null;
      userLocationMarkerRef.current = null;
      if (mapRef.current && librariesRef.current) {
        librariesRef.current.core.event.clearInstanceListeners(mapRef.current);
      }
      mapRef.current = null;
      syncMapDataRef.current = () => {};
      initialViewSetRef.current = false;
      lastFitGeometryRef.current = null;
    };
  }, [apiKey, mapId, interactive]);

  useEffect(() => {
    if (mapRef.current) syncMapDataRef.current();
  }, [markers, routeGeometry]);

  useEffect(() => {
    // O Google redimensiona o mapa sozinho; aqui só garantimos o primeiro enquadramento
    // quando o mapa estava escondido (ex.: aba ou painel recém-aberto).
    const frame = window.requestAnimationFrame(() => {
      if (mapRef.current && !initialViewSetRef.current) syncMapDataRef.current();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [resizeKey]);

  const centerAll = () => {
    const map = mapRef.current;
    const libraries = librariesRef.current;
    if (!map || !libraries) return;
    const coordinates = centerOnStoresOnly
      ? currentDataRef.current.markers
          .filter((marker) => marker.kind === "store")
          .map(toLatLng)
      : getAllCoordinates(currentDataRef.current.markers, currentDataRef.current.routeGeometry);
    if (!coordinates.length) {
      setLocationMessage(
        centerOnStoresOnly
          ? "Não há filiais com coordenadas para centralizar."
          : "Não há posições ou paradas para centralizar.",
      );
      return;
    }
    setLocationMessage(null);
    fitMapToCoordinates(map, libraries, coordinates, fitBehindBottomPanel, fitPaddingRef.current);
  };

  const centerOnMe = () => {
    const map = mapRef.current;
    const libraries = librariesRef.current;
    if (!map || !libraries) return;
    if (!navigator.geolocation) {
      setLocationMessage("Este aparelho não disponibiliza localização pelo navegador.");
      return;
    }
    setLocationMessage("Buscando sua localização…");
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => {
        if (mapRef.current !== map) return;
        const center = { lat: coords.latitude, lng: coords.longitude };
        if (userLocationMarkerRef.current) {
          userLocationMarkerRef.current.position = center;
        } else {
          const element = document.createElement("span");
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
            transform: "translateY(50%)",
          });
          userLocationMarkerRef.current = new libraries.marker.AdvancedMarkerElement({
            map,
            position: center,
            content: element,
            title: "Minha localização",
            zIndex: 3,
          });
        }
        map.panTo(center);
        map.setZoom(MAX_FIT_ZOOM);
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
      <div ref={containerRef} className={`live-map-frame live-map-frame--${size}`} />
      {!apiKey && (
        <div
          className="pointer-events-none absolute inset-0 z-10 grid place-items-center bg-[#f3f2ef]/90 p-4 text-center text-sm text-muted-foreground"
          role="status"
        >
          {mapMessage ?? "Chave do Google Maps ausente nesta compilação."}
        </div>
      )}
      {apiKey && mapMessage && (
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
                  bottom: controlsBottomOffset ?? (controlsAboveAttribution ? 40 : 12),
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
