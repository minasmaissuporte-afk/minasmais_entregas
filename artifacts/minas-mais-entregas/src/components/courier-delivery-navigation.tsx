import {
  getGetCourierDeliveryNavigationQueryKey,
  useGetCourierDeliveryNavigation,
  type Delivery,
} from "@workspace/api-client-react";
import type { CSSProperties } from "react";
import {
  ArrowLeft,
  Banknote,
  Clock3,
  LoaderCircle,
  MapPin,
  MessageCircle,
  Navigation,
  Phone,
  RefreshCw,
  Route,
} from "lucide-react";
import LiveMap, { type MapMarker } from "@/components/live-map";
import CourierUnableToDeliverAction from "@/components/courier-unable-to-deliver-action";
import useCourierMapPanel from "@/hooks/use-courier-map-panel";

export default function CourierDeliveryNavigation({
  deliveryId,
  onBack,
  delivery,
  resizeVersion,
}: {
  deliveryId: string;
  onBack: () => void;
  delivery: Delivery;
  resizeVersion: number;
}) {
  const navigation = useGetCourierDeliveryNavigation(deliveryId, {
    query: {
      queryKey: getGetCourierDeliveryNavigationQueryKey(deliveryId),
      refetchOnWindowFocus: true,
      retry: false,
      refetchInterval: (query) => {
        if (query.state.data) return 60_000;
        const status = (query.state.error as { status?: number } | null)?.status;
        return status && status !== 409 ? false : 10_000;
      },
    },
  });
  const data = navigation.data;
  const markers: MapMarker[] = data
    ? [
        {
          id: `current-${deliveryId}`,
          ...data.currentPosition,
          title: "Sua posição atual",
          detail: `GPS atualizado às ${new Date(data.lastLocationAt).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}`,
          kind: "current",
        },
        {
          id: `target-${deliveryId}`,
          ...data.targetPosition,
          title: data.targetLabel,
          detail: data.targetAddress,
          kind: "stop",
          sequence: 1,
        },
      ]
    : [];
  const mapsUrl = data
    ? `https://www.google.com/maps/dir/?api=1&origin=${data.currentPosition.latitude},${data.currentPosition.longitude}&destination=${data.targetPosition.latitude},${data.targetPosition.longitude}&travelmode=driving`
    : null;
  const wazeUrl = data
    ? `https://waze.com/ul?ll=${data.targetPosition.latitude}%2C${data.targetPosition.longitude}&navigate=yes`
    : null;
  const { panelRef, panelHeight, landscape, fitPadding } = useCourierMapPanel();
  const resizeKey = `${resizeVersion}:${Math.round(panelHeight)}:${landscape}`;
  const phoneDigits = delivery.customerPhone?.replace(/\D/g, "");
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
      aria-label="Mapa da entrega individual"
    >
      <div className="courier-route-map-screen__map">
        <LiveMap
          markers={markers}
          routeGeometry={data?.routeGeometry}
          ariaLabel={`Rota do motoboy até ${data?.targetLabel.toLowerCase() ?? delivery.customerName.toLowerCase()}`}
          size="full-screen"
          showCenterControls
          showCenterOnMe
          compactCenterControls
          fitBehindBottomPanel
          fitPadding={fitPadding}
          resizeKey={resizeKey}
          autoFitOnGeometryChange={false}
          singleAttribution
          controlsTopOffset="calc(env(safe-area-inset-top) + var(--courier-center-controls-top, 160px))"
          controlsRightOffset="var(--courier-controls-right, 12px)"
        />
      </div>
      <div className="courier-route-map-screen__top-actions pointer-events-none absolute inset-x-0 z-20 flex flex-wrap justify-start gap-2 p-3">
        <button type="button" className="courier-map-top-button pointer-events-auto flex min-h-12 items-center gap-2 rounded-xl bg-white/95 px-4 text-sm font-semibold shadow-lg" onClick={onBack}>
          <ArrowLeft size={16} /> Voltar para Entregas
        </button>
        <button
          className="courier-map-top-button pointer-events-auto flex min-h-12 items-center gap-2 rounded-xl bg-white/95 px-3 text-sm font-semibold shadow-lg"
          type="button"
          disabled={navigation.isFetching}
          onClick={() => void navigation.refetch()}
          aria-label="Atualizar mapa e rota"
          aria-describedby={navigation.isFetching ? "courier-map-refresh-status" : undefined}
        >
          <RefreshCw size={15} className={navigation.isFetching ? "animate-spin" : ""} />
          {navigation.isFetching ? "Atualizando…" : "Atualizar"}
        </button>
        {navigation.isFetching && (
          <span id="courier-map-refresh-status" className="pointer-events-auto flex min-h-12 items-center gap-2 rounded-xl bg-white/95 px-3 text-xs font-semibold shadow-lg" role="status">
            <LoaderCircle size={14} className="animate-spin" /> Atualizando mapa…
          </span>
        )}
      </div>

      <div
        ref={panelRef}
        className="courier-route-map-screen__panel"
        role="region"
        aria-label="Detalhes da entrega"
      >
        <div className="courier-route-map-screen__handle" aria-hidden="true" />
        {data ? (
          <>
            <div className="courier-route-map-screen__stop-heading">
              <div className="courier-route-map-screen__eyebrow">{data.targetLabel} · {delivery.code}</div>
              <h2 className="courier-route-map-screen__customer">{delivery.customerName}</h2>
              <p className="courier-route-map-screen__address">
                <MapPin size={16} aria-hidden="true" />
                <span>{data.targetAddress}</span>
              </p>
              {delivery.notes && <p className="courier-route-map-screen__notes">{delivery.notes}</p>}
            </div>
            <div className="courier-route-map-screen__summary" aria-label="Resumo da entrega">
              {data.distanceMeters != null && (
                <span><Route size={16} aria-hidden="true" />{(data.distanceMeters / 1000).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} km</span>
              )}
              {data.durationSeconds != null && (
                <span><Clock3 size={16} aria-hidden="true" />{Math.ceil(data.durationSeconds / 60)} min</span>
              )}
              <span><Banknote size={16} aria-hidden="true" />{delivery.deliveryAmount.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}</span>
            </div>
            <div className="courier-route-map-screen__actions">
              {mapsUrl && (
                <a className="button-primary min-h-12 flex-1 justify-center" href={mapsUrl} target="_blank" rel="noreferrer">
                  <Navigation size={16} /> Google Maps
                </a>
              )}
              {wazeUrl && (
                <a className="button-primary min-h-12 flex-1 justify-center" href={wazeUrl} target="_blank" rel="noreferrer">
                  <Navigation size={16} /> Waze
                </a>
              )}
            </div>
            {delivery.status === "RETURNING_TO_STORE" ? (
              <p className="courier-route-map-screen__return-reminder">Devolva o produto na filial.</p>
            ) : delivery.customerPhone && whatsappDigits ? (
              <div className="courier-route-map-screen__actions courier-route-map-screen__actions--secondary">
                <a className="button-secondary min-h-12 flex-1 justify-center" href={`tel:${delivery.customerPhone}`}>
                  <Phone size={16} /> Telefone
                </a>
                <a
                  className="button-secondary min-h-12 flex-1 justify-center"
                  href={`https://wa.me/${whatsappDigits}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  <MessageCircle size={16} /> WhatsApp
                </a>
              </div>
            ) : null}
            {delivery.status !== "RETURNING_TO_STORE" && (
              <CourierUnableToDeliverAction
                deliveryId={deliveryId}
                className="courier-route-map-screen__unable"
              />
            )}
          </>
        ) : (
          <div className="courier-route-map-screen__loading" aria-live="polite">
            {navigation.isLoading
              ? "Obtendo GPS e calculando a rota…"
              : ((navigation.error as { data?: { error?: string } } | null)?.data?.error ??
                "A rota depende de uma posição GPS atual. Permita a localização e mantenha o PWA aberto; depois toque em Atualizar.")}
          </div>
        )}
      </div>
    </section>
  );
}
