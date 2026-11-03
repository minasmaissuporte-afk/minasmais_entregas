import type { CourierDeliveryRoute } from "@workspace/api-client-react";
import { Clock3, MapPin, Navigation, Route as RouteIcon } from "lucide-react";
import LiveMap, { type MapCoordinate, type MapMarker } from "@/components/live-map";

const money = (amount: number) =>
  amount.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

export default function CourierRouteMapTab({
  route,
  currentPosition,
}: {
  route: CourierDeliveryRoute;
  currentPosition: MapCoordinate | null;
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

  if (route.stops.length === 0) {
    return (
      <div className="panel p-5 text-sm text-muted-foreground">
        A rota ainda não tem paradas mapeadas. Atualize a tela depois de aceitar a rota.
      </div>
    );
  }

  return (
    <section className="overflow-hidden rounded-2xl border border-[#e7e6e3] bg-white" aria-label="Mapa da rota aceita">
      <header className="flex flex-wrap items-start justify-between gap-3 border-b border-border px-4 py-4">
        <div>
          <div className="eyebrow">ROTA ATIVA</div>
          <h2 className="mt-1 flex items-center gap-2 text-lg font-bold">
            <RouteIcon size={18} className="text-primary" />
            {route.deliveryCount} {route.deliveryCount === 1 ? "entrega" : "entregas"}
          </h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Paradas na ordem travada após aceitar a rota.
          </p>
        </div>
        <div className="text-right text-xs font-semibold text-muted-foreground">
          {route.distanceKm != null && <div>{route.distanceKm} km</div>}
          {route.estimatedMinutes != null && (
            <div className="mt-1 inline-flex items-center gap-1">
              <Clock3 size={13} /> {route.estimatedMinutes} min
            </div>
          )}
          <div className="mt-1 text-sm font-bold text-primary">{money(route.amountToReceive)}</div>
        </div>
      </header>
      <LiveMap
        markers={markers}
        routeGeometry={route.routeGeometry}
        ariaLabel="Mapa da rota ativa com a localização do motoboy"
        size="full-screen"
        showCenterControls
      />
      <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-border px-4 py-3">
        <div className="flex min-w-0 items-start gap-2 text-xs">
          <MapPin size={15} className="mt-0.5 shrink-0 text-primary" />
          <span className="text-muted-foreground">
            {nextStop
              ? `Próxima parada: ${nextStop.kind === "pickup" ? "retirada" : "entrega"} · ${nextStop.address}`
              : "Todas as paradas foram concluídas."}
          </span>
        </div>
        {nextStopUrl && (
          <a className="button-secondary min-h-10 shrink-0" href={nextStopUrl} target="_blank" rel="noreferrer">
            <Navigation size={15} /> Navegar até a próxima
          </a>
        )}
      </footer>
    </section>
  );
}
