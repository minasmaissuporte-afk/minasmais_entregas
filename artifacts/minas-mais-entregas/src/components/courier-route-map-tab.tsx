import type { CourierDeliveryRoute } from "@workspace/api-client-react";
import { ArrowLeft, Clock3, MapPin, Navigation, RefreshCw } from "lucide-react";
import LiveMap, { type MapCoordinate, type MapMarker } from "@/components/live-map";
import CourierUnableToDeliverAction from "@/components/courier-unable-to-deliver-action";

const money = (amount: number) =>
  amount.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

export default function CourierRouteMapTab({
  route,
  currentPosition,
  onBack,
  onRefresh,
  activeDelivery,
}: {
  route: CourierDeliveryRoute;
  currentPosition: MapCoordinate | null;
  onBack: () => void;
  onRefresh: () => void;
  activeDelivery: CourierDeliveryRoute["deliveries"][number] | null;
}) {
  const markers: MapMarker[] = [
    ...route.stops.map((stop) => ({
      id: stop.id,
      latitude: stop.latitude,
      longitude: stop.longitude,
      title: `${stop.sequence}. ${stop.kind === "pickup" ? "Retirada" : "Entrega"} · ${stop.code}`,
      detail: stop.address,
      kind: "stop" as const,
      sequence: stop.sequence,
      completed: stop.status === "DONE",
    })),
    ...(currentPosition
      ? [{
          id: `current-${route.id}`,
          ...currentPosition,
          title: "Sua posição atual",
          detail: "Posição recebida pelo GPS do aparelho",
          kind: "current" as const,
        }]
      : []),
  ];
  const nextStop = route.stops.find((stop) => stop.status === "PENDING");
  const nextStopUrl = nextStop
    ? `https://www.google.com/maps/dir/?api=1&destination=${nextStop.latitude},${nextStop.longitude}&travelmode=driving`
    : null;
  const nextStopWazeUrl = nextStop
    ? `https://waze.com/ul?ll=${nextStop.latitude}%2C${nextStop.longitude}&navigate=yes`
    : null;

  return (
    <section className="relative h-[100dvh] w-full overflow-hidden bg-[#f4f3f1]" aria-label="Mapa da rota aceita">
      <LiveMap
        markers={markers}
        routeGeometry={route.routeGeometry}
        ariaLabel="Mapa da rota ativa com a localização do motoboy"
        size="full-screen"
        showCenterControls
        fitBehindBottomPanel
        controlsBottomOffset="calc(30dvh + 64px + env(safe-area-inset-bottom))"
      />
      <div className="pointer-events-none absolute inset-x-0 top-0 z-20 flex justify-start gap-2 p-3 pt-[max(env(safe-area-inset-top),12px)]">
        <button type="button" className="pointer-events-auto flex min-h-12 items-center gap-2 rounded-xl bg-white/95 px-4 text-sm font-semibold shadow-lg" onClick={onBack}>
          <ArrowLeft size={16} /> Entregas
        </button>
        <button type="button" className="pointer-events-auto grid h-12 w-12 place-items-center rounded-xl bg-white/95 shadow-lg" onClick={onRefresh} aria-label="Atualizar rota">
          <RefreshCw size={16} />
        </button>
      </div>
      <div
        className="absolute inset-x-0 bottom-0 z-20 max-h-[30dvh] overflow-y-auto rounded-t-2xl border-t border-border bg-white/95 p-4 shadow-[0_-8px_24px_rgba(0,0,0,.12)] backdrop-blur"
        style={{ paddingBottom: "calc(env(safe-area-inset-bottom) + 12px)" }}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
              {nextStop ? `${nextStop.kind === "pickup" ? "Próxima parada · retirada" : "Próxima parada · entrega"}` : "Rota concluída"}
            </div>
            <h2 className="mt-1 truncate text-sm font-bold">
              {nextStop ? `${nextStop.code} · ${nextStop.customerName}` : "Todas as paradas foram concluídas"}
            </h2>
            <p className="mt-1 flex items-start gap-1 text-xs leading-relaxed text-muted-foreground">
              <MapPin size={13} className="mt-0.5 shrink-0" />
              {nextStop?.address ?? "A rota não tem paradas pendentes."}
            </p>
          </div>
          <div className="shrink-0 text-right text-xs font-semibold text-muted-foreground">
            {route.distanceKm != null && <div>{route.distanceKm} km</div>}
            {route.estimatedMinutes != null && <div className="mt-1 flex items-center gap-1"><Clock3 size={12} />{route.estimatedMinutes} min</div>}
          </div>
        </div>
        {activeDelivery && (
          <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-border pt-3">
            <span className="text-sm font-bold">{money(activeDelivery.deliveryAmount)}</span>
            <CourierUnableToDeliverAction deliveryId={activeDelivery.id} className="min-h-12" />
          </div>
        )}
        {nextStopUrl && nextStopWazeUrl && (
          <div className="mt-3 flex gap-2">
            <a className="button-secondary min-h-12 flex-1 justify-center" href={nextStopUrl} target="_blank" rel="noreferrer">
              <Navigation size={15} /> Google Maps
            </a>
            <a className="button-secondary min-h-12 flex-1 justify-center" href={nextStopWazeUrl} target="_blank" rel="noreferrer">
              <Navigation size={15} /> Waze
            </a>
          </div>
        )}
      </div>
    </section>
  );
}
