import { useEffect, useRef } from "react";
import mapboxgl, {
  type GeoJSONSource,
  type Map as MapboxMap,
  type Marker,
} from "mapbox-gl";
import MapboxLanguage from "@mapbox/mapbox-gl-language";
import "mapbox-gl/dist/mapbox-gl.css";

export type MapCoordinate = {
  latitude: number;
  longitude: number;
};

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

const STYLE_URL = "mapbox://styles/caiosuportemhl/cmvvbmxjy003601qs0z004xq0";
const ROUTE_SOURCE_ID = "minas-mais-active-route";
const ROUTE_LAYER_ID = "minas-mais-active-route-line";
const INITIAL_CENTER: [number, number] = [-43.9386, -19.9191];

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
          "line-width": ["interpolate", ["linear"], ["zoom"], 8, 3, 15, 6],
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
}: {
  markers: MapMarker[];
  routeGeometry?: MapCoordinate[] | null;
  ariaLabel: string;
  size?: "default" | "compact";
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<MapboxMap | null>(null);
  const markerEntriesRef = useRef(new Map<string, MarkerEntry>());
  const currentDataRef = useRef({ markers, routeGeometry });
  const initialViewSetRef = useRef(false);
  const courierViewSetRef = useRef(false);
  const mapboxToken = import.meta.env.VITE_MAPBOX_PUBLIC_TOKEN?.trim() ?? "";
  currentDataRef.current = { markers, routeGeometry };

  useEffect(() => {
    const container = containerRef.current;
    if (!container || !mapboxToken) return;

    mapboxgl.accessToken = mapboxToken;
    const map = new mapboxgl.Map({
      container,
      style: STYLE_URL,
      center: INITIAL_CENTER,
      zoom: 12,
      attributionControl: true,
      cooperativeGestures: true,
    });
    map.addControl(new mapboxgl.NavigationControl({ showCompass: false }), "top-right");
    map.addControl(new MapboxLanguage({ defaultLanguage: "pt" }));
    mapRef.current = map;

    const syncAfterStyleLoad = () => {
      const { markers: currentMarkers, routeGeometry: currentGeometry } =
        currentDataRef.current;
      const lineCoordinates = syncRouteLayer(map, currentMarkers, currentGeometry);
      syncMarkers(map, currentMarkers, markerEntriesRef.current);
      const markerCoordinates = currentMarkers.map(
        ({ longitude, latitude }) => [longitude, latitude] as [number, number],
      );
      const fitCoordinates = markerCoordinates.length
        ? [...markerCoordinates, ...lineCoordinates]
        : lineCoordinates;
      const hasCourierMarker = currentMarkers.some(
        (marker) => marker.kind === "courier" || marker.kind === "current",
      );
      if (
        fitCoordinates.length &&
        (!initialViewSetRef.current ||
          (hasCourierMarker && !courierViewSetRef.current))
      ) {
        const bounds = new mapboxgl.LngLatBounds();
        fitCoordinates.forEach((coordinate) => bounds.extend(coordinate));
        const northEast = bounds.getNorthEast();
        const southWest = bounds.getSouthWest();
        if (northEast.lng === southWest.lng && northEast.lat === southWest.lat) {
          map.setCenter(bounds.getCenter());
          map.setZoom(15);
        } else {
          map.fitBounds(bounds, { padding: 36, maxZoom: 15, duration: 0 });
        }
        initialViewSetRef.current = true;
        if (hasCourierMarker) courierViewSetRef.current = true;
      }
    };
    map.on("style.load", syncAfterStyleLoad);

    return () => {
      map.off("style.load", syncAfterStyleLoad);
      map.remove();
      mapRef.current = null;
      markerEntriesRef.current.clear();
      initialViewSetRef.current = false;
      courierViewSetRef.current = false;
    };
  }, [mapboxToken]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !map.isStyleLoaded()) return;
    const lineCoordinates = syncRouteLayer(map, markers, routeGeometry);
    syncMarkers(map, markers, markerEntriesRef.current);

    const markerCoordinates = markers.map(
      ({ longitude, latitude }) => [longitude, latitude] as [number, number],
    );
    const fitCoordinates = markerCoordinates.length
      ? [...markerCoordinates, ...lineCoordinates]
      : lineCoordinates;
    const hasCourierMarker = markers.some(
      (marker) => marker.kind === "courier" || marker.kind === "current",
    );
    if (
      fitCoordinates.length &&
      (!initialViewSetRef.current ||
        (hasCourierMarker && !courierViewSetRef.current))
    ) {
      const bounds = new mapboxgl.LngLatBounds();
      fitCoordinates.forEach((coordinate) => bounds.extend(coordinate));
      const northEast = bounds.getNorthEast();
      const southWest = bounds.getSouthWest();
      if (northEast.lng === southWest.lng && northEast.lat === southWest.lat) {
        map.setCenter(bounds.getCenter());
        map.setZoom(15);
      } else {
        map.fitBounds(bounds, { padding: 36, maxZoom: 15, duration: 0 });
      }
      initialViewSetRef.current = true;
      if (hasCourierMarker) courierViewSetRef.current = true;
    }
  }, [markers, routeGeometry]);

  return (
    <div
      className={`relative w-full overflow-hidden bg-[#f3f2ef] ${
        size === "compact" ? "h-48 sm:h-56" : "h-[280px] sm:h-[340px]"
      }`}
      role="region"
      aria-label={ariaLabel}
      data-testid="map-live"
    >
      <div ref={containerRef} className="absolute inset-0" />
      {!mapboxToken && (
        <div className="pointer-events-none absolute inset-0 z-[500] grid place-items-center bg-[#f3f2ef]/90 p-4 text-center text-sm text-muted-foreground">
          O mapa Mapbox ainda não está configurado.
        </div>
      )}
    </div>
  );
}
