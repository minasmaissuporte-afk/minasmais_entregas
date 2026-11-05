import { useQueryClient } from "@tanstack/react-query";
import {
  getGetCourierDeliveryNavigationQueryKey,
  getGetCourierEarningsQueryKey,
  getListCourierRoutesQueryKey,
  getListDeliveriesQueryKey,
  getGetVapidPublicKeyQueryKey,
  useGetVapidPublicKey,
  useSavePushSubscription,
  useRemovePushSubscription,
  useGetCourierEarnings,
  useListCourierRoutes,
  useListDeliveries,
  useUpdateDeliveryStatus,
  useUpdateCourierLocation,
  type AppUser,
  type CourierDeliveryRoute,
} from "@workspace/api-client-react";
import { useClerk } from "@clerk/react";
import { Capacitor } from "@capacitor/core";
import { ArrowLeft, Bike, CheckCircle2, Clock3, KeyRound, LogOut, Map as MapIcon, PackageCheck, Bell, BellOff } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Link } from "wouter";
import CourierDeliveryNavigation from "@/components/courier-delivery-navigation";
import CourierRouteMapTab from "@/components/courier-route-map-tab";
import CourierRoutesSection from "@/pages/courier-routes-section";
import EvidencePhotoAction from "@/components/evidence-photo-action";
import CourierUnableToDeliverAction from "@/components/courier-unable-to-deliver-action";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { MapCoordinate } from "@/components/live-map";

type Period = "day" | "week" | "month";
const isNativeApp = Capacitor.isNativePlatform();
const periodNames: Record<Period, string> = {
  day: "Hoje",
  week: "Esta semana",
  month: "Este mês",
};
const nextCourierStatus: Record<string, string> = {
  OFFERED: "ACCEPTED",
  ACCEPTED: "TO_STORE",
  TO_STORE: "AT_STORE",
  AT_STORE: "IN_TRANSIT",
  IN_TRANSIT: "COMPLETED",
};
const nextStatusLabel: Record<string, string> = {
  OFFERED: "Aceitar entrega",
  ACCEPTED: "Iniciar ida à loja",
  TO_STORE: "Confirmar chegada à loja",
  AT_STORE: "Confirmar saída para entrega",
  IN_TRANSIT: "Confirmar entrega concluída",
};
const statusLabel: Record<string, string> = {
  OFFERED: "Oferta enviada",
  AWAITING_COURIER: "Aguardando motoboy",
  ACCEPTED: "Aceita",
  TO_STORE: "A caminho da unidade",
  AT_STORE: "Na unidade",
  IN_TRANSIT: "Em entrega",
  COMPLETED: "Concluída",
  RETURNING_TO_STORE: "Retornando à filial",
  NOT_DELIVERED: "Não entregue",
};
const money = (amount: number) =>
  amount.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const base64 = base64String.replace(/-/g, "+").replace(/_/g, "/");
  const padded = `${base64}${"=".repeat((4 - (base64.length % 4)) % 4)}`;
  const raw = window.atob(padded);
  const bytes = Uint8Array.from(raw, (character) => character.charCodeAt(0));
  if (bytes.length !== 65 || bytes[0] !== 0x04) {
    throw new Error("A chave pública VAPID recebida não é P-256 válida.");
  }
  return bytes;
}

function subscriptionUsesVapidKey(
  subscription: PushSubscription,
  expectedKey: Uint8Array,
): boolean {
  const currentKey = subscription.options.applicationServerKey;
  if (!currentKey) return false;
  const currentBytes = new Uint8Array(currentKey);
  return (
    currentBytes.length === expectedKey.length &&
    currentBytes.every((byte, index) => byte === expectedKey[index])
  );
}

export default function CourierPortal({ profile }: { profile: AppUser }) {
  const { signOut } = useClerk();
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState<"deliveries" | "map">("deliveries");
  const [currentPosition, setCurrentPosition] = useState<MapCoordinate | null>(null);
  const [period, setPeriod] = useState<Period>("day");
  const [actionError, setActionError] = useState("");
  const [pushMessage, setPushMessage] = useState("");
  const [pushSubscription, setPushSubscription] = useState<PushSubscription | null>(null);
  const [serviceWorkerStatus, setServiceWorkerStatus] = useState<
    "checking" | "active" | "missing" | "unsupported"
  >("checking");
  const earnings = useGetCourierEarnings(
    { period },
    { query: { queryKey: getGetCourierEarningsQueryKey({ period }), refetchInterval: 15000 } },
  );
  const deliveries = useListDeliveries(
    {},
    { query: { queryKey: getListDeliveriesQueryKey(), refetchInterval: 15000 } },
  );
  const routes = useListCourierRoutes({
    query: {
      queryKey: getListCourierRoutesQueryKey(),
      refetchInterval: 15000,
      refetchOnWindowFocus: true,
    },
  });
  const updateStatus = useUpdateDeliveryStatus();
  const updateLocation = useUpdateCourierLocation();
  const pushKey = useGetVapidPublicKey({
    query: {
      queryKey: getGetVapidPublicKeyQueryKey(),
      retry: false,
      enabled: !isNativeApp,
    },
  });
  const savePush = useSavePushSubscription();
  const removePush = useRemovePushSubscription();
  const currentVapidBytes = useMemo(() => {
    if (!pushKey.data?.publicKey) return null;
    try {
      return urlBase64ToUint8Array(pushKey.data.publicKey);
    } catch {
      return null;
    }
  }, [pushKey.data?.publicKey]);
  const pushIsActive = Boolean(
    pushSubscription &&
      currentVapidBytes &&
      subscriptionUsesVapidKey(pushSubscription, currentVapidBytes),
  );
  useEffect(() => {
    if (isNativeApp) {
      setServiceWorkerStatus("unsupported");
      setPushMessage("Avisos remotos do APK precisam de configuração Firebase/FCM. O aviso persistente de rastreamento continua ativo.");
      return;
    }
    if (!("serviceWorker" in navigator)) {
      setServiceWorkerStatus("unsupported");
      return;
    }
    let cancelled = false;
    const timeoutId = window.setTimeout(() => {
      if (!cancelled) setServiceWorkerStatus("missing");
    }, 5000);
    void navigator.serviceWorker.ready
      .then(async (registration) => {
        window.clearTimeout(timeoutId);
        if (cancelled) return;
        if (!registration.active) {
          setServiceWorkerStatus("missing");
          return;
        }
        setServiceWorkerStatus("active");
        const subscription = await registration.pushManager.getSubscription();
        if (!cancelled) setPushSubscription(subscription);
      })
      .catch(() => {
        window.clearTimeout(timeoutId);
        if (!cancelled) setServiceWorkerStatus("missing");
      });
    return () => {
      cancelled = true;
      window.clearTimeout(timeoutId);
    };
  }, []);
  const togglePush = async () => {
    setPushMessage("");
    if (isNativeApp) {
      setPushMessage("Avisos remotos do APK precisam de configuração Firebase/FCM.");
      return;
    }
    if (!pushKey.data?.publicKey || !currentVapidBytes) {
      setPushMessage("A chave VAPID não está disponível ou é inválida. Confira os Secrets e a configuração do servidor.");
      return;
    }
    try {
      if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
        throw new Error("Este navegador não oferece notificações push.");
      }
      const registration = await navigator.serviceWorker.ready;
      if (!registration.active) {
        throw new Error("O Service Worker do PWA não está ativo. Feche e reabra o aplicativo.");
      }
      let subscription = await registration.pushManager.getSubscription();
      const matchesCurrentKey = Boolean(
        subscription && subscriptionUsesVapidKey(subscription, currentVapidBytes),
      );

      if (subscription && matchesCurrentKey && pushIsActive) {
        const json = subscription.toJSON();
        if (!json.endpoint || !json.keys?.p256dh || !json.keys.auth) {
          throw new Error("A assinatura atual não contém as chaves necessárias.");
        }
        await removePush.mutateAsync({
          data: { endpoint: json.endpoint, p256dh: json.keys.p256dh, auth: json.keys.auth },
        });
        await subscription.unsubscribe();
        setPushSubscription(null);
        setPushMessage("Notificações desativadas neste aparelho.");
        await queryClient.invalidateQueries({ queryKey: getGetVapidPublicKeyQueryKey() });
        return;
      }

      if (subscription && !matchesCurrentKey) {
        const old = subscription.toJSON();
        if (old.endpoint && old.keys?.p256dh && old.keys.auth) {
          await removePush.mutateAsync({
            data: { endpoint: old.endpoint, p256dh: old.keys.p256dh, auth: old.keys.auth },
          });
        }
        await subscription.unsubscribe();
        subscription = null;
        setPushSubscription(null);
      }

      if (!("Notification" in window)) {
        throw new Error("Este navegador não oferece notificações.");
      }
      let permission = Notification.permission;
      if (permission !== "granted") permission = await Notification.requestPermission();
      if (permission !== "granted") {
        throw new Error("Permita notificações nas configurações do navegador para ativar os avisos.");
      }

      // Recheck immediately before subscribing so a rotated key never reuses an old subscription.
      subscription = await registration.pushManager.getSubscription();
      if (subscription && !subscriptionUsesVapidKey(subscription, currentVapidBytes)) {
        await subscription.unsubscribe();
        subscription = null;
      }
      if (!subscription) {
        subscription = await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: currentVapidBytes.buffer as ArrayBuffer,
        });
      }
      const json = subscription.toJSON();
      if (!json.endpoint || !json.keys?.p256dh || !json.keys.auth) {
        throw new Error("Não foi possível obter os dados da assinatura.");
      }
      await savePush.mutateAsync({
        data: { endpoint: json.endpoint, p256dh: json.keys.p256dh, auth: json.keys.auth },
      });
      setPushSubscription(subscription);
      setPushMessage("Notificações ativadas neste aparelho.");
      await queryClient.invalidateQueries({ queryKey: getGetVapidPublicKeyQueryKey() });
    } catch (error) {
      setPushMessage(error instanceof Error ? error.message : "Não foi possível atualizar as notificações.");
    }
  };
  const groupedDeliveryIds = useMemo(
    () => new Set((routes.data ?? []).flatMap((route) => route.deliveries.map((delivery) => delivery.id))),
    [routes.data],
  );
  const individualDeliveries = useMemo(
    () => (routes.isLoading ? [] : (deliveries.data ?? []).filter((delivery) => !groupedDeliveryIds.has(delivery.id))),
    [deliveries.data, groupedDeliveryIds, routes.isLoading],
  );
  const activeRoute = useMemo(
    () => (routes.data ?? []).find((route) => route.status === "ACCEPTED") ?? null,
    [routes.data],
  );
  const activeIndividualDelivery = useMemo(
    () =>
      individualDeliveries.find((delivery) =>
        ["ACCEPTED", "TO_STORE", "AT_STORE", "IN_TRANSIT"].includes(delivery.status),
      ) ??
      individualDeliveries.find((delivery) => delivery.status === "RETURNING_TO_STORE") ??
      null,
    [individualDeliveries],
  );
  const activeRouteDelivery = useMemo(() => {
    if (!activeRoute) return null;
    const nextStop = activeRoute.stops.find((stop) => stop.status === "PENDING");
    return (
      activeRoute.deliveries.find(
        (delivery) =>
          delivery.id === nextStop?.deliveryId &&
          ["ACCEPTED", "IN_TRANSIT"].includes(delivery.status),
      ) ??
      activeRoute.deliveries.find((delivery) =>
        ["ACCEPTED", "IN_TRANSIT"].includes(delivery.status),
      ) ??
      null
    );
  }, [activeRoute]);
  const returningDeliveries = useMemo(
    () =>
      individualDeliveries.filter((delivery) => delivery.status === "RETURNING_TO_STORE"),
    [individualDeliveries],
  );
  const updateDelivery = async (deliveryId: string, status: string, evidencePath?: string) => {
    setActionError("");
    if (["ACCEPTED", "TO_STORE", "IN_TRANSIT"].includes(status) && navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        ({ coords, timestamp }) => {
          updateLocation.mutate({
            data: {
              latitude: coords.latitude,
              longitude: coords.longitude,
              accuracyMeters: coords.accuracy,
              speedMetersPerSecond: coords.speed,
              measuredAt: new Date(timestamp).toISOString(),
            },
          });
        },
        () => undefined,
        { enableHighAccuracy: true, maximumAge: 0, timeout: 15_000 },
      );
    }
    try {
      await updateStatus.mutateAsync({
        deliveryId,
        data: {
          status: status as "ACCEPTED" | "TO_STORE" | "AT_STORE" | "IN_TRANSIT" | "COMPLETED" | "CANCELLED",
          ...(evidencePath ? { evidencePath } : {}),
        },
      });
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: getListDeliveriesQueryKey() }),
        queryClient.invalidateQueries({ queryKey: getGetCourierEarningsQueryKey({ period }) }),
        queryClient.invalidateQueries({ queryKey: getGetCourierDeliveryNavigationQueryKey(deliveryId) }),
      ]);
    } catch {
      setActionError("Não foi possível atualizar esta entrega. Tente novamente.");
      throw new Error("Não foi possível concluir a entrega.");
    }
  };

  return (
    <main className={activeTab === "map" ? "courier-pwa fixed inset-0 z-40 bg-[#f4f3f1] text-[#24272d]" : "courier-pwa min-h-[100dvh] bg-[#f4f3f1] px-4 pb-10 pt-4 text-[#24272d] sm:px-6"}>
      <div className={activeTab === "map" ? "mx-auto h-full w-full" : "mx-auto max-w-2xl"}>
        {activeTab !== "map" && <header className="flex items-center justify-between rounded-xl border border-[#e7e6e3] bg-white px-4 py-3">
          <div className="flex items-center gap-3">
            <span className="brand-mark"><Bike size={18} /></span>
            <div>
              <div className="text-sm font-bold">Minas Mais</div>
              <div className="text-[11px] text-muted-foreground">Área do motoboy</div>
            </div>
          </div>
          <div className="flex items-center gap-1 sm:gap-2">
            <Link href="/account" className="button-secondary min-h-12 px-2 text-xs sm:px-3" aria-label="Alterar senha">
              <KeyRound size={14} /> Alterar senha
            </Link>
            <button
              className="button-quiet min-h-12 px-2 text-xs sm:px-3"
              onClick={() => void signOut({ redirectUrl: import.meta.env.BASE_URL })}
            >
              <LogOut size={15} /> Sair
            </button>
          </div>
        </header>}

        <Tabs
          value={activeTab}
          onValueChange={(value) => setActiveTab(value as "deliveries" | "map")}
        >
          {activeTab !== "map" && <TabsList className="mt-4 grid h-14 w-full grid-cols-2 rounded-xl border border-[#e7e6e3] bg-white p-1">
            <TabsTrigger value="deliveries" className="gap-2 rounded-lg text-sm">
              <PackageCheck size={16} /> Entregas
            </TabsTrigger>
            <TabsTrigger value="map" className="gap-2 rounded-lg text-sm">
              <MapIcon size={16} /> Mapa e rota
            </TabsTrigger>
          </TabsList>}
          <TabsContent
            value="deliveries"
            forceMount
            className={activeTab === "deliveries" ? "mt-4" : "hidden"}
          >
        {returningDeliveries.length > 0 && (
          <p className="mb-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm font-bold text-amber-950" role="status">
            {returningDeliveries.length} {returningDeliveries.length === 1 ? "produto para devolver" : "produtos para devolver"} na filial. A Central confirmará quando receber.
          </p>
        )}
        {(activeIndividualDelivery || activeRouteDelivery) && (
          <section className="panel mb-4 overflow-hidden border-l-4 border-l-[#a91d2a] p-4 sm:p-5" aria-label="Entrega ativa">
            {activeRouteDelivery ? (
              <>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="font-mono text-xs font-bold text-primary">{activeRouteDelivery.code}</div>
                    <h2 className="mt-1 text-lg font-bold">{activeRouteDelivery.customerName}</h2>
                    <p className="mt-1 text-sm text-muted-foreground">
                      Retirar em: {activeRouteDelivery.storeName}
                      {activeRouteDelivery.storeAddress ? ` · ${activeRouteDelivery.storeAddress}` : ""}
                    </p>
                  </div>
                  <span className="rounded-full bg-[#f3e8e9] px-3 py-1.5 text-xs font-bold text-primary">Rota ativa</span>
                </div>
                <p className="mt-3 text-sm leading-relaxed">{activeRouteDelivery.destination}</p>
                {activeRouteDelivery.notes && <p className="mt-2 rounded-lg bg-[#f6f4f1] p-3 text-xs">Observações: {activeRouteDelivery.notes}</p>}
                <div className="mt-3 flex flex-wrap gap-2">
                  {activeRouteDelivery.customerPhone && (
                    <>
                      <a className="button-secondary min-h-12" href={`tel:${activeRouteDelivery.customerPhone}`}>Telefone</a>
                      <a
                        className="button-secondary min-h-12"
                        href={`https://wa.me/${(() => {
                          const digits = activeRouteDelivery.customerPhone!.replace(/\D/g, "");
                          return digits.startsWith("55") ? digits : `55${digits}`;
                        })()}`}
                        target="_blank"
                        rel="noreferrer"
                      >
                        WhatsApp
                      </a>
                    </>
                  )}
                  <button type="button" className="button-secondary min-h-12" onClick={() => setActiveTab("map")}><MapIcon size={15} /> Ver rota</button>
                  <CourierUnableToDeliverAction deliveryId={activeRouteDelivery.id} />
                </div>
                <div className="mt-3 border-t border-border pt-3 text-sm font-bold">{money(activeRouteDelivery.deliveryAmount)}</div>
              </>
            ) : activeIndividualDelivery ? (
              <>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="font-mono text-xs font-bold text-primary">{activeIndividualDelivery.code}</div>
                    <h2 className="mt-1 text-lg font-bold">{activeIndividualDelivery.customerName}</h2>
                    <p className="mt-1 text-sm text-muted-foreground">
                      Retirar em: {activeIndividualDelivery.storeName}
                      {activeIndividualDelivery.storeAddress ? ` · ${activeIndividualDelivery.storeAddress}` : ""}
                    </p>
                  </div>
                  <span className="rounded-full bg-[#f3e8e9] px-3 py-1.5 text-xs font-bold text-primary">
                    {statusLabel[activeIndividualDelivery.status] ?? activeIndividualDelivery.status}
                  </span>
                </div>
                <p className="mt-3 text-sm leading-relaxed">{activeIndividualDelivery.destination}</p>
                {activeIndividualDelivery.notes && (
                  <p className="mt-2 rounded-lg bg-[#f6f4f1] p-3 text-xs leading-relaxed">
                    Observações: {activeIndividualDelivery.notes}
                  </p>
                )}
                {activeIndividualDelivery.status !== "RETURNING_TO_STORE" && (
                  <div className="mt-3 flex flex-wrap gap-2">
                    {activeIndividualDelivery.customerPhone && (
                      <>
                        <a className="button-secondary min-h-12" href={`tel:${activeIndividualDelivery.customerPhone}`}>
                          Telefone
                        </a>
                        <a
                          className="button-secondary min-h-12"
                          href={`https://wa.me/${(() => {
                            const digits = activeIndividualDelivery.customerPhone!.replace(/\D/g, "");
                            return digits.startsWith("55") ? digits : `55${digits}`;
                          })()}`}
                          target="_blank"
                          rel="noreferrer"
                        >
                          WhatsApp
                        </a>
                      </>
                    )}
                    <button type="button" className="button-secondary min-h-12" onClick={() => setActiveTab("map")}>
                      <MapIcon size={15} /> Ver rota
                    </button>
                  </div>
                )}
                <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-border pt-3">
                  <span className="text-sm font-bold">{money(activeIndividualDelivery.deliveryAmount)}</span>
                  {activeIndividualDelivery.status === "IN_TRANSIT" ? (
                    <div className="w-full space-y-2">
                      <EvidencePhotoAction
                        deliveryId={activeIndividualDelivery.id}
                        disabled={updateStatus.isPending}
                        onComplete={async (evidencePath) =>
                          updateDelivery(activeIndividualDelivery.id, "COMPLETED", evidencePath)
                        }
                      />
                      <CourierUnableToDeliverAction deliveryId={activeIndividualDelivery.id} />
                    </div>
                  ) : activeIndividualDelivery.status !== "RETURNING_TO_STORE" ? (
                    <div className="flex w-full flex-wrap gap-2">
                      {nextCourierStatus[activeIndividualDelivery.status] && (
                        <button
                          type="button"
                          className="button-primary min-h-12"
                          disabled={updateStatus.isPending}
                          onClick={() =>
                            updateDelivery(
                              activeIndividualDelivery.id,
                              nextCourierStatus[activeIndividualDelivery.status],
                            )
                          }
                        >
                          {updateStatus.isPending ? "Salvando…" : nextStatusLabel[activeIndividualDelivery.status]}
                        </button>
                      )}
                      <CourierUnableToDeliverAction deliveryId={activeIndividualDelivery.id} />
                    </div>
                  ) : null}
                </div>
              </>
            ) : null}
          </section>
        )}
        <section className="mt-5 rounded-2xl bg-[#a91d2a] p-5 text-white shadow-sm sm:p-6">
          <div className="text-xs text-white/75">Olá, {profile.name.split(" ")[0]}</div>
          <h1 className="mt-1 text-2xl font-bold tracking-tight">Seu resumo de entregas</h1>
          <div className="mt-5 flex flex-wrap gap-2" aria-label="Período do resumo">
            {(["day", "week", "month"] as const).map((option) => (
              <button
                key={option}
                className={`rounded-full px-3 py-1.5 text-xs font-semibold transition ${
                  period === option ? "bg-white text-[#a91d2a]" : "bg-white/15 text-white hover:bg-white/25"
                }`}
                aria-pressed={period === option}
                onClick={() => setPeriod(option)}
              >
                {periodNames[option]}
              </button>
            ))}
          </div>
          <div className="mt-5 grid grid-cols-2 gap-3">
            <div className="rounded-xl bg-white/10 p-4">
              <div className="flex items-center gap-2 text-xs text-white/75"><PackageCheck size={15} /> Entregas concluídas</div>
              <div className="mt-2 text-3xl font-bold tabular-nums">
                {earnings.isLoading ? "—" : earnings.data?.completedDeliveries ?? "—"}
              </div>
            </div>
            <div className="rounded-xl bg-white/10 p-4">
              <div className="flex items-center gap-2 text-xs text-white/75"><CheckCircle2 size={15} /> A receber</div>
              <div className="mt-2 text-2xl font-bold tabular-nums">
                {earnings.isLoading ? "—" : money(earnings.data?.amountToReceive ?? 0)}
              </div>
            </div>
          </div>
          <p className="mt-3 text-[11px] text-white/75">
            Valores de entregas concluídas em {periodNames[period].toLocaleLowerCase()}.
          </p>
        </section>

        <section className="panel mt-4 flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-3">
            <span className="metric-icon metric-icon-red mt-0.5">{pushIsActive ? <Bell size={16} /> : <BellOff size={16} />}</span>
            <div>
              <h2 className="text-sm font-bold">Avisos de novas entregas</h2>
              <p className="mt-1 text-xs text-muted-foreground">
                {isNativeApp
                  ? "Avisos remotos do APK precisam de Firebase/FCM. O rastreamento mantém uma notificação persistente."
                  : serviceWorkerStatus === "checking" || pushKey.isLoading
                  ? "Verificando Service Worker e chave VAPID…"
                  : serviceWorkerStatus === "unsupported"
                    ? "Este navegador não oferece Service Worker."
                    : serviceWorkerStatus === "missing"
                      ? "Service Worker não está ativo. Feche e reabra o PWA publicado."
                      : pushKey.isError || !currentVapidBytes
                        ? "Chave VAPID ausente ou inválida. Confira os Secrets da API."
                        : pushIsActive
                          ? "Notificações ativadas neste aparelho."
                          : pushSubscription
                            ? "A inscrição usa uma chave anterior e será substituída ao ativar."
                            : "Ative para receber avisos neste aparelho."}
              </p>
              {pushKey.isError && <button type="button" className="mt-1 text-xs font-semibold text-primary" onClick={() => void pushKey.refetch()}>Tentar consultar novamente</button>}
              {pushMessage && <p role="status" className="mt-2 text-xs text-[#8b3d45]">{pushMessage}</p>}
            </div>
          </div>
          <button
            type="button"
            className={pushIsActive ? "button-secondary min-h-10" : "button-primary min-h-10"}
            onClick={() => void togglePush()}
            disabled={
              isNativeApp ||
              pushKey.isLoading ||
              serviceWorkerStatus !== "active" ||
              savePush.isPending ||
              removePush.isPending ||
              !currentVapidBytes
            }
            data-testid="button-toggle-push"
          >
            {pushIsActive ? <BellOff size={15} /> : <Bell size={15} />}
            {isNativeApp
              ? "Push nativo pendente"
              : savePush.isPending || removePush.isPending
              ? "Atualizando…"
              : pushIsActive
                ? "Desativar notificações"
                : "Ativar notificações"}
          </button>
        </section>

        {earnings.isError && (
          <div className="mt-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
            Não foi possível consultar seu resumo financeiro.
          </div>
        )}
        {actionError && (
          <div className="mt-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
            {actionError}
          </div>
        )}

        <CourierRoutesSection
          courierId={profile.id}
          routes={routes.data ?? []}
          isLoading={routes.isLoading}
          isError={routes.isError}
          onRetry={() => void routes.refetch()}
          onShowMap={() => setActiveTab("map")}
          onCurrentPositionChange={setCurrentPosition}
        />

        <section className="mt-6">
          <div className="mb-3 flex items-end justify-between">
            <div>
              <div className="eyebrow">SUA OPERAÇÃO</div>
              <h2 className="mt-1 text-lg font-bold">Entregas atribuídas</h2>
            </div>
            <span className="text-xs text-muted-foreground">{individualDeliveries.length} {individualDeliveries.length === 1 ? "registro" : "registros"}</span>
          </div>
          {deliveries.isLoading || routes.isLoading ? (
            <div className="panel p-5 text-sm text-muted-foreground">Carregando suas entregas…</div>
          ) : deliveries.isError || routes.isError ? (
            <div className="panel p-5 text-sm text-red-700">Não foi possível carregar as entregas.</div>
          ) : individualDeliveries.length ? (
            <div className="space-y-3">
              {individualDeliveries.filter((delivery) => delivery.id !== activeIndividualDelivery?.id).map((delivery) => {
                const nextStatus = nextCourierStatus[delivery.status];
                return (
                  <article key={delivery.id} className="panel p-4 sm:p-5">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="font-mono text-xs font-semibold text-[#a91d2a]">{delivery.code}</div>
                        <h3 className="mt-1 text-sm font-bold">{delivery.storeName}</h3>
                        <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{delivery.destination}</p>
                      </div>
                      <span className="shrink-0 rounded-full bg-[#f6f4f1] px-2.5 py-1 text-[10px] font-semibold">
                        {statusLabel[delivery.status] ?? delivery.status}
                      </span>
                    </div>
                    {["ACCEPTED", "TO_STORE", "AT_STORE", "IN_TRANSIT"].includes(delivery.status) && (
                      <button
                        type="button"
                        className="button-secondary mt-3 min-h-12"
                        onClick={() => setActiveTab("map")}
                      >
                        <MapIcon size={14} /> Ver rota no mapa
                      </button>
                    )}
                    {delivery.status === "IN_TRANSIT" && nextStatus ? (
                      <div className="mt-3 space-y-3 border-t border-border pt-3">
                        <div className="text-sm font-semibold">{money(delivery.deliveryAmount)}</div>
                        <EvidencePhotoAction
                          deliveryId={delivery.id}
                          disabled={updateStatus.isPending}
                          onComplete={async (evidencePath) => updateDelivery(delivery.id, nextStatus, evidencePath)}
                        />
                      </div>
                    ) : (
                      <div className="mt-3 flex items-center justify-between gap-3 border-t border-border pt-3">
                        <span className="text-sm font-semibold">{money(delivery.deliveryAmount)}</span>
                        {nextStatus ? (
                          <button
                            className="button-primary min-h-12"
                            disabled={updateStatus.isPending}
                            onClick={() => updateDelivery(delivery.id, nextStatus)}
                          >
                            {updateStatus.isPending ? "Salvando…" : nextStatusLabel[delivery.status]}
                          </button>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-xs font-semibold text-green-700">
                            <CheckCircle2 size={14} /> Finalizada
                          </span>
                        )}
                      </div>
                    )}
                  </article>
                );
              })}
            </div>
          ) : (
            <div className="panel p-6 text-center">
              <Clock3 className="mx-auto text-muted-foreground" size={22} />
              <p className="mt-2 text-sm font-semibold">Nenhuma entrega atribuída</p>
              <p className="mt-1 text-xs text-muted-foreground">
                Ofertas individuais aparecem aqui. Rotas agrupadas ficam na seção acima.
              </p>
            </div>
          )}
        </section>
          </TabsContent>
          <TabsContent value="map" className="fixed inset-0 z-50 m-0 h-[100dvh] overflow-hidden">
            {activeRoute ? (
              <CourierRouteMapTab
                route={activeRoute}
                currentPosition={currentPosition}
                onBack={() => setActiveTab("deliveries")}
                onRefresh={() => void routes.refetch()}
                activeDelivery={activeRouteDelivery}
              />
            ) : activeIndividualDelivery ? (
              <CourierDeliveryNavigation
                deliveryId={activeIndividualDelivery.id}
                onBack={() => setActiveTab("deliveries")}
                delivery={activeIndividualDelivery}
              />
            ) : (
              <section className="grid h-full place-items-center p-6 text-center">
                <button
                  type="button"
                  className="absolute left-4 top-4 z-20 min-h-12 rounded-lg bg-white px-4 font-semibold shadow"
                  onClick={() => setActiveTab("deliveries")}
                >
                  <ArrowLeft size={15} className="mr-2 inline" /> Entregas
                </button>
                <div>
                <MapIcon className="mx-auto text-muted-foreground" size={24} />
                <h2 className="mt-3 text-base font-bold">Nenhuma rota ativa no momento</h2>
                <p className="mx-auto mt-1 max-w-sm text-sm text-muted-foreground">
                  Quando você aceitar uma rota ou entrega, o mapa com o destino aparecerá aqui.
                </p>
                {(routes.data ?? []).some((route) => route.status === "OFFERED") && (
                  <p className="mt-2 text-xs text-muted-foreground">
                    Há uma rota aguardando aceite. Acesse Entregas para aceitar e calcular o trajeto.
                  </p>
                )}
                <button
                  type="button"
                  className="button-primary mt-4 min-h-10"
                  onClick={() => setActiveTab("deliveries")}
                >
                  <PackageCheck size={15} /> Ver entregas
                </button>
                </div>
              </section>
            )}
          </TabsContent>
        </Tabs>
        {activeTab !== "map" && <footer className="mt-6 text-center text-[11px] text-muted-foreground">
          Valores calculados pelo sistema a partir do valor cadastrado por entrega.
        </footer>}
      </div>
    </main>
  );
}
