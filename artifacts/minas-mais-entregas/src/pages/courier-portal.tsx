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
  useSaveNativePushToken,
  useRemoveNativePushToken,
  useGetCourierEarnings,
  useListCourierRoutes,
  useListDeliveries,
  useUpdateDeliveryStatus,
  useUpdateCourierLocation,
  type AppUser,
  type CourierDeliveryRoute,
  type Delivery,
} from "@workspace/api-client-react";
import { useClerk } from "@clerk/react";
import { Capacitor } from "@capacitor/core";
import { PushNotifications } from "@capacitor/push-notifications";
import { LocalNotifications } from "@capacitor/local-notifications";
import { Preferences } from "@capacitor/preferences";
import { ArrowLeft, Bell, BellOff, Bike, CheckCircle2, ChevronDown, KeyRound, LoaderCircle, LocateFixed, LogOut, Map as MapIcon, MapPin, Menu, MessageCircle, PackageCheck, Phone } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation } from "wouter";
import CourierDeliveryNavigation from "@/components/courier-delivery-navigation";
import CourierRouteMapTab from "@/components/courier-route-map-tab";
import CourierRoutesSection, { type CourierGpsStatus } from "@/pages/courier-routes-section";
import EvidencePhotoAction from "@/components/evidence-photo-action";
import CourierUnableToDeliverAction from "@/components/courier-unable-to-deliver-action";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import type { MapCoordinate } from "@/components/live-map";
import { triggerCourierLightHaptic } from "@/lib/courier-haptics";

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
const initialGpsStatus: CourierGpsStatus = {
  tone: "yellow",
  ageSeconds: 0,
  accuracyMeters: null,
  locationMessage: "",
  hasSent: false,
};

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
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState<"deliveries" | "map">("deliveries");
  const activeTabRef = useRef<"deliveries" | "map">("deliveries");
  const tabTransitionTimerRef = useRef<number | null>(null);
  const mapResizeTimerRef = useRef<number | null>(null);
  const tabTransitioningRef = useRef(false);
  const [tabTransitioning, setTabTransitioning] = useState(false);
  const [skipTabTransition, setSkipTabTransition] = useState(false);
  const [mapResizeVersion, setMapResizeVersion] = useState(0);
  const [currentPosition, setCurrentPosition] = useState<MapCoordinate | null>(null);
  const [period, setPeriod] = useState<Period>("day");
  const [earningsOpen, setEarningsOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [gpsDetailsOpen, setGpsDetailsOpen] = useState(false);
  const [pushDetailsOpen, setPushDetailsOpen] = useState(false);
  const [gpsStatus, setGpsStatus] = useState<CourierGpsStatus>(initialGpsStatus);
  const [refreshGps, setRefreshGps] = useState<() => void>(() => undefined);
  const [nativePushStatusReady, setNativePushStatusReady] = useState(!isNativeApp);
  const [actionError, setActionError] = useState("");
  const [pushMessage, setPushMessage] = useState("");
  const changeActiveTab = useCallback((value: string) => {
    if (value !== "deliveries" && value !== "map") return;
    const nextTab = value as "deliveries" | "map";
    if (activeTabRef.current === nextTab) return;

    const interruptedTransition = tabTransitioningRef.current;
    const skipMotion = interruptedTransition || window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    activeTabRef.current = nextTab;
    if (tabTransitionTimerRef.current !== null) {
      window.clearTimeout(tabTransitionTimerRef.current);
      tabTransitionTimerRef.current = null;
    }
    if (mapResizeTimerRef.current !== null) {
      window.clearTimeout(mapResizeTimerRef.current);
      mapResizeTimerRef.current = null;
    }

    if (interruptedTransition) {
      tabTransitioningRef.current = false;
      setTabTransitioning(false);
      setSkipTabTransition(true);
      window.setTimeout(() => setSkipTabTransition(false), 34);
    } else if (skipMotion) {
      tabTransitioningRef.current = false;
      setTabTransitioning(false);
      setSkipTabTransition(true);
      window.setTimeout(() => setSkipTabTransition(false), 34);
    } else {
      tabTransitioningRef.current = true;
      setTabTransitioning(true);
      tabTransitionTimerRef.current = window.setTimeout(() => {
        tabTransitioningRef.current = false;
        tabTransitionTimerRef.current = null;
        setTabTransitioning(false);
      }, 200);
    }

    setActiveTab(nextTab);
    if (nextTab === "map") {
      const resizeDelay = skipMotion ? 0 : 200;
      mapResizeTimerRef.current = window.setTimeout(() => {
        mapResizeTimerRef.current = null;
        setMapResizeVersion((version) => version + 1);
      }, resizeDelay);
    }
  }, []);
  useEffect(() => () => {
    if (tabTransitionTimerRef.current !== null) window.clearTimeout(tabTransitionTimerRef.current);
    if (mapResizeTimerRef.current !== null) window.clearTimeout(mapResizeTimerRef.current);
  }, []);
  const [pushSubscription, setPushSubscription] = useState<PushSubscription | null>(null);
  const [nativePushActive, setNativePushActive] = useState(false);
  const [nativePushToken, setNativePushToken] = useState<string | null>(null);
  const [serviceWorkerStatus, setServiceWorkerStatus] = useState<
    "checking" | "active" | "missing" | "unsupported"
  >("checking");
  const earnings = useGetCourierEarnings(
    { period },
    { query: { queryKey: getGetCourierEarningsQueryKey({ period }), refetchInterval: 15000 } },
  );
  const dailyEarnings = useGetCourierEarnings(
    { period: "day" },
    { query: { queryKey: getGetCourierEarningsQueryKey({ period: "day" }), refetchInterval: 15000 } },
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
  const saveNativePush = useSaveNativePushToken();
  const removeNativePush = useRemoveNativePushToken();
  const saveNativePushRef = useRef(saveNativePush.mutateAsync);
  saveNativePushRef.current = saveNativePush.mutateAsync;
  const removeNativePushRef = useRef(removeNativePush.mutateAsync);
  removeNativePushRef.current = removeNativePush.mutateAsync;
  const currentVapidBytes = useMemo(() => {
    if (!pushKey.data?.publicKey) return null;
    try {
      return urlBase64ToUint8Array(pushKey.data.publicKey);
    } catch {
      return null;
    }
  }, [pushKey.data?.publicKey]);
  const pushIsActive = isNativeApp
    ? nativePushActive
    : Boolean(
        pushSubscription &&
          currentVapidBytes &&
          subscriptionUsesVapidKey(pushSubscription, currentVapidBytes),
      );
  const notificationStatusReady = isNativeApp
    ? nativePushStatusReady
    : serviceWorkerStatus !== "checking" && !pushKey.isLoading;
  const notificationsNeedAttention = notificationStatusReady && !pushIsActive;
  const gpsNeedsAttention = gpsStatus.ageSeconds > 60;
  const firstNameCandidate = profile.name.trim().split(/\s+/)[0] || "";
  const firstName = firstNameCandidate && !firstNameCandidate.includes("@")
    ? firstNameCandidate
    : "motoboy";
  const pushToggleDisabled =
    pushKey.isLoading ||
    (!isNativeApp && serviceWorkerStatus !== "active") ||
    savePush.isPending ||
    removePush.isPending ||
    (!isNativeApp && !currentVapidBytes) ||
    saveNativePush.isPending ||
    removeNativePush.isPending;
  const handleGpsStatusChange = useCallback((status: CourierGpsStatus, refresh: () => void) => {
    setGpsStatus(status);
    setRefreshGps(() => refresh);
  }, []);
  useEffect(() => {
    if (!isNativeApp) return;
    let mounted = true;
    const tokenKey = `native-fcm-token:${profile.id}`;
    const enabledKey = `native-fcm-enabled:${profile.id}`;
    const handles: Array<{ remove: () => Promise<void> }> = [];

    void Promise.all([
      Preferences.get({ key: tokenKey }),
      Preferences.get({ key: enabledKey }),
    ]).then(async ([savedToken, enabled]) => {
      if (!mounted) return;
      setNativePushToken(savedToken.value);
      const permission = await PushNotifications.checkPermissions();
      setNativePushActive(
        permission.receive === "granted" &&
        enabled.value === "true" &&
        Boolean(savedToken.value),
      );
      setNativePushStatusReady(true);
      if (permission.receive === "granted" && enabled.value === "true") {
        await PushNotifications.register();
      }
    }).catch(() => {
      if (mounted) {
        setPushMessage("Não foi possível verificar as notificações deste aparelho.");
        setNativePushStatusReady(true);
      }
    });

    void PushNotifications.addListener("registration", async ({ value }) => {
      if (!mounted || !value) return;
      try {
        await saveNativePushRef.current({ data: { token: value } });
        await Preferences.set({ key: tokenKey, value });
        await Preferences.set({ key: enabledKey, value: "true" });
        setNativePushToken(value);
        setNativePushActive(true);
        setPushMessage("Notificações ativadas neste aparelho.");
      } catch {
        setNativePushActive(false);
        setPushMessage("O aparelho recebeu o token, mas não foi possível salvar a inscrição no servidor.");
      }
    }).then((handle) => {
      if (mounted) handles.push(handle);
      else void handle.remove();
    });

    void PushNotifications.addListener("registrationError", () => {
      if (mounted) {
        setNativePushActive(false);
        setPushMessage("Não foi possível registrar este aparelho no Firebase. Verifique a configuração do app.");
      }
    }).then((handle) => {
      if (mounted) handles.push(handle);
      else void handle.remove();
    });

    void PushNotifications.addListener("pushNotificationReceived", async (notification) => {
      if (!mounted) return;
      const title = notification.title || "Nova entrega";
      const body = notification.body || "Há uma atualização para você.";
      setPushMessage(`${title}: ${body}`);
      try {
        await LocalNotifications.schedule({
          notifications: [{
            id: Math.floor(Date.now() % 2_000_000_000),
            title,
            body,
            schedule: { at: new Date(Date.now() + 250) },
            extra: notification.data,
          }],
        });
      } catch {
        // The in-app message remains visible if Android suppresses a foreground notification.
      }
    }).then((handle) => {
      if (mounted) handles.push(handle);
      else void handle.remove();
    });

    void PushNotifications.addListener("pushNotificationActionPerformed", ({ notification }) => {
      if (!mounted) return;
      const target = notification.data?.url;
      if (typeof target === "string" && target.startsWith("/") && !target.startsWith("//")) {
        setLocation(target);
      }
    }).then((handle) => {
      if (mounted) handles.push(handle);
      else void handle.remove();
    });

    return () => {
      mounted = false;
      for (const handle of handles) void handle.remove();
    };
  }, [profile.id, setLocation]);
  useEffect(() => {
    if (isNativeApp) {
      setServiceWorkerStatus("unsupported");
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
  const toggleNativePush = async () => {
    setPushMessage("");
    try {
      if (nativePushActive && nativePushToken) {
        await removeNativePush.mutateAsync({ data: { token: nativePushToken } });
        await Preferences.set({ key: `native-fcm-enabled:${profile.id}`, value: "false" });
        setNativePushActive(false);
        setPushMessage("Notificações desativadas neste aparelho.");
        return;
      }
      let permission = await PushNotifications.checkPermissions();
      if (permission.receive !== "granted") {
        permission = await PushNotifications.requestPermissions();
      }
      if (permission.receive !== "granted") {
        throw new Error("Permita notificações nas configurações do Android para receber novas entregas.");
      }
      await PushNotifications.createChannel({
        id: "delivery-updates",
        name: "Novas entregas",
        description: "Avisos de novas entregas e atualizações da rota",
        importance: 5,
      });
      await Preferences.set({ key: `native-fcm-enabled:${profile.id}`, value: "true" });
      setPushMessage("Ativando notificações…");
      await PushNotifications.register();
    } catch (error) {
      setPushMessage(error instanceof Error ? error.message : "Não foi possível ativar as notificações.");
    }
  };
  const togglePush = async () => {
    setPushMessage("");
    if (isNativeApp) {
      await toggleNativePush();
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
  const handleSignOut = async () => {
    if (isNativeApp && nativePushToken) {
      try {
        await removeNativePush.mutateAsync({ data: { token: nativePushToken } });
        await Preferences.set({ key: `native-fcm-enabled:${profile.id}`, value: "false" });
      } catch {
        // Continue sign-out even if the server cannot be reached.
      }
    }
    await signOut({ redirectUrl: import.meta.env.BASE_URL });
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
      if (status === "ACCEPTED" || status === "COMPLETED") {
        void triggerCourierLightHaptic();
      }
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: getListDeliveriesQueryKey() }),
        queryClient.invalidateQueries({ queryKey: getGetCourierEarningsQueryKey({ period: "day" }) }),
        queryClient.invalidateQueries({ queryKey: getGetCourierEarningsQueryKey({ period: "week" }) }),
        queryClient.invalidateQueries({ queryKey: getGetCourierEarningsQueryKey({ period: "month" }) }),
        queryClient.invalidateQueries({ queryKey: getGetCourierDeliveryNavigationQueryKey(deliveryId) }),
      ]);
    } catch {
      setActionError("Não foi possível atualizar esta entrega. Tente novamente.");
      throw new Error("Não foi possível concluir a entrega.");
    }
  };
  const renderIndividualDelivery = (delivery: Delivery) => (
    <CourierIndividualDeliveryCard
      delivery={delivery}
      active={delivery.id === activeIndividualDelivery?.id}
      busy={updateStatus.isPending}
      nextStatus={nextCourierStatus[delivery.status]}
      nextStatusLabel={nextStatusLabel[delivery.status]}
      onUpdate={updateDelivery}
      onShowMap={() => changeActiveTab("map")}
    />
  );

  return (
    <main className={activeTab === "map" ? "courier-pwa fixed inset-0 z-40 bg-[#f4f3f1] text-[#24272d]" : "courier-pwa min-h-[100dvh] bg-[#f4f3f1] px-3 pb-[max(16px,env(safe-area-inset-bottom))] pt-[max(8px,env(safe-area-inset-top))] text-[#24272d] sm:px-6"}>
      <div className={activeTab === "map" ? "mx-auto h-full w-full" : "mx-auto max-w-2xl"}>
        {activeTab !== "map" && (
          <header className="relative flex min-h-12 items-center gap-2">
            <Sheet open={menuOpen} onOpenChange={setMenuOpen}>
              <SheetTrigger asChild>
                <button
                  type="button"
                  className="grid h-12 w-12 shrink-0 place-items-center rounded-xl border border-[#e7e6e3] bg-white text-[#34363a]"
                  aria-label="Abrir menu"
                  data-testid="button-courier-menu"
                >
                  <Menu size={20} />
                </button>
              </SheetTrigger>
              <SheetContent side="left" className="courier-menu-sheet flex w-[min(20rem,calc(100vw-2rem))] flex-col border-r-[#e7e6e3] bg-[#f8f7f4] p-5 pb-[max(20px,env(safe-area-inset-bottom))] pt-[max(20px,env(safe-area-inset-top))] [&>button]:grid [&>button]:h-12 [&>button]:min-h-12 [&>button]:min-w-12 [&>button]:w-12 [&>button]:place-items-center">
                <SheetHeader className="text-left">
                  <SheetTitle className="flex items-center gap-3 text-base">
                    <span className="brand-mark"><Bike size={18} /></span>
                    <span>Minas Mais Entregas</span>
                  </SheetTitle>
                  <SheetDescription>Olá, {firstName}. Gerencie sua conta e este aparelho.</SheetDescription>
                </SheetHeader>
                <div className="mt-6 space-y-2">
                  <Link
                    href="/account"
                    onClick={() => setMenuOpen(false)}
                    className="button-secondary min-h-12 w-full justify-start"
                    data-testid="link-courier-password"
                  >
                    <KeyRound size={17} /> Alterar senha
                  </Link>
                  <button
                    type="button"
                    className="button-secondary min-h-12 w-full justify-start"
                    onClick={() => void togglePush()}
                    disabled={pushToggleDisabled}
                    data-testid="button-courier-notifications"
                  >
                    {pushIsActive ? <BellOff size={17} /> : <Bell size={17} />}
                    {pushIsActive ? "Desativar notificações" : "Ativar notificações"}
                  </button>
                  {pushMessage && <p role="status" className="px-1 text-xs text-[#8b3d45]">{pushMessage}</p>}
                </div>
                <button
                  type="button"
                  className="button-quiet mt-auto min-h-12 w-full justify-start border-t border-[#e7e6e3] pt-3"
                  onClick={() => void handleSignOut()}
                  data-testid="button-courier-sign-out"
                >
                  <LogOut size={17} /> Sair da conta
                </button>
              </SheetContent>
            </Sheet>

            <div className="min-w-0 flex-1 truncate text-[clamp(0.95rem,4vw,1.1rem)] font-bold tracking-tight">
              Olá, {firstName}
            </div>

            <div className="flex shrink-0 items-center gap-1">
              <button
                type="button"
                className="relative grid h-12 w-11 place-items-center rounded-xl text-[#484a4e] hover:bg-white"
                aria-label={gpsStatus.tone === "red" ? "GPS sem sinal recente. Ver detalhes" : "Ver status do GPS"}
                aria-expanded={gpsDetailsOpen}
                onClick={() => {
                  setGpsDetailsOpen((open) => !open);
                  setPushDetailsOpen(false);
                }}
                data-testid="button-courier-gps-status"
              >
                <LocateFixed size={19} />
                <span className={`absolute right-2 top-2 h-2 w-2 rounded-full ${
                  gpsStatus.tone === "green" ? "bg-green-600" : gpsStatus.tone === "yellow" ? "bg-amber-500" : "bg-red-600"
                }`} />
              </button>
              <button
                type="button"
                className="relative grid h-12 w-11 place-items-center rounded-xl text-[#484a4e] hover:bg-white"
                aria-label={pushIsActive ? "Notificações ativadas. Ver detalhes" : "Notificações desativadas. Ver detalhes"}
                aria-expanded={pushDetailsOpen}
                onClick={() => {
                  setPushDetailsOpen((open) => !open);
                  setGpsDetailsOpen(false);
                }}
                data-testid="button-courier-push-status"
              >
                {pushIsActive ? <Bell size={19} /> : <BellOff size={19} />}
                <span className={`absolute right-2 top-2 h-2 w-2 rounded-full ${pushIsActive ? "bg-green-600" : "bg-amber-500"}`} />
              </button>
            </div>

            {gpsDetailsOpen && (
              <aside className="absolute right-0 top-14 z-30 w-[min(19rem,calc(100vw-2rem))] rounded-xl border border-[#e7e6e3] bg-white p-4 text-left shadow-xl" role="status">
                <div className="flex items-center gap-2 text-sm font-bold"><LocateFixed size={16} /> Status do GPS</div>
                <p className="mt-2 text-xs">
                  {gpsStatus.hasSent
                    ? gpsNeedsAttention
                      ? `Último envio há ${Math.floor(gpsStatus.ageSeconds / 60)} min.`
                      : `Último envio há ${gpsStatus.ageSeconds} s.`
                    : "Aguardando a primeira posição do aparelho."}
                </p>
                {gpsStatus.accuracyMeters != null && <p className="mt-1 text-xs text-muted-foreground">Precisão aproximada: {Math.round(gpsStatus.accuracyMeters)} m.</p>}
                {gpsStatus.locationMessage && <p className="mt-2 text-xs text-muted-foreground">{gpsStatus.locationMessage}</p>}
                <p className="mt-2 text-[11px] text-muted-foreground">
                  {isNativeApp ? "O rastreamento em segundo plano depende das permissões do aparelho." : "O PWA envia a localização enquanto permanece aberto."}
                </p>
                <button type="button" className="button-secondary mt-3 min-h-12 w-full justify-center" onClick={() => refreshGps()}>
                  <LocateFixed size={15} /> Tentar atualizar GPS
                </button>
              </aside>
            )}
            {pushDetailsOpen && (
              <aside className="absolute right-0 top-14 z-30 w-[min(19rem,calc(100vw-2rem))] rounded-xl border border-[#e7e6e3] bg-white p-4 text-left shadow-xl" role="status">
                <div className="flex items-center gap-2 text-sm font-bold">
                  {pushIsActive ? <Bell size={16} /> : <BellOff size={16} />} Notificações
                </div>
                <p className="mt-2 text-xs">
                  {!notificationStatusReady
                    ? "Verificando este aparelho…"
                    : pushIsActive
                      ? isNativeApp ? "Ativadas neste aparelho." : "Ativadas para este PWA."
                      : serviceWorkerStatus === "missing"
                        ? "O Service Worker não está ativo. Feche e reabra o PWA."
                        : pushKey.isError || (!isNativeApp && !currentVapidBytes)
                          ? "Não foi possível carregar a configuração das notificações."
                          : "Desativadas neste aparelho."}
                </p>
                {pushMessage && <p className="mt-2 text-xs text-[#8b3d45]">{pushMessage}</p>}
                <button type="button" className="button-secondary mt-3 min-h-12 w-full justify-center" onClick={() => { setPushDetailsOpen(false); setMenuOpen(true); }}>
                  <Menu size={15} /> Abrir configurações
                </button>
              </aside>
            )}
          </header>
        )}

        <Tabs
          value={activeTab}
          onValueChange={changeActiveTab}
        >
          <TabsList
            aria-label="Seções do app do motoboy"
            data-active-tab={activeTab}
            data-transitioning={tabTransitioning ? "true" : "false"}
            data-skip-transition={skipTabTransition ? "true" : "false"}
            className={`courier-pwa-tabs mt-2 grid h-14 w-full grid-cols-2 rounded-xl border border-[#e7e6e3] bg-white p-1 ${activeTab === "map" ? "courier-pwa-tabs--map" : ""} ${skipTabTransition ? "courier-pwa-tabs--no-transition" : ""}`}
          >
            <TabsTrigger value="deliveries" className="gap-2 rounded-lg text-sm" data-testid="tab-courier-deliveries">
              <PackageCheck size={16} /> Entregas
            </TabsTrigger>
            <TabsTrigger value="map" className="gap-2 rounded-lg text-sm" data-testid="tab-courier-map">
              <MapIcon size={16} /> Mapa e rota
            </TabsTrigger>
          </TabsList>
          <TabsContent
            value="deliveries"
            forceMount
            aria-hidden={activeTab !== "deliveries"}
            data-transitioning={tabTransitioning ? "true" : "false"}
            className={`courier-tab-panel courier-tab-panel--deliveries mt-4 ${skipTabTransition ? "courier-tab-panel--no-transition" : ""}`}
          >
        {returningDeliveries.length > 0 && (
          <p className="mb-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm font-bold text-amber-950" role="status">
            {returningDeliveries.length} {returningDeliveries.length === 1 ? "produto para devolver" : "produtos para devolver"} na filial. A Central confirmará quando receber.
          </p>
        )}
        {(notificationsNeedAttention || gpsNeedsAttention) && (
          <section className="mt-3 rounded-xl border border-amber-200 bg-amber-50 p-3 text-amber-950" role="status">
            <div className="flex items-start gap-2">
              <span className="mt-0.5 shrink-0 text-amber-700">
                {notificationsNeedAttention ? <BellOff size={16} /> : <LocateFixed size={16} />}
              </span>
              <div className="min-w-0 flex-1 text-xs leading-relaxed">
                {notificationsNeedAttention && <p>Notificações desativadas neste aparelho.</p>}
                {gpsNeedsAttention && <p>Sem envio de GPS há mais de 1 minuto.</p>}
              </div>
            </div>
            <div className="mt-2 flex flex-wrap gap-2">
              {notificationsNeedAttention && (
                <button
                  type="button"
                  className="button-secondary min-h-12"
                  onClick={() => void togglePush()}
                  disabled={pushToggleDisabled}
                  data-testid="button-alert-enable-push"
                >
                  <Bell size={15} /> Ativar notificações
                </button>
              )}
              {gpsNeedsAttention && (
                <button
                  type="button"
                  className="button-secondary min-h-12"
                  onClick={() => {
                    setGpsDetailsOpen(true);
                    setPushDetailsOpen(false);
                    refreshGps();
                  }}
                  data-testid="button-alert-refresh-gps"
                >
                  <LocateFixed size={15} /> Resolver GPS
                </button>
              )}
            </div>
          </section>
        )}

        {actionError && (
          <div className="mt-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
            {actionError}
          </div>
        )}

        <CourierRoutesSection
          courierId={profile.id}
          routes={routes.data ?? []}
          deliveries={individualDeliveries}
          isLoading={routes.isLoading || deliveries.isLoading}
          isError={routes.isError || deliveries.isError}
          onRetry={() => {
            void routes.refetch();
            void deliveries.refetch();
          }}
          onShowMap={() => changeActiveTab("map")}
          onCurrentPositionChange={setCurrentPosition}
          onGpsStatusChange={handleGpsStatusChange}
          renderIndividualDelivery={renderIndividualDelivery}
        />

        <section className="panel mt-4 overflow-hidden" aria-label="Resumo de ganhos">
          <button
            type="button"
            className="flex min-h-14 w-full items-center gap-2 px-4 py-3 text-left"
            aria-expanded={earningsOpen}
            onClick={() => setEarningsOpen((open) => !open)}
            data-testid="button-courier-earnings"
          >
            <span className="min-w-0 flex-1 truncate text-sm font-semibold">
              Hoje: {dailyEarnings.isLoading ? "—" : dailyEarnings.data?.completedDeliveries ?? "—"} entregas · {dailyEarnings.isLoading ? "—" : money(dailyEarnings.data?.amountToReceive ?? 0)}
            </span>
            <ChevronDown className={`shrink-0 transition-transform ${earningsOpen ? "rotate-180" : ""}`} size={18} />
          </button>
          {earningsOpen && (
            <div className="border-t border-border p-4">
              <div className="grid grid-cols-3 gap-1 rounded-xl bg-[#f3f2ef] p-1" role="tablist" aria-label="Período dos ganhos">
                {(["day", "week", "month"] as const).map((option) => (
                  <button
                    key={option}
                    type="button"
                    role="tab"
                    aria-selected={period === option}
                    className={`min-h-12 rounded-lg px-1 text-xs font-semibold ${period === option ? "bg-white text-primary shadow-sm" : "text-muted-foreground"}`}
                    onClick={() => setPeriod(option)}
                    data-testid={`tab-earnings-${option}`}
                  >
                    {periodNames[option]}
                  </button>
                ))}
              </div>
              {earnings.isError ? (
                <p className="mt-4 text-sm text-red-700">Não foi possível consultar seus ganhos.</p>
              ) : (
                <div className="mt-4 grid grid-cols-2 gap-3">
                  <div>
                    <span className="text-xs text-muted-foreground">Entregas concluídas</span>
                    <strong className="mt-1 block text-lg">{earnings.isLoading ? "—" : earnings.data?.completedDeliveries ?? "—"}</strong>
                  </div>
                  <div>
                    <span className="text-xs text-muted-foreground">A receber</span>
                    <strong className="mt-1 block text-lg">{earnings.isLoading ? "—" : money(earnings.data?.amountToReceive ?? 0)}</strong>
                  </div>
                </div>
              )}
            </div>
          )}
        </section>
          </TabsContent>
          <TabsContent
            value="map"
            forceMount
            aria-hidden={activeTab !== "map"}
            data-transitioning={tabTransitioning ? "true" : "false"}
            className={`courier-tab-panel courier-tab-panel--map fixed inset-0 z-50 m-0 h-[100dvh] overflow-hidden ${skipTabTransition ? "courier-tab-panel--no-transition" : ""}`}
          >
            {activeRoute ? (
              <CourierRouteMapTab
                route={activeRoute}
                currentPosition={currentPosition}
                onBack={() => changeActiveTab("deliveries")}
                onRefresh={() => void routes.refetch()}
                activeDelivery={activeRouteDelivery}
                resizeVersion={mapResizeVersion}
              />
            ) : activeIndividualDelivery ? (
              <CourierDeliveryNavigation
                deliveryId={activeIndividualDelivery.id}
                onBack={() => changeActiveTab("deliveries")}
                delivery={activeIndividualDelivery}
                resizeVersion={mapResizeVersion}
              />
            ) : (
              <section className="grid h-full place-items-center p-6 text-center">
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
                  className="button-primary mt-4 min-h-12"
                  onClick={() => changeActiveTab("deliveries")}
                >
                  <PackageCheck size={15} /> Ver entregas
                </button>
                </div>
              </section>
            )}
          </TabsContent>
        </Tabs>
      </div>
    </main>
  );
}

function CourierIndividualDeliveryCard({
  delivery,
  active,
  busy,
  nextStatus,
  nextStatusLabel: actionLabel,
  onUpdate,
  onShowMap,
}: {
  delivery: Delivery;
  active: boolean;
  busy: boolean;
  nextStatus?: string;
  nextStatusLabel?: string;
  onUpdate: (deliveryId: string, status: string, evidencePath?: string) => Promise<void>;
  onShowMap: () => void;
}) {
  const isReturning = delivery.status === "RETURNING_TO_STORE";
  const phoneDigits = delivery.customerPhone?.replace(/\D/g, "");
  const whatsappNumber = phoneDigits
    ? phoneDigits.startsWith("55") ? phoneDigits : `55${phoneDigits}`
    : null;
  const actionIcon = nextStatus === "ACCEPTED"
    ? <PackageCheck size={16} />
    : nextStatus === "COMPLETED"
      ? <CheckCircle2 size={16} />
      : <MapPin size={16} />;

  return (
    <article className={`panel p-4 sm:p-5 ${active ? "border-l-4 border-l-[#a91d2a]" : ""}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="font-mono text-xs font-semibold text-[#a91d2a]">{delivery.code}</div>
          <h3 className="mt-1 text-sm font-bold">{delivery.customerName}</h3>
          <p className="mt-1 text-xs text-muted-foreground">
            {delivery.storeName}{delivery.storeAddress ? ` · ${delivery.storeAddress}` : ""}
          </p>
        </div>
        <span className="shrink-0 rounded-full bg-[#f6f4f1] px-2.5 py-1 text-[10px] font-semibold">
          {statusLabel[delivery.status] ?? delivery.status}
        </span>
      </div>
      <p className="mt-3 text-sm leading-relaxed">{delivery.destination}</p>
      {delivery.notes && <p className="mt-2 rounded-lg bg-[#f6f4f1] p-3 text-xs">Observações: {delivery.notes}</p>}
      {isReturning && (
        <p className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs font-semibold text-amber-950">
          Leve o produto de volta à filial ao encerrar a rota.
        </p>
      )}
      {!isReturning && (active || ["ACCEPTED", "TO_STORE", "AT_STORE", "IN_TRANSIT"].includes(delivery.status)) && (
        <div className="mt-3 flex flex-wrap gap-2">
          {delivery.customerPhone && (
            <>
              <a className="button-secondary min-h-12" href={`tel:${delivery.customerPhone}`}>
                <Phone size={15} /> Telefone
              </a>
              {whatsappNumber && (
                <a className="button-secondary min-h-12" href={`https://wa.me/${whatsappNumber}`} target="_blank" rel="noreferrer">
                  <MessageCircle size={15} /> WhatsApp
                </a>
              )}
            </>
          )}
          <button type="button" className="button-outlined min-h-12" onClick={onShowMap}>
            <MapIcon size={15} /> Ver rota no mapa
          </button>
          {active && <CourierUnableToDeliverAction deliveryId={delivery.id} disabled={busy} />}
        </div>
      )}
      <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-border pt-3">
        <span className="text-sm font-bold">{money(delivery.deliveryAmount)}</span>
        {delivery.status === "IN_TRANSIT" && nextStatus ? (
          <div className="w-full space-y-2">
            <EvidencePhotoAction
              deliveryId={delivery.id}
              disabled={busy}
              onComplete={async (evidencePath) => onUpdate(delivery.id, nextStatus, evidencePath)}
            />
            {active && <CourierUnableToDeliverAction deliveryId={delivery.id} disabled={busy} />}
          </div>
        ) : nextStatus ? (
          <div className="flex w-full flex-col gap-2">
            <button
              type="button"
              className="button-primary min-h-12 w-full justify-center"
              disabled={busy}
              onClick={() => void onUpdate(delivery.id, nextStatus)}
              aria-busy={busy}
            >
              {busy
                ? <><LoaderCircle size={16} className="animate-spin" /> Salvando…</>
                : <>{actionIcon} {actionLabel ?? "Continuar"}</>}
            </button>
            {busy && <p className="text-xs text-muted-foreground" role="status">Aguarde a resposta para evitar uma ação duplicada.</p>}
            {active && <CourierUnableToDeliverAction deliveryId={delivery.id} disabled={busy} />}
          </div>
        ) : null}
      </div>
    </article>
  );
}
