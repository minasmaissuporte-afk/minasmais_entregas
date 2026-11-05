import { lazy, Suspense } from "react";
import type { MapCoordinate, MapMarker, MapSize } from "./live-mapbox";
import "./live-map-frame.css";

export type { MapCoordinate, MapMarker, MapSize } from "./live-mapbox";

const MapboxMap = lazy(() => import("./live-mapbox"));

export default function LiveMap({
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
  return (
    <Suspense
      fallback={
        <div
          className={`live-mapbox-frame live-mapbox-frame--${size} bg-[#f3f2ef]`}
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
        centerOnStoresOnly={centerOnStoresOnly}
        showCenterOnMe={showCenterOnMe}
        controlsAboveAttribution={controlsAboveAttribution}
        fitBehindBottomPanel={fitBehindBottomPanel}
        controlsBottomOffset={controlsBottomOffset}
        controlsTopOffset={controlsTopOffset}
        controlsRightOffset={controlsRightOffset}
        compactCenterControls={compactCenterControls}
        fitPadding={fitPadding}
        resizeKey={resizeKey}
        autoFitOnGeometryChange={autoFitOnGeometryChange}
        singleAttribution={singleAttribution}
      />
    </Suspense>
  );
}
