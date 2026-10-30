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

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const map = L.map(container, {
      zoomControl: true,
      scrollWheelZoom: false,
    });
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a> contributors',
    }).addTo(map);
    const layers = L.layerGroup().addTo(map);
    mapRef.current = map;
    layerRef.current = layers;

    return () => {
      map.remove();
      mapRef.current = null;
      layerRef.current = null;
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    const layers = layerRef.current;
    if (!map || !layers) return;
    layers.clearLayers();

    const markerPoints = markers.map(({ latitude, longitude }) =>
      L.latLng(latitude, longitude),
    );
    const linePoints = (routeGeometry?.length ? routeGeometry : markers.filter((marker) => marker.kind === "stop"))
      .map(({ latitude, longitude }) => L.latLng(latitude, longitude));

    if (linePoints.length > 1) {
      L.polyline(linePoints, {
        color: "#b91c2c",
        opacity: 0.85,
        weight: 5,
        lineCap: "round",
        lineJoin: "round",
      }).addTo(layers);
    }

    markers.forEach((marker) => {
      const color =
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
      const leafletMarker = L.marker([marker.latitude, marker.longitude], {
        icon,
        draggable: Boolean(marker.draggable && marker.onDrag),
      }).bindPopup(popup);
      if (marker.draggable && marker.onDrag) {
        leafletMarker.on("dragend", () => {
          const point = leafletMarker.getLatLng();
          marker.onDrag?.({ latitude: point.lat, longitude: point.lng });
        });
      }
      leafletMarker.addTo(layers);
    });

    if (markerPoints.length) {
      const bounds = L.latLngBounds(markerPoints);
      if (linePoints.length) linePoints.forEach((point) => bounds.extend(point));
      if (bounds.getNorthEast().equals(bounds.getSouthWest())) {
        map.setView(bounds.getCenter(), 15);
      } else {
        map.fitBounds(bounds.pad(0.12), { maxZoom: 15 });
      }
    }
  }, [markers, routeGeometry]);

  return (
    <div
      ref={containerRef}
      className={
        size === "compact"
          ? "h-48 w-full bg-[#f3f2ef] sm:h-56"
          : "h-[280px] w-full bg-[#f3f2ef] sm:h-[340px]"
      }
      role="region"
      aria-label={ariaLabel}
      data-testid="map-live"
    />
  );
}
