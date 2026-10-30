import {
  getGetCourierDeliveryNavigationQueryKey,
  useGetCourierDeliveryNavigation,
} from "@workspace/api-client-react";
import { Clock3, MapPin, Navigation, RefreshCw } from "lucide-react";
import LiveMap, { type MapMarker } from "@/components/live-map";

export default function CourierDeliveryNavigation({
  deliveryId,
}: {
  deliveryId: string;
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

  return (
    <section className="mt-4 overflow-hidden rounded-xl border border-border bg-white text-[#24272d]" aria-label="Mapa da entrega individual">
      <div className="flex items-start justify-between gap-3 border-b border-border px-4 py-3">
        <div>
          <h4 className="text-sm font-bold">Mapa e rota</h4>
          <p className="mt-1 text-[11px] text-muted-foreground">
            A rota usa sua posição GPS atual e o próximo destino.
          </p>
        </div>
        <button
          className="button-quiet shrink-0"
          type="button"
          disabled={navigation.isFetching}
          onClick={() => void navigation.refetch()}
          aria-label="Atualizar mapa e rota"
        >
          <RefreshCw size={14} /> {navigation.isFetching ? "Atualizando…" : "Atualizar"}
        </button>
      </div>

      {data ? (
        <>
          <LiveMap
            markers={markers}
            routeGeometry={data.routeGeometry}
            ariaLabel={`Rota do motoboy até ${data.targetLabel.toLowerCase()}`}
          />
          <div className="space-y-3 px-4 py-3">
            <div className="flex items-start gap-2 text-xs">
              <MapPin size={15} className="mt-0.5 shrink-0 text-primary" />
              <div>
                <div className="font-semibold">{data.targetLabel}</div>
                <div className="mt-0.5 leading-relaxed text-muted-foreground">{data.targetAddress}</div>
              </div>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex gap-3 text-xs font-semibold text-muted-foreground">
                {data.distanceMeters != null && (
                  <span>{(data.distanceMeters / 1000).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} km</span>
                )}
                {data.durationSeconds != null && (
                  <span className="inline-flex items-center gap-1"><Clock3 size={13} />{Math.ceil(data.durationSeconds / 60)} min</span>
                )}
              </div>
              {mapsUrl && (
                <a className="button-secondary min-h-9" href={mapsUrl} target="_blank" rel="noreferrer">
                  <Navigation size={14} /> Abrir navegação
                </a>
              )}
            </div>
          </div>
        </>
      ) : (
        <div className="px-4 py-5 text-sm text-muted-foreground" aria-live="polite">
          {navigation.isLoading
            ? "Obtendo GPS e calculando a rota…"
            : ((navigation.error as { data?: { error?: string } } | null)?.data?.error ??
              "A rota depende de uma posição GPS atual. Permita a localização e mantenha o PWA aberto; depois toque em Atualizar.")}
        </div>
      )}
    </section>
  );
}
