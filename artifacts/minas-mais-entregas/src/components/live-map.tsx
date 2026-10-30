import { lazy, Suspense } from "react";
import type { MapCoordinate, MapMarker } from "./live-mapbox";

export type { MapCoordinate, MapMarker } from "./live-mapbox";

const MapboxMap = lazy(() => import("./live-mapbox"));

export default function LiveMap({
  markers,
  routeGeometry,
  ariaLabel,
  size = "default",
  showCenterControls = false,
}: {
  markers: MapMarker[];
  routeGeometry?: MapCoordinate[] | null;
  ariaLabel: string;
  size?: "default" | "compact";
  showCenterControls?: boolean;
}) {
  return (
    <Suspense
      fallback={
        <div
          className={`w-full bg-[#f3f2ef] ${
            size === "compact" ? "h-48 sm:h-56" : "h-[400px] sm:h-[460px]"
          }`}
          role="region"
          aria-label={ariaLabel}
          aria-busy="true"
          data-testid="map-live"
        />
      }
    >
      <MapboxMap
        markers={markers}
        routeGeometry={routeGeometry}
        ariaLabel={ariaLabel}
        size={size}
        showCenterControls={showCenterControls}
      />
    </Suspense>
  );
}
