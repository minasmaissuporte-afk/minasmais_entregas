import type { CourierDeliveryRoute } from "@workspace/api-client-react";
import type { CSSProperties } from "react";
import {
  ArrowLeft,
  Banknote,
  Clock3,
  MapPin,
  MessageCircle,
  Navigation,
  Phone,
  RefreshCw,
  Route,
} from "lucide-react";
import LiveMap, { type MapCoordinate, type MapMarker } from "@/components/live-map";
import CourierUnableToDeliverAction from "@/components/courier-unable-to-deliver-action";
import useCourierMapPanel from "@/hooks/use-courier-map-panel";

const money = (amount: number) =>
  amount.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

export default function CourierRouteMapTab({
  route,
  currentPosition,
  onBack,
  onRefresh,
  activeDelivery,
  resizeVersion,
}: {
  route: CourierDeliveryRoute;
  currentPosition: MapCoordinate | null;
  onBack: () => void;
  onRefresh: () => void;
  activeDelivery: CourierDeliveryRoute["deliveries"][number] | null;
  resizeVersion: number;
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
  const nextDelivery = nextStop
    ? route.deliveries.find((delivery) => delivery.id === nextStop.deliveryId)
    : null;
  const nextStopName = nextStop
    ? nextStop.kind === "pickup"
      ? nextStop.storeName
      : nextStop.customerName
    : null;
  const phone = nextStop?.kind === "delivery" ? nextDelivery?.customerPhone : null;
  const amount = activeDelivery?.deliveryAmount ?? nextStop?.deliveryAmount ?? route.amountToReceive;
  const nextStopUrl = nextStop
    ? `https://www.google.com/maps/dir/?api=1&destination=${nextStop.latitude},${nextStop.longitude}&travelmode=driving`
    : null;
  const nextStopWazeUrl = nextStop
    ? `https://waze.com/ul?ll=${nextStop.latitude}%2C${nextStop.longitude}&navigate=yes`
    : null;
  const { panelRef, panelHeight, landscape, fitPadding } = useCourierMapPanel();
  const resizeKey = `${resizeVersion}:${Math.round(panelHeight)}:${landscape}`;
  const phoneDigits = phone?.replace(/\D/g, "");
  const whatsappDigits = phoneDigits
    ? phoneDigits.startsWith("55")
      ? phoneDigits
      : `55${phoneDigits}`
    : null;
  const screenStyle = {
    "--courier-panel-height": `${panelHeight}px`,
  } as CSSProperties;

  return (
    <section
      className="courier-route-map-screen"
      data-layout={landscape ? "landscape" : "portrait"}
      style={screenStyle}
      aria-label="Mapa da rota aceita"
    >
      <div className="courier-route-map-screen__map">
        <LiveMap
          markers={markers}
          routeGeometry={route.routeGeometry}
          ariaLabel="Mapa da rota ativa com a localização do motoboy"
          size="full-screen"
          showCenterControls
          showCenterOnMe
          compactCenterControls
          fitBehindBottomPanel
          fitPadding={fitPadding}
          resizeKey={resizeKey}
          singleAttribution
          controlsTopOffset="calc(env(safe-area-inset-top) + var(--courier-center-controls-top, 160px))"
          controlsRightOffset="var(--courier-controls-right, 12px)"
        />
      </div>
      <div className="courier-route-map-screen__top-actions pointer-events-none absolute inset-x-0 z-20 flex justify-start gap-2 p-3">
        <button type="button" className="courier-map-top-button pointer-events-auto flex min-h-12 items-center gap-2 rounded-xl bg-white/95 px-4 text-sm font-semibold shadow-lg" onClick={onBack}>
          <ArrowLeft size={16} /> Voltar para Entregas
        </button>
        <button type="button" className="courier-map-top-button pointer-events-auto flex min-h-12 items-center gap-2 rounded-xl bg-white/95 px-3 text-sm font-semibold shadow-lg" onClick={onRefresh} aria-label="Atualizar rota">
          <RefreshCw size={16} /> Atualizar
        </button>
      </div>
      <div
        ref={panelRef}
        className="courier-route-map-screen__panel"
        role="region"
        aria-label="Detalhes da próxima parada"
      >
        <div className="courier-route-map-screen__handle" aria-hidden="true" />
        <div className="courier-route-map-screen__stop-heading">
          <div className="courier-route-map-screen__eyebrow">
            {nextStop
              ? `${nextStop.kind === "pickup" ? "Próxima parada · retirada" : "Próxima parada · entrega"} · ${nextStop.code}`
              : "Rota concluída"}
          </div>
          <h2 className="courier-route-map-screen__customer">
            {nextStopName ?? "Todas as paradas foram concluídas"}
          </h2>
          <p className="courier-route-map-screen__address">
            <MapPin size={16} aria-hidden="true" />
            <span>{nextStop?.address ?? "A rota não tem paradas pendentes."}</span>
          </p>
          {nextDelivery?.notes && (
            <p className="courier-route-map-screen__notes">{nextDelivery.notes}</p>
          )}
        </div>
        <div className="courier-route-map-screen__summary" aria-label="Resumo da rota">
          {route.distanceKm != null && (
            <span><Route size={16} aria-hidden="true" />{route.distanceKm} km</span>
          )}
          {route.estimatedMinutes != null && (
            <span><Clock3 size={16} aria-hidden="true" />{route.estimatedMinutes} min</span>
          )}
          <span><Banknote size={16} aria-hidden="true" />{money(amount)}</span>
        </div>
        {nextStopUrl && nextStopWazeUrl && (
          <div className="courier-route-map-screen__actions">
            <a className="button-primary min-h-12 flex-1 justify-center" href={nextStopUrl} target="_blank" rel="noreferrer">
              <Navigation size={16} /> Google Maps
            </a>
            <a className="button-primary min-h-12 flex-1 justify-center" href={nextStopWazeUrl} target="_blank" rel="noreferrer">
              <Navigation size={16} /> Waze
            </a>
          </div>
        )}
        {phone && whatsappDigits && (
          <div className="courier-route-map-screen__actions courier-route-map-screen__actions--secondary">
            <a className="button-secondary min-h-12 flex-1 justify-center" href={`tel:${phone}`}>
              <Phone size={16} /> Telefone
            </a>
            <a className="button-secondary min-h-12 flex-1 justify-center" href={`https://wa.me/${whatsappDigits}`} target="_blank" rel="noreferrer">
              <MessageCircle size={16} /> WhatsApp
            </a>
          </div>
        )}
        {activeDelivery && (
          <CourierUnableToDeliverAction
            deliveryId={activeDelivery.id}
            className="courier-route-map-screen__unable"
          />
        )}
      </div>
    </section>
  );
}
