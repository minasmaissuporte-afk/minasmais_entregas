import type { CourierDeliveryRoute } from "@workspace/api-client-react";
import type { CSSProperties } from "react";
import {
  Banknote,
  Clock3,
  MapPin,
  MessageCircle,
  Navigation,
  Phone,
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
  activeDelivery,
  resizeVersion,
}: {
  route: CourierDeliveryRoute;
  currentPosition: MapCoordinate | null;
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
  const panelDelivery = activeDelivery ?? nextDelivery;
  const nextStopName = nextStop
    ? nextStop.kind === "pickup"
      ? nextStop.storeName
      : nextStop.customerName
    : null;
  const panelName = panelDelivery?.customerName ?? nextStopName;
  const panelAddress = panelDelivery?.destination ?? nextStop?.address;
  const phone = panelDelivery?.customerPhone ?? (nextStop?.kind === "delivery" ? nextDelivery?.customerPhone : null);
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
          interactive={false}
          routeColor="#E20210"
          fitBehindBottomPanel
          fitPadding={fitPadding}
          resizeKey={resizeKey}
          singleAttribution
        />
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
            {panelDelivery
              ? `Próxima parada · entrega · ${panelDelivery.code}`
              : nextStop
                ? `${nextStop.kind === "pickup" ? "Próxima parada · retirada" : "Próxima parada · entrega"} · ${nextStop.code}`
              : "Rota concluída"}
          </div>
          <h2 className="courier-route-map-screen__customer">
            {panelName ?? "Todas as paradas foram concluídas"}
          </h2>
          <p className="courier-route-map-screen__address">
            <MapPin size={16} aria-hidden="true" />
            <span>{panelAddress ?? "A rota não tem paradas pendentes."}</span>
          </p>
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
            <a className="button-primary min-h-12 flex-1 justify-center" href={nextStopUrl} target="_blank" rel="noreferrer" aria-label="Abrir rota no Google Maps" title="Google Maps">
              <Navigation size={16} /> <span>Google Maps</span>
            </a>
            <a className="button-primary min-h-12 flex-1 justify-center" href={nextStopWazeUrl} target="_blank" rel="noreferrer" aria-label="Abrir rota no Waze" title="Waze">
              <Route size={16} /> <span>Waze</span>
            </a>
          </div>
        )}
        {phone && whatsappDigits && (
          <div className="courier-route-map-screen__actions courier-route-map-screen__actions--secondary">
            <a className="button-secondary min-h-12 flex-1 justify-center" href={`tel:${phone}`} aria-label="Telefone do cliente" title="Telefone">
              <Phone size={18} />
            </a>
            <a className="button-secondary min-h-12 flex-1 justify-center" href={`https://wa.me/${whatsappDigits}`} target="_blank" rel="noreferrer" aria-label="WhatsApp do cliente" title="WhatsApp">
              <MessageCircle size={18} />
            </a>
          </div>
        )}
        {activeDelivery && (
          <CourierUnableToDeliverAction
            deliveryId={activeDelivery.id}
            className="courier-route-map-screen__unable courier-map-text-link"
          />
        )}
      </div>
    </section>
  );
}
