import { lazy, Suspense } from "react";
import type { MapCoordinate, MapMarker, MapSize } from "./live-googlemap";
import "./live-map-frame.css";

export type { MapCoordinate, MapMarker, MapSize } from "./live-googlemap";

const GoogleMap = lazy(() => import("./live-googlemap"));

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
  return (
    <Suspense
      fallback={
        <div
          className={`live-map-frame live-map-frame--${size} bg-[#f3f2ef]`}
          role="region"
          aria-label={ariaLabel}
          aria-busy="true"
          data-testid="map-live"
        />
      }
    >
      <GoogleMap
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
        interactive={interactive}
        routeColor={routeColor}
      />
    </Suspense>
  );
}
