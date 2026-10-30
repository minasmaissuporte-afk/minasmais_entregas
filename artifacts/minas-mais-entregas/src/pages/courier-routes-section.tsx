import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  getGetCourierEarningsQueryKey,
  getListCourierRoutesQueryKey,
  getListDeliveriesQueryKey,
  useAcceptCourierRoute,
  useCompleteCourierRouteStop,
  useUpdateCourierLocation,
  type CourierLocationInput,
  type CourierDeliveryRoute,
} from "@workspace/api-client-react";
import { Check, Clock3, MapPin, Navigation, PackageCheck, RefreshCw, Route as RouteIcon } from "lucide-react";
import LiveMap, { type MapCoordinate, type MapMarker } from "@/components/live-map";
import SwipeToConfirm from "@/components/swipe-to-confirm";

const money = (amount: number) =>
  amount.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

function requestCurrentLocation() {
  return new Promise<CourierLocationInput>((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error("Este navegador não oferece localização."));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (position) => resolve({
        latitude: position.coords.latitude,
        longitude: position.coords.longitude,
        accuracyMeters: position.coords.accuracy,
        speedMetersPerSecond: position.coords.speed,
        measuredAt: new Date(position.timestamp).toISOString(),
      }),
      () => reject(new Error("GPS bloqueado. Permita Localização nas configurações do navegador e tente novamente.")),
      { enableHighAccuracy: true, timeout: 15_000 },
    );
  });
}

function navigateToStop(latitude: number, longitude: number) {
  const url = `https://www.google.com/maps/dir/?api=1&destination=${latitude},${longitude}&travelmode=driving`;
  window.open(url, "_blank", "noopener,noreferrer");
}

export default function CourierRoutesSection({
  routes,
  isLoading,
  isError,
  onRetry,
}: {
  routes: CourierDeliveryRoute[];
  isLoading: boolean;
  isError: boolean;
  onRetry: () => void;
}) {
  const queryClient = useQueryClient();
  const acceptRoute = useAcceptCourierRoute();
  const completeStop = useCompleteCourierRouteStop();
  const updateLocation = useUpdateCourierLocation();
  const updateLocationRef = useRef(updateLocation.mutateAsync);
  updateLocationRef.current = updateLocation.mutateAsync;
  const [busyRouteId, setBusyRouteId] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState("");
  const [locationMessage, setLocationMessage] = useState("");
  const [currentPosition, setCurrentPosition] = useState<MapCoordinate | null>(null);
  const activeRoute = routes.find((route) => route.status === "ACCEPTED");
  const offeredRoutes = routes.filter((route) => route.status === "OFFERED");

  useEffect(() => {
    if (!navigator.geolocation) {
      setLocationMessage("Este navegador não oferece localização GPS.");
      return;
    }

    let watching = true;
    let lastDisplayedAt = 0;
    let lastSentAt = 0;
    let sending = false;
    let wakeLock: { release: () => Promise<void> } | null = null;
    const options: PositionOptions = {
      enableHighAccuracy: true,
      maximumAge: 0,
      timeout: 20_000,
    };
    const sendPosition = (gpsPosition: GeolocationPosition) => {
        if (!watching) return;
        const position = {
          latitude: gpsPosition.coords.latitude,
          longitude: gpsPosition.coords.longitude,
          accuracyMeters: gpsPosition.coords.accuracy,
          speedMetersPerSecond: gpsPosition.coords.speed,
          measuredAt: new Date(gpsPosition.timestamp).toISOString(),
        };
        const now = Date.now();
        if (now - lastDisplayedAt >= 5_000) {
          setCurrentPosition({ latitude: position.latitude, longitude: position.longitude });
          lastDisplayedAt = now;
        }
        if (sending || now - lastSentAt < 15_000) return;
        lastSentAt = now;
        sending = true;
        void updateLocationRef.current({ data: position })
          .then(() => {
            if (watching) setLocationMessage("");
          })
          .catch(() => {
            if (watching) {
              setLocationMessage("GPS ativo, mas sem conexão com a central. A próxima tentativa será automática.");
            }
          })
          .finally(() => { sending = false; });
    };
    const handleLocationError = (error: GeolocationPositionError) => {
      if (!watching) return;
      if (error.code === error.PERMISSION_DENIED) {
        setLocationMessage("GPS bloqueado. Permita Localização nas configurações do navegador; no iPhone, habilite para este site.");
      } else if (error.code === error.POSITION_UNAVAILABLE) {
        setLocationMessage("GPS indisponível. Verifique a localização do aparelho e mantenha o PWA aberto.");
      } else {
        setLocationMessage("Aguardando GPS do aparelho. Mantenha o PWA aberto durante a entrega.");
      }
    };
    const requestCurrentPosition = () => {
      if (document.visibilityState !== "visible") return;
      navigator.geolocation.getCurrentPosition(sendPosition, handleLocationError, options);
    };
    const watchId = navigator.geolocation.watchPosition(
      sendPosition,
      handleLocationError,
      options,
    );
    const wakeLockApi = navigator as Navigator & {
      wakeLock?: { request: (type: "screen") => Promise<{ release: () => Promise<void> }> };
    };
    const acquireWakeLock = async () => {
      if (!wakeLockApi.wakeLock || document.visibilityState !== "visible" || wakeLock) return;
      try {
        wakeLock = await wakeLockApi.wakeLock.request("screen");
      } catch {
        // Browsers may not support Wake Lock or may reject it; GPS sharing remains active.
      }
    };
    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        requestCurrentPosition();
        void acquireWakeLock();
      }
    };
    const heartbeat = window.setInterval(requestCurrentPosition, 15_000);
    document.addEventListener("visibilitychange", onVisibilityChange);
    void acquireWakeLock();
    setLocationMessage("Compartilhando GPS a cada 15 segundos enquanto você estiver conectado. Mantenha o PWA aberto.");
    return () => {
      watching = false;
      navigator.geolocation.clearWatch(watchId);
      window.clearInterval(heartbeat);
      document.removeEventListener("visibilitychange", onVisibilityChange);
      if (wakeLock) void wakeLock.release();
    };
  }, []);

  const refreshRouteData = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: getListCourierRoutesQueryKey() }),
      queryClient.invalidateQueries({ queryKey: getListDeliveriesQueryKey() }),
      queryClient.invalidateQueries({ queryKey: getGetCourierEarningsQueryKey({ period: "day" }) }),
      queryClient.invalidateQueries({ queryKey: getGetCourierEarningsQueryKey({ period: "week" }) }),
      queryClient.invalidateQueries({ queryKey: getGetCourierEarningsQueryKey({ period: "month" }) }),
    ]);
  };

  const handleAccept = async (route: CourierDeliveryRoute) => {
    setErrorMessage("");
    setBusyRouteId(route.id);
    try {
      const location = await requestCurrentLocation();
      try {
        await updateLocation.mutateAsync({ data: location });
      } catch {
        setLocationMessage("A localização será reenviada automaticamente assim que a conexão voltar.");
      }
      await acceptRoute.mutateAsync({
        routeId: route.id,
        data: { latitude: location.latitude, longitude: location.longitude },
      });
      await refreshRouteData();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Não foi possível aceitar a rota.");
    } finally {
      setBusyRouteId(null);
    }
  };

  const handleCompleteStop = async (routeId: string, stopId: string) => {
    setErrorMessage("");
    setBusyRouteId(routeId);
    try {
      await completeStop.mutateAsync({ routeId, stopId });
      await refreshRouteData();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Não foi possível concluir esta parada.");
    } finally {
      setBusyRouteId(null);
    }
  };

  return (
    <section className="mt-6 space-y-4" aria-label="Rotas do motoboy">
      <div className="flex items-end justify-between">
        <div>
          <div className="eyebrow">ROTAS AGRUPADAS</div>
          <h2 className="mt-1 text-lg font-bold">Rotas e sequência de paradas</h2>
        </div>
        <button className="button-quiet" type="button" onClick={onRetry} aria-label="Atualizar rotas">
          <RefreshCw size={15} /> Atualizar
        </button>
      </div>

      <div className="rounded-lg border border-blue-100 bg-blue-50 px-3 py-2 text-xs text-blue-900" role="status">
        <MapPin size={14} className="mr-1 inline-block align-text-bottom" />
        O GPS é compartilhado a cada 15 segundos enquanto você estiver conectado. Mantenha o PWA aberto.
        {locationMessage && <span className="mt-1 block">{locationMessage}</span>}
      </div>

      {errorMessage && <div role="alert" className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">{errorMessage}</div>}

      {isLoading ? (
        <div className="panel p-5 text-sm text-muted-foreground">Carregando rotas…</div>
      ) : isError ? (
        <div className="panel p-5">
          <p className="text-sm text-red-700">Não foi possível carregar as rotas.</p>
          <button className="button-secondary mt-3" type="button" onClick={onRetry}>Tentar novamente</button>
        </div>
      ) : (
        <>
          {activeRoute && (
            <ActiveRouteCard
              route={activeRoute}
              busy={busyRouteId === activeRoute.id}
              currentPosition={currentPosition}
              locationMessage={locationMessage}
              onComplete={(stopId) => void handleCompleteStop(activeRoute.id, stopId)}
            />
          )}

          {!activeRoute && offeredRoutes.map((route) => (
            <article key={route.id} className="panel p-4 sm:p-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2 text-sm font-bold"><RouteIcon size={17} className="text-primary" />{route.deliveryCount} {route.deliveryCount === 1 ? "entrega" : "entregas"}</div>
                  <p className="mt-1 text-xs text-muted-foreground">A sequência otimizada será travada quando você aceitar.</p>
                </div>
                <div className="text-right">
                  <div className="eyebrow">TOTAL PREVISTO</div>
                  <div className="mt-1 text-lg font-bold text-primary">{money(route.amountToReceive)}</div>
                </div>
              </div>
              <div className="mt-4 divide-y divide-border border-y border-border">
                {route.deliveries.map((delivery) => (
                  <div key={delivery.id} className="flex items-start justify-between gap-3 py-3">
                    <div className="min-w-0">
                      <div className="text-sm font-semibold">{delivery.code} · {delivery.storeName}</div>
                      <div className="mt-1 text-xs leading-relaxed text-muted-foreground">{delivery.destination}</div>
                    </div>
                    <div className="shrink-0 text-sm font-semibold">{money(delivery.deliveryAmount)}</div>
                  </div>
                ))}
              </div>
              <button
                className="button-primary mt-4 min-h-11 w-full justify-center"
                type="button"
                disabled={busyRouteId !== null}
                onClick={() => void handleAccept(route)}
              >
                <Navigation size={16} />
                {busyRouteId === route.id ? "Calculando melhor rota…" : "Aceitar e calcular rota"}
              </button>
              <p className="mt-2 text-center text-[11px] text-muted-foreground">
                O navegador pedirá sua localização para ordenar as paradas a partir de onde você está.
              </p>
            </article>
          ))}

          {!activeRoute && offeredRoutes.length === 0 && (
            <div className="panel p-5 text-center">
              <PackageCheck className="mx-auto text-muted-foreground" size={22} />
              <p className="mt-2 text-sm font-semibold">Nenhuma rota agrupada disponível</p>
              <p className="mt-1 text-xs text-muted-foreground">Novas ofertas enviadas pela central aparecerão aqui.</p>
            </div>
          )}
        </>
      )}
    </section>
  );
}

function ActiveRouteCard({
  route,
  busy,
  currentPosition,
  locationMessage,
  onComplete,
}: {
  route: CourierDeliveryRoute;
  busy: boolean;
  currentPosition: MapCoordinate | null;
  locationMessage: string;
  onComplete: (stopId: string) => void;
}) {
  const completedStops = route.stops.filter((stop) => stop.status === "DONE").length;
  const nextStop = route.stops.find((stop) => stop.status === "PENDING");
  const progress = route.stops.length ? Math.round((completedStops / route.stops.length) * 100) : 0;
  const mapMarkers: MapMarker[] = [
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
          detail: "Localização recebida pelo GPS do aparelho",
          kind: "current" as const,
        }]
      : []),
  ];

  return (
    <article className="overflow-hidden rounded-2xl bg-[#a91d2a] p-4 text-white shadow-sm sm:p-5">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="text-[10px] font-semibold uppercase tracking-[.12em] text-white/75">Rota aceita · sequência travada</div>
          <h3 className="mt-1 text-xl font-bold">{route.deliveryCount} entregas</h3>
        </div>
        <div className="text-right">
          <div className="text-[10px] font-semibold uppercase tracking-[.12em] text-white/75">A receber</div>
          <div className="mt-1 text-lg font-bold">{money(route.amountToReceive)}</div>
        </div>
      </header>

      <div className="mt-4 flex flex-wrap gap-2 text-xs text-white/90">
        {route.distanceKm != null && <span className="rounded-full bg-white/15 px-3 py-1">{route.distanceKm} km</span>}
        {route.estimatedMinutes != null && <span className="rounded-full bg-white/15 px-3 py-1"><Clock3 className="mr-1 inline" size={13} />{route.estimatedMinutes} min</span>}
        <span className="rounded-full bg-white/15 px-3 py-1">{completedStops}/{route.stops.length} paradas</span>
      </div>
      <div className="mt-4 h-2 overflow-hidden rounded-full bg-black/15">
        <div className="h-full rounded-full bg-white transition-all" style={{ width: `${progress}%` }} />
      </div>
      {route.stops.length > 0 && (
        <div className="mt-4 overflow-hidden rounded-xl bg-white text-[#24272d]">
          <div className="border-b border-border px-4 py-3">
            <div className="text-sm font-bold">Mapa da rota</div>
            <p className="mt-1 text-[11px] text-muted-foreground">
              {route.routeGeometry?.length
                ? "Traçado viário calculado pelo Mapbox, com paradas numeradas."
                : "Paradas numeradas na sequência da rota."}
            </p>
          </div>
          <LiveMap
            markers={mapMarkers}
            routeGeometry={route.routeGeometry}
            ariaLabel="Rota do motoboy com paradas numeradas e posição atual"
          />
          <div className="px-4 py-2 text-[11px] text-muted-foreground">
            {locationMessage || "Aguardando posição GPS do aparelho."}
          </div>
        </div>
      )}

      {nextStop ? (
        <div className="mt-4 rounded-xl bg-white p-4 text-[#24272d]">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="text-xs font-semibold text-primary">{nextStop.sequence}. {nextStop.kind === "pickup" ? "Retirada na unidade" : "Entrega ao cliente"}</div>
              <div className="mt-1 text-sm font-bold">{nextStop.code} · {nextStop.storeName}</div>
              <div className="mt-1 text-xs text-muted-foreground">{nextStop.customerName}</div>
            </div>
            {nextStop.kind === "delivery" && <span className="shrink-0 text-sm font-bold">{money(nextStop.deliveryAmount)}</span>}
          </div>
          <div className="mt-3 flex items-start gap-2 text-xs leading-relaxed">
            <MapPin size={15} className="mt-0.5 shrink-0 text-primary" />
            <span>{nextStop.address}</span>
          </div>
          <div className="mt-4 grid gap-2 sm:grid-cols-2">
            <a
              className="button-secondary min-h-10 justify-center"
              href={`https://www.google.com/maps/dir/?api=1&destination=${nextStop.latitude},${nextStop.longitude}&travelmode=driving`}
              target="_blank"
              rel="noreferrer"
            >
              <Navigation size={15} /> Navegar
            </a>
            {nextStop.kind === "delivery" ? (
              <SwipeToConfirm
                disabled={busy}
                label="Deslize para confirmar a entrega"
                onConfirm={() => onComplete(nextStop.id)}
              />
            ) : (
              <button
                className="button-primary min-h-10 justify-center"
                type="button"
                disabled={busy}
                onClick={() => onComplete(nextStop.id)}
              >
                <Check size={15} />{busy ? "Salvando…" : "Confirmar retirada"}
              </button>
            )}
          </div>
        </div>
      ) : (
        <div className="mt-4 rounded-xl bg-white p-4 text-sm font-semibold text-[#24272d]">Rota concluída. Todas as paradas foram finalizadas.</div>
      )}

      <ol className="mt-4 space-y-2" aria-label="Sequência fixa da rota">
        {route.stops.map((stop) => (
          <li key={stop.id} className="flex items-start gap-3 rounded-lg bg-white/10 px-3 py-2">
            <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-white text-xs font-bold text-primary">
              {stop.status === "DONE" ? <Check size={13} /> : stop.sequence}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-xs font-semibold">{stop.sequence}. {stop.kind === "pickup" ? "Retirada" : "Entrega"} · {stop.code}</span>
              <span className="mt-0.5 block truncate text-[11px] text-white/75">{stop.address}</span>
            </span>
          </li>
        ))}
      </ol>
    </article>
  );
}
