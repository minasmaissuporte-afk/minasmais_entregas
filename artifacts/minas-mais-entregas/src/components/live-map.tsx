import { useEffect, useRef } from "react";
import * as L from "leaflet";
import "leaflet/dist/leaflet.css";

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
  completed?: boolean;
  stale?: boolean;
  draggable?: boolean;
  onDrag?: (coordinate: MapCoordinate) => void;
};

export default function LiveMap({
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
  const mapRef = useRef<L.Map | null>(null);
  const layerRef = useRef<L.LayerGroup | null>(null);
  const markersRef = useRef(new Map<string, L.Marker>());
  const routeLineRef = useRef<L.Polyline | null>(null);
  const initialViewSetRef = useRef(false);
  const courierViewSetRef = useRef(false);
  const mapboxToken = import.meta.env.VITE_MAPBOX_PUBLIC_TOKEN?.trim() ?? "";

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const map = L.map(container, {
      zoomControl: true,
      scrollWheelZoom: false,
    });
    if (mapboxToken) {
      L.tileLayer(
        `https://api.mapbox.com/styles/v1/mapbox/streets-v12/tiles/256/{z}/{x}/{y}?access_token=${encodeURIComponent(mapboxToken)}`,
        {
          maxZoom: 19,
          attribution:
            '&copy; <a href="https://www.mapbox.com/about/maps/" target="_blank" rel="noreferrer">Mapbox</a> &copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a> contributors',
        },
      ).addTo(map);
    }
    const layers = L.layerGroup().addTo(map);
    mapRef.current = map;
    layerRef.current = layers;

    return () => {
      map.remove();
      mapRef.current = null;
      layerRef.current = null;
      markersRef.current.clear();
      routeLineRef.current = null;
      initialViewSetRef.current = false;
      courierViewSetRef.current = false;
    };
  }, [mapboxToken]);

  useEffect(() => {
    const map = mapRef.current;
    const layers = layerRef.current;
    if (!map || !layers) return;

    const markerIds = new Set(markers.map((marker) => marker.id));
    for (const [id, marker] of markersRef.current) {
      if (!markerIds.has(id)) {
        marker.remove();
        markersRef.current.delete(id);
      }
    }

    const markerPoints = markers.map(({ latitude, longitude }) => L.latLng(latitude, longitude));
    const linePoints = (routeGeometry?.length ? routeGeometry : markers.filter((marker) => marker.kind === "stop"))
      .map(({ latitude, longitude }) => L.latLng(latitude, longitude));

    if (linePoints.length > 1) {
      if (routeLineRef.current) routeLineRef.current.setLatLngs(linePoints);
      else {
        routeLineRef.current = L.polyline(linePoints, {
          color: "#b91c2c",
          opacity: 0.85,
          weight: 5,
          lineCap: "round",
          lineJoin: "round",
        }).addTo(layers);
      }
    } else if (routeLineRef.current) {
      routeLineRef.current.remove();
      routeLineRef.current = null;
    }

    markers.forEach((marker) => {
      const color = marker.stale
        ? "#6b7280"
        :
        marker.kind === "courier" || marker.kind === "current"
          ? "#1769aa"
          : marker.kind === "store"
            ? "#16804a"
          : marker.completed
            ? "#6b7280"
            : "#b91c2c";
      const label =
        marker.kind === "stop"
          ? String(marker.sequence ?? "")
          : marker.kind === "current"
            ? "M"
            : marker.kind === "store"
              ? "F"
              : marker.kind === "courier"
                ? "M"
                : "•";
      const icon = L.divIcon({
        className: "",
        html: `<span style="display:grid;place-items:center;width:32px;height:32px;border:3px solid #fff;border-radius:50%;background:${color};color:#fff;font:700 13px/1 system-ui;box-shadow:0 2px 8px #1115">${label}</span>`,
        iconSize: [32, 32],
        iconAnchor: [16, 16],
      });
      const popup = document.createElement("div");
      const title = document.createElement("strong");
      title.textContent = marker.title;
      popup.append(title);
      if (marker.detail) {
        const detail = document.createElement("p");
        detail.textContent = marker.detail;
        detail.style.margin = "4px 0 0";
        popup.append(detail);
      }
      const existingMarker = markersRef.current.get(marker.id);
      const leafletMarker = existingMarker ?? L.marker([marker.latitude, marker.longitude], {
        icon,
        draggable: Boolean(marker.draggable && marker.onDrag),
      }).addTo(layers);
      leafletMarker.setLatLng([marker.latitude, marker.longitude]);
      leafletMarker.setIcon(icon);
      if (existingMarker) leafletMarker.setPopupContent(popup);
      else leafletMarker.bindPopup(popup);
      leafletMarker.options.draggable = Boolean(marker.draggable && marker.onDrag);
      if (leafletMarker.dragging) {
        if (marker.draggable && marker.onDrag) leafletMarker.dragging.enable();
        else leafletMarker.dragging.disable();
      }
      leafletMarker.off("dragend");
      if (marker.draggable && marker.onDrag) {
        leafletMarker.on("dragend", () => {
          const point = leafletMarker.getLatLng();
          marker.onDrag?.({ latitude: point.lat, longitude: point.lng });
        });
      }
      markersRef.current.set(marker.id, leafletMarker);
    });

    const hasCourierMarker = markers.some(
      (marker) => marker.kind === "courier" || marker.kind === "current",
    );
    if (
      markerPoints.length &&
      (!initialViewSetRef.current || (hasCourierMarker && !courierViewSetRef.current))
    ) {
      const bounds = L.latLngBounds(markerPoints);
      if (linePoints.length) linePoints.forEach((point) => bounds.extend(point));
      if (bounds.getNorthEast().equals(bounds.getSouthWest())) {
        map.setView(bounds.getCenter(), 15);
      } else {
        map.fitBounds(bounds.pad(0.12), { maxZoom: 15 });
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
