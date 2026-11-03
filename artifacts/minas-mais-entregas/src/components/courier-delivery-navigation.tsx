import {
  getGetCourierDeliveryNavigationQueryKey,
  useGetCourierDeliveryNavigation,
  type Delivery,
} from "@workspace/api-client-react";
import { ArrowLeft, Clock3, MapPin, Navigation, RefreshCw } from "lucide-react";
import LiveMap, { type MapMarker } from "@/components/live-map";
import CourierUnableToDeliverAction from "@/components/courier-unable-to-deliver-action";

export default function CourierDeliveryNavigation({
  deliveryId,
  onBack,
  delivery,
}: {
  deliveryId: string;
  onBack: () => void;
  delivery: Delivery;
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

  return (
    <section className="relative h-[100dvh] w-full overflow-hidden bg-[#f4f3f1] text-[#24272d]" aria-label="Mapa da entrega individual">
      {data && (
        <LiveMap
          markers={markers}
          routeGeometry={data.routeGeometry}
          ariaLabel={`Rota do motoboy até ${data.targetLabel.toLowerCase()}`}
          size="full-screen"
          showCenterControls
          fitBehindBottomPanel
          controlsBottomOffset="calc(30dvh + 64px + env(safe-area-inset-bottom))"
        />
      )}
      <div className="pointer-events-none absolute inset-x-0 top-0 z-20 flex justify-start gap-2 p-3 pt-[max(env(safe-area-inset-top),12px)]">
        <button type="button" className="pointer-events-auto flex min-h-12 items-center gap-2 rounded-xl bg-white/95 px-4 text-sm font-semibold shadow-lg" onClick={onBack}>
          <ArrowLeft size={16} /> Entregas
        </button>
        <button
          className="pointer-events-auto grid h-12 w-12 place-items-center rounded-xl bg-white/95 shadow-lg"
          type="button"
          disabled={navigation.isFetching}
          onClick={() => void navigation.refetch()}
          aria-label="Atualizar mapa e rota"
        >
          <RefreshCw size={15} className={navigation.isFetching ? "animate-spin" : ""} />
        </button>
      </div>

      <div
        className="absolute inset-x-0 bottom-0 z-20 max-h-[30dvh] overflow-y-auto rounded-t-2xl border-t border-border bg-white/95 p-4 shadow-[0_-8px_24px_rgba(0,0,0,.12)] backdrop-blur"
        style={{ paddingBottom: "calc(env(safe-area-inset-bottom) + 12px)" }}
      >
        {data ? (
          <>
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">{data.targetLabel}</div>
                <h2 className="mt-1 truncate text-sm font-bold">{delivery.customerName} · {delivery.code}</h2>
                <p className="mt-1 flex items-start gap-1 text-xs leading-relaxed text-muted-foreground">
                  <MapPin size={13} className="mt-0.5 shrink-0" />{data.targetAddress}
                </p>
              </div>
              <div className="shrink-0 text-right text-xs font-semibold text-muted-foreground">
                {data.distanceMeters != null && <div>{(data.distanceMeters / 1000).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} km</div>}
                {data.durationSeconds != null && <div className="mt-1 flex items-center gap-1"><Clock3 size={12} />{Math.ceil(data.durationSeconds / 60)} min</div>}
              </div>
            </div>
            {delivery.notes && <p className="mt-2 text-xs text-muted-foreground">{delivery.notes}</p>}
            {delivery.status === "RETURNING_TO_STORE" ? (
              <p className="mt-2 text-xs font-semibold text-amber-900">Devolva o produto na filial.</p>
            ) : delivery.customerPhone ? (
              <div className="mt-2 flex flex-wrap gap-2">
                <a className="button-secondary min-h-12" href={`tel:${delivery.customerPhone}`}>Telefone</a>
                <a
                  className="button-secondary min-h-12"
                  href={`https://wa.me/${(() => {
                    const digits = delivery.customerPhone!.replace(/\D/g, "");
                    return digits.startsWith("55") ? digits : `55${digits}`;
                  })()}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  WhatsApp
                </a>
              </div>
            ) : null}
            <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-border pt-3">
              <span className="text-sm font-bold">
                {delivery.deliveryAmount.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}
              </span>
              {delivery.status !== "RETURNING_TO_STORE" && <CourierUnableToDeliverAction deliveryId={deliveryId} />}
            </div>
            <div className="mt-3 flex gap-2">
              {mapsUrl && (
                <a className="button-secondary min-h-12 flex-1 justify-center" href={mapsUrl} target="_blank" rel="noreferrer">
                  <Navigation size={14} /> Google Maps
                </a>
              )}
              {wazeUrl && (
                <a className="button-secondary min-h-12 flex-1 justify-center" href={wazeUrl} target="_blank" rel="noreferrer">
                  <Navigation size={14} /> Waze
                </a>
              )}
            </div>
          </>
        ) : (
          <div className="min-h-24 py-3 text-sm text-muted-foreground" aria-live="polite">
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
