import { useEffect, useRef, useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@clerk/react";
import { App as CapacitorApp } from "@capacitor/app";
import { Capacitor, CapacitorHttp, registerPlugin } from "@capacitor/core";
import type { PluginListenerHandle } from "@capacitor/core";
import { Network } from "@capacitor/network";
import { Preferences } from "@capacitor/preferences";
import {
  type BackgroundGeolocationPlugin,
  type CallbackError,
  type Location as NativeLocation,
} from "@capacitor-community/background-geolocation";
import {
  getGetCourierEarningsQueryKey,
  getListCourierRoutesQueryKey,
  getListDeliveriesQueryKey,
  useAcceptCourierRoute,
  useCompleteCourierRouteStop,
  useRecordCourierStopArrival,
  useUpdateCourierLocation,
  type CourierLocationInput,
  type CourierDeliveryRoute,
  type Delivery,
} from "@workspace/api-client-react";
import { Check, CheckCircle2, Clock3, LoaderCircle, Map, MapPin, Navigation, PackageCheck, RefreshCw, Route as RouteIcon } from "lucide-react";
import type { MapCoordinate } from "@/components/live-map";
import EvidencePhotoAction from "@/components/evidence-photo-action";
import CourierUnableToDeliverAction from "@/components/courier-unable-to-deliver-action";
import { triggerCourierLightHaptic } from "@/lib/courier-haptics";

const money = (amount: number) =>
  amount.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const nativeApiBaseUrl = (
  import.meta.env.VITE_NATIVE_API_BASE_URL || "https://minas-mais-entregas.replit.app"
).replace(/\/+$/, "");
const BackgroundGeolocation = registerPlugin<BackgroundGeolocationPlugin>("BackgroundGeolocation");

export type CourierGpsStatus = {
  tone: "green" | "yellow" | "red";
  ageSeconds: number;
  accuracyMeters: number | null;
  locationMessage: string;
  hasSent: boolean;
};

function distanceInMeters(
  first: Pick<CourierLocationInput, "latitude" | "longitude"> | null,
  second: Pick<CourierLocationInput, "latitude" | "longitude">,
) {
  if (!first) return Number.POSITIVE_INFINITY;
  const radians = (degrees: number) => (degrees * Math.PI) / 180;
  const latitudeDelta = radians(second.latitude - first.latitude);
  const longitudeDelta = radians(second.longitude - first.longitude);
  const a =
    Math.sin(latitudeDelta / 2) ** 2 +
    Math.cos(radians(first.latitude)) *
      Math.cos(radians(second.latitude)) *
      Math.sin(longitudeDelta / 2) ** 2;
  return 6_371_000 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

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
  courierId,
  routes,
  deliveries,
  isLoading,
  isError,
  onRetry,
  onShowMap,
  onCurrentPositionChange,
  onGpsStatusChange,
  renderIndividualDelivery,
}: {
  courierId: string;
  routes: CourierDeliveryRoute[];
  deliveries: Delivery[];
  isLoading: boolean;
  isError: boolean;
  onRetry: () => void;
  onShowMap: () => void;
  onCurrentPositionChange: (position: MapCoordinate) => void;
  onGpsStatusChange: (status: CourierGpsStatus, refresh: () => void) => void;
  renderIndividualDelivery: (delivery: Delivery) => ReactNode;
}) {
  const queryClient = useQueryClient();
  const acceptRoute = useAcceptCourierRoute();
  const completeStop = useCompleteCourierRouteStop();
  const recordArrival = useRecordCourierStopArrival();
  const updateLocation = useUpdateCourierLocation();
  const { getToken } = useAuth();
  const getTokenRef = useRef(getToken);
  getTokenRef.current = getToken;
  const updateLocationRef = useRef(updateLocation.mutateAsync);
  updateLocationRef.current = updateLocation.mutateAsync;
  const onCurrentPositionChangeRef = useRef(onCurrentPositionChange);
  onCurrentPositionChangeRef.current = onCurrentPositionChange;
  const [busyRouteId, setBusyRouteId] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState("");
  const [locationMessage, setLocationMessage] = useState("");
  const [gpsAccuracy, setGpsAccuracy] = useState<number | null>(null);
  const [lastGpsSentAt, setLastGpsSentAt] = useState<number | null>(null);
  const [gpsClock, setGpsClock] = useState(Date.now());
  const gpsStartedAt = useRef(Date.now());
  const gpsRefreshRef = useRef<() => void>(() => undefined);
  const [arrivedStoreStopId, setArrivedStoreStopId] = useState<string | null>(null);
  const activeRoute = routes.find((route) => route.status === "ACCEPTED");
  const offeredRoutes = routes.filter((route) => route.status === "OFFERED");

  useEffect(() => {
    if (Capacitor.isNativePlatform()) {
      let watching = true;
      let watcherId: string | null = null;
      let networkListener: PluginListenerHandle | null = null;
      let appStateListener: PluginListenerHandle | null = null;
      let gpsClockInterval = 0;
      let lastDisplayedAt = 0;
      let lastQueuedAt = 0;
      let lastQueuedPosition: CourierLocationInput | null = null;
      let flushing = false;
      let queueWrite = Promise.resolve();
      const queueKey = `courier-location-queue:${courierId}`;

      const readQueue = async (): Promise<CourierLocationInput[]> => {
        const { value } = await Preferences.get({ key: queueKey });
        if (!value) return [];
        try {
          const parsed: unknown = JSON.parse(value);
          return Array.isArray(parsed) ? (parsed as CourierLocationInput[]) : [];
        } catch {
          await Preferences.remove({ key: queueKey });
          return [];
        }
      };
      const writeQueue = (items: CourierLocationInput[]) =>
        Preferences.set({ key: queueKey, value: JSON.stringify(items.slice(-1000)) });
      const enqueue = (position: CourierLocationInput) => {
        queueWrite = queueWrite.then(async () => {
          const items = await readQueue();
          items.push(position);
          await writeQueue(items);
        });
        return queueWrite;
      };
      const sendNativeLocation = async (position: CourierLocationInput) => {
        const token = await getTokenRef.current();
        if (!token) throw new Error("A sessão expirou. Entre novamente para enviar a localização.");
        const response = await CapacitorHttp.post({
          url: `${nativeApiBaseUrl}/api/courier/location`,
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
            Accept: "application/json",
          },
          data: position,
        });
        if (response.status < 200 || response.status >= 300) {
          throw new Error(`A central respondeu com o código ${response.status}.`);
        }
      };
      const flushQueue = async () => {
        if (!watching || flushing) return;
        flushing = true;
        try {
          while (watching) {
            const items = await readQueue();
            const next = items[0];
            if (!next) break;
            await sendNativeLocation(next);
            const remaining = await readQueue();
            if (
              remaining[0]?.measuredAt === next.measuredAt &&
              remaining[0]?.latitude === next.latitude &&
              remaining[0]?.longitude === next.longitude
            ) {
              remaining.shift();
              await writeQueue(remaining);
            }
            setLocationMessage("");
            setLastGpsSentAt(Date.now());
          }
        } catch {
          if (watching) {
            setLocationMessage("Sem conexão com a central. A localização ficará salva e será reenviada quando a internet voltar.");
          }
        } finally {
          flushing = false;
        }
      };
      const onNativePosition = (location?: NativeLocation, error?: CallbackError) => {
        if (!watching) return;
        if (error) {
          setLocationMessage(
            error.code === "NOT_AUTHORIZED"
              ? "Localização bloqueada. Permita “o tempo todo” nas configurações do Android."
              : "Aguardando uma posição GPS válida.",
          );
          return;
        }
        if (!location || location.latitude == null || location.longitude == null) return;
        const position: CourierLocationInput = {
          latitude: location.latitude,
          longitude: location.longitude,
          accuracyMeters: location.accuracy,
          speedMetersPerSecond: location.speed,
          measuredAt: new Date(location.time ?? Date.now()).toISOString(),
        };
        const now = Date.now();
        setGpsAccuracy(position.accuracyMeters ?? null);
        if (now - lastDisplayedAt >= 5_000) {
          onCurrentPositionChangeRef.current({
            latitude: position.latitude,
            longitude: position.longitude,
          });
          lastDisplayedAt = now;
        }
        const movedMeters = distanceInMeters(lastQueuedPosition, position);
        if (lastQueuedAt && now - lastQueuedAt < 15_000 && movedMeters < 30) return;

        lastQueuedAt = now;
        lastQueuedPosition = position;
        void enqueue(position)
          .then(() => flushQueue())
          .catch(() => {
            if (watching) setLocationMessage("Não foi possível salvar a localização para reenvio.");
          });
      };

      gpsRefreshRef.current = () => {
        void requestCurrentLocation()
          .then(async (position) => {
            setGpsAccuracy(position.accuracyMeters ?? null);
            onCurrentPositionChangeRef.current({
              latitude: position.latitude,
              longitude: position.longitude,
            });
            try {
              await sendNativeLocation(position);
              setLastGpsSentAt(Date.now());
              setLocationMessage("");
            } catch (error) {
              setLocationMessage(error instanceof Error ? error.message : "Não foi possível atualizar o GPS.");
            }
          })
          .catch((error: unknown) => {
            setLocationMessage(error instanceof Error ? error.message : "Não foi possível obter a localização.");
          });
      };
      gpsClockInterval = window.setInterval(() => setGpsClock(Date.now()), 5_000);
      setLocationMessage("Ative o rastreamento para compartilhar o GPS em segundo plano.");
      void BackgroundGeolocation.addWatcher(
        {
          backgroundTitle: "Minas Mais Entregas",
          backgroundMessage: "Rastreando sua entrega",
          requestPermissions: false,
          stale: false,
          distanceFilter: 0,
        },
        onNativePosition,
      )
        .then((id) => {
          if (!watching) {
            void BackgroundGeolocation.removeWatcher({ id });
            return;
          }
          watcherId = id;
          setLocationMessage("GPS ativo em segundo plano. O Android exibirá o aviso de rastreamento.");
          void flushQueue();
        })
        .catch((error: unknown) => {
          if (watching) {
            setLocationMessage(
              error instanceof Error
                ? `Não foi possível iniciar o GPS: ${error.message}`
                : "Não foi possível iniciar o GPS em segundo plano.",
            );
          }
        });

      void Network.addListener("networkStatusChange", ({ connected }) => {
        if (connected) void flushQueue();
      }).then((listener) => {
        if (watching) networkListener = listener;
        else void listener.remove();
      });
      void CapacitorApp.addListener("appStateChange", ({ isActive }) => {
        if (isActive) void flushQueue();
      }).then((listener) => {
        if (watching) appStateListener = listener;
        else void listener.remove();
      });

      return () => {
        watching = false;
        gpsRefreshRef.current = () => undefined;
        window.clearInterval(gpsClockInterval);
        if (watcherId) void BackgroundGeolocation.removeWatcher({ id: watcherId });
        void networkListener?.remove();
        void appStateListener?.remove();
      };
    }

    if (!navigator.geolocation) {
      setLocationMessage("Este navegador não oferece localização GPS.");
      const gpsClockInterval = window.setInterval(() => setGpsClock(Date.now()), 5_000);
      return () => window.clearInterval(gpsClockInterval);
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
        setGpsAccuracy(position.accuracyMeters);
        if (now - lastDisplayedAt >= 5_000) {
          const coordinate = { latitude: position.latitude, longitude: position.longitude };
          onCurrentPositionChangeRef.current(coordinate);
          lastDisplayedAt = now;
        }
        if (sending || now - lastSentAt < 15_000) return;
        lastSentAt = now;
        sending = true;
        void updateLocationRef.current({ data: position })
          .then(() => {
            if (watching) {
              setLocationMessage("");
              setLastGpsSentAt(Date.now());
            }
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
    gpsRefreshRef.current = requestCurrentPosition;
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
    const gpsClockInterval = window.setInterval(() => setGpsClock(Date.now()), 5_000);
    document.addEventListener("visibilitychange", onVisibilityChange);
    void acquireWakeLock();
    setLocationMessage("Compartilhando GPS a cada 15 segundos enquanto você estiver conectado. Mantenha o PWA aberto.");
    return () => {
      watching = false;
      gpsRefreshRef.current = () => undefined;
      navigator.geolocation.clearWatch(watchId);
      window.clearInterval(heartbeat);
      window.clearInterval(gpsClockInterval);
      document.removeEventListener("visibilitychange", onVisibilityChange);
      if (wakeLock) void wakeLock.release();
    };
  }, [courierId]);
  const gpsAgeSeconds = lastGpsSentAt == null
    ? Math.max(0, Math.floor((gpsClock - gpsStartedAt.current) / 1000))
    : Math.max(0, Math.floor((gpsClock - lastGpsSentAt) / 1000));
  const gpsTone =
    gpsAgeSeconds > 60
      ? "red"
      : lastGpsSentAt == null || (gpsAccuracy ?? 0) > 50
        ? "yellow"
        : "green";
  useEffect(() => {
    onGpsStatusChange(
      {
        tone: gpsTone,
        ageSeconds: gpsAgeSeconds,
        accuracyMeters: gpsAccuracy,
        locationMessage,
        hasSent: lastGpsSentAt != null,
      },
      () => gpsRefreshRef.current(),
    );
  }, [gpsTone, gpsAgeSeconds, gpsAccuracy, lastGpsSentAt, locationMessage, onGpsStatusChange]);

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
      void triggerCourierLightHaptic();
      await refreshRouteData();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Não foi possível aceitar a rota.");
    } finally {
      setBusyRouteId(null);
    }
  };

  const handleCompleteStop = async (routeId: string, stopId: string, evidencePath?: string) => {
    setErrorMessage("");
    setBusyRouteId(routeId);
    try {
      const stop = routes.find((route) => route.id === routeId)?.stops.find((item) => item.id === stopId);
      await completeStop.mutateAsync({ routeId, stopId, data: evidencePath ? { evidencePath } : {} });
      if (stop?.kind === "delivery") void triggerCourierLightHaptic();
      await refreshRouteData();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Não foi possível concluir esta parada.");
    } finally {
      setBusyRouteId(null);
    }
  };

  const handleStoreArrival = async (routeId: string, stopId: string) => {
    setErrorMessage("");
    setBusyRouteId(routeId);
    try {
      await recordArrival.mutateAsync({ routeId, stopId });
      setArrivedStoreStopId(stopId);
      await refreshRouteData();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Não foi possível registrar a chegada à loja.");
    } finally {
      setBusyRouteId(null);
    }
  };

  const availableRoutes = activeRoute ? [activeRoute] : offeredRoutes;
  const activeDeliveryStatuses = new Set([
    "OFFERED",
    "AWAITING_COURIER",
    "ACCEPTED",
    "TO_STORE",
    "AT_STORE",
    "IN_TRANSIT",
    "RETURNING_TO_STORE",
  ]);
  const priorityByStatus: Record<string, number> = {
    IN_TRANSIT: 0,
    AT_STORE: 1,
    TO_STORE: 2,
    ACCEPTED: 3,
    RETURNING_TO_STORE: 4,
    OFFERED: 5,
    AWAITING_COURIER: 5,
  };
  const workItems = [
    ...availableRoutes.map((route) => ({
      kind: "route" as const,
      route,
      priority: priorityByStatus[route.status] ?? 8,
    })),
    ...deliveries
      .filter((delivery) => activeDeliveryStatuses.has(delivery.status))
      .map((delivery) => ({
        kind: "delivery" as const,
        delivery,
        priority: priorityByStatus[delivery.status] ?? 8,
      })),
  ].sort((first, second) => first.priority - second.priority);
  return (
    <section className="mt-4 space-y-3" aria-label="Entregas e rotas">
      {errorMessage && <div role="alert" className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">{errorMessage}</div>}

      {isLoading ? (
        <div className="panel p-5 text-sm text-muted-foreground">Carregando suas entregas…</div>
      ) : isError ? (
        <div className="panel p-5">
          <p className="text-sm text-red-700">Não foi possível carregar suas entregas.</p>
          <button className="button-secondary mt-3" type="button" onClick={onRetry}>Tentar novamente</button>
        </div>
      ) : workItems.length === 0 ? (
        <div className="panel flex min-h-28 items-center gap-4 p-5" role="status">
          <span className="grid h-12 w-12 shrink-0 place-items-center rounded-full bg-green-50 text-green-700">
            <CheckCircle2 size={23} />
          </span>
          <div>
            <span className="text-[10px] font-bold uppercase tracking-[.12em] text-green-700">Disponível</span>
            <h2 className="mt-1 text-base font-bold">Você está disponível</h2>
            <p className="mt-0.5 text-sm text-muted-foreground">Aguardando novas entregas</p>
          </div>
        </div>
      ) : (
        <>
          <div className="flex items-end justify-between">
            <div>
              <div className="eyebrow">SUA PRÓXIMA PARADA</div>
              <h2 className="mt-1 text-lg font-bold">Entregas</h2>
            </div>
            <button className="button-quiet min-h-12" type="button" onClick={onRetry} aria-label="Atualizar entregas">
              <RefreshCw size={15} /> Atualizar
            </button>
          </div>
          <div className="space-y-3">
            {workItems.map((item) => item.kind === "delivery" ? (
              <div key={item.delivery.id}>{renderIndividualDelivery(item.delivery)}</div>
            ) : item.route.status === "ACCEPTED" ? (
              <ActiveRouteCard
                key={item.route.id}
                route={item.route}
                busy={busyRouteId === item.route.id}
                locationMessage={locationMessage}
                arrivedStoreStopId={arrivedStoreStopId}
                onShowMap={onShowMap}
                onArrive={(stopId) => void handleStoreArrival(item.route.id, stopId)}
                onComplete={(stopId, evidencePath) => void handleCompleteStop(item.route.id, stopId, evidencePath)}
              />
            ) : (
              <article key={item.route.id} className="panel p-4 sm:p-5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2 text-sm font-bold"><RouteIcon size={17} className="text-primary" />{item.route.deliveryCount} {item.route.deliveryCount === 1 ? "entrega" : "entregas"}</div>
                    <p className="mt-1 text-xs text-muted-foreground">A sequência otimizada será travada quando você aceitar.</p>
                  </div>
                  <div className="text-right">
                    <div className="eyebrow">TOTAL PREVISTO</div>
                    <div className="mt-1 text-lg font-bold text-primary">{money(item.route.amountToReceive)}</div>
                  </div>
                </div>
                <div className="mt-4 divide-y divide-border border-y border-border">
                  {item.route.deliveries.map((delivery) => (
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
                  className="button-primary mt-4 min-h-12 w-full justify-center"
                  type="button"
                  disabled={busyRouteId !== null}
                  onClick={() => void handleAccept(item.route)}
                  aria-busy={busyRouteId === item.route.id}
                >
                  {busyRouteId === item.route.id
                    ? <><LoaderCircle size={16} className="animate-spin" /> Calculando melhor rota…</>
                    : <><Navigation size={16} /> Aceitar e calcular rota</>}
                </button>
                <p className="mt-2 text-center text-[11px] text-muted-foreground" role={busyRouteId !== null ? "status" : undefined}>
                  {busyRouteId !== null
                    ? "Aguarde a ação atual terminar para evitar envio duplicado."
                    : "O navegador pedirá sua localização para ordenar as paradas a partir de onde você está."}
                </p>
              </article>
            ))}
          </div>
        </>
      )}
    </section>
  );
}

function ActiveRouteCard({
  route,
  busy,
  locationMessage,
  arrivedStoreStopId,
  onShowMap,
  onArrive,
  onComplete,
}: {
  route: CourierDeliveryRoute;
  busy: boolean;
  locationMessage: string;
  arrivedStoreStopId: string | null;
  onShowMap: () => void;
  onArrive: (stopId: string) => void;
  onComplete: (stopId: string, evidencePath?: string) => void;
}) {
  const completedStops = route.stops.filter((stop) => stop.status === "DONE").length;
  const nextStop = route.stops.find((stop) => stop.status === "PENDING");
  const hasArrivedAtNextStore = Boolean(nextStop && nextStop.id === arrivedStoreStopId);
  const progress = route.stops.length ? Math.round((completedStops / route.stops.length) * 100) : 0;

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
        <button
          className="button-outlined mt-4 min-h-12 w-full justify-center"
        type="button"
        onClick={onShowMap}
      >
        <Map size={15} /> Abrir mapa da rota
      </button>

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
              className="button-outlined min-h-12 justify-center"
              href={`https://www.google.com/maps/dir/?api=1&destination=${nextStop.latitude},${nextStop.longitude}&travelmode=driving`}
              target="_blank"
              rel="noreferrer"
            >
              <Navigation size={15} /> Navegar
            </a>
            {nextStop.kind === "delivery" ? (
              <>
                <EvidencePhotoAction
                  deliveryId={nextStop.deliveryId}
                  disabled={busy}
                  label="Enviar foto e concluir entrega"
                  onComplete={async (evidencePath) => onComplete(nextStop.id, evidencePath)}
                />
                <CourierUnableToDeliverAction
                  deliveryId={nextStop.deliveryId}
                  disabled={busy}
                  className="sm:col-span-2"
                />
              </>
            ) : !hasArrivedAtNextStore ? (
              <button
                className="button-primary min-h-12 justify-center"
                type="button"
                disabled={busy}
                onClick={() => onArrive(nextStop.id)}
                aria-busy={busy}
              >
                {busy
                  ? <><LoaderCircle size={15} className="animate-spin" /> Registrando chegada…</>
                  : <><MapPin size={15} /> Registrar chegada à loja</>}
              </button>
            ) : (
              <button
                className="button-primary min-h-12 justify-center"
                type="button"
                disabled={busy}
                onClick={() => onComplete(nextStop.id)}
                aria-busy={busy}
              >
                {busy
                  ? <><LoaderCircle size={15} className="animate-spin" /> Confirmando saída…</>
                  : <><Check size={15} /> Confirmar saída da loja</>}
              </button>
            )}
          </div>
          {busy && (
            <p className="mt-2 text-xs text-muted-foreground" role="status">
              Aguarde a confirmação para evitar registrar a ação novamente.
            </p>
          )}
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
