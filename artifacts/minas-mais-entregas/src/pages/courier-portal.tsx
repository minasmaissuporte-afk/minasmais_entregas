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
  useUpdateCourierAvailability,
  useDeclineCourierDelivery,
  type AppUser,
  type CourierDeliveryRoute,
  type Delivery,
} from "@workspace/api-client-react";
import { useClerk } from "@clerk/react";
import { Capacitor } from "@capacitor/core";
import { App } from "@capacitor/app";
import { PushNotifications } from "@capacitor/push-notifications";
import { LocalNotifications } from "@capacitor/local-notifications";
import { Preferences } from "@capacitor/preferences";
import { Bell, BellOff, Check, CheckCircle2, Clock3, Hand, History, House, KeyRound, LoaderCircle, LocateFixed, LogOut, Map as MapIcon, MapPin, MessageCircle, PackageCheck, Phone, Route as RouteIcon, TrendingUp } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation } from "wouter";
import CourierDeliveryNavigation from "@/components/courier-delivery-navigation";
import CourierRouteMapTab from "@/components/courier-route-map-tab";
import CourierRoutesSection, { type CourierGpsStatus } from "@/pages/courier-routes-section";
import LiveMap from "@/components/live-map";
import EvidencePhotoAction from "@/components/evidence-photo-action";
import CourierUnableToDeliverAction from "@/components/courier-unable-to-deliver-action";
import { Tabs, TabsContent } from "@/components/ui/tabs";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import type { MapCoordinate } from "@/components/live-map";
import { triggerCourierLightHaptic } from "@/lib/courier-haptics";

type Period = "day" | "week" | "month";
const isNativeApp = Capacitor.isNativePlatform();
function getBrowserBuildLabel() {
  if (import.meta.env.DEV) return "Desenvolvimento";
  const bundleUrl = Array.from(document.scripts)
    .map((script) => script.src)
    .find((src) => /\/assets\/index-[a-z0-9_-]+\.js(?:\?|$)/i.test(src));
  const hash = bundleUrl?.match(/\/assets\/index-([a-z0-9_-]+)\.js(?:\?|$)/i)?.[1];
  return hash ? `Build ${hash}` : "Build compilado";
}

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

function playNativeOfferTone() {
  try {
    const AudioContextConstructor = window.AudioContext;
    if (!AudioContextConstructor) return;
    const context = new AudioContextConstructor();
    const startTone = () => {
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      oscillator.type = "sine";
      oscillator.frequency.value = 880;
      gain.gain.setValueAtTime(0.055, context.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, context.currentTime + 0.16);
      oscillator.connect(gain);
      gain.connect(context.destination);
      oscillator.onended = () => { void context.close().catch(() => undefined); };
      oscillator.start();
      oscillator.stop(context.currentTime + 0.16);
    };
    if (context.state === "suspended") {
      void context.resume().then(startTone).catch(() => { void context.close().catch(() => undefined); });
    } else {
      startTone();
    }
  } catch {
    // An unavailable audio context must never interrupt delivery polling or actions.
  }
}

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
  const [activeTab, setActiveTab] = useState<"deliveries" | "map" | "history" | "earnings">("deliveries");
  const activeTabRef = useRef<"deliveries" | "map" | "history" | "earnings">("deliveries");
  const tabTransitionTimerRef = useRef<number | null>(null);
  const mapResizeTimerRef = useRef<number | null>(null);
  const tabTransitioningRef = useRef(false);
  const [tabTransitioning, setTabTransitioning] = useState(false);
  const [skipTabTransition, setSkipTabTransition] = useState(false);
  const [mapResizeVersion, setMapResizeVersion] = useState(0);
  const [currentPosition, setCurrentPosition] = useState<MapCoordinate | null>(null);
  const [period, setPeriod] = useState<Period>("day");
  const [menuOpen, setMenuOpen] = useState(false);
  const [isOnline, setIsOnline] = useState(profile.courierStatus !== "OFFLINE");
  const [availabilityError, setAvailabilityError] = useState("");
  const [declineError, setDeclineError] = useState("");
  const offerCountInitialized = useRef(false);
  const previousOfferCount = useRef(0);
  const [gpsStatus, setGpsStatus] = useState<CourierGpsStatus>(initialGpsStatus);
  const [appVersion, setAppVersion] = useState(getBrowserBuildLabel);
  const [refreshGps, setRefreshGps] = useState<() => void>(() => undefined);
  const [nativePushStatusReady, setNativePushStatusReady] = useState(!isNativeApp);
  const [actionError, setActionError] = useState("");
  const [pushMessage, setPushMessage] = useState("");
  const changeActiveTab = useCallback((value: string) => {
    if (!["deliveries", "map", "history", "earnings"].includes(value)) return;
    const nextTab = value as "deliveries" | "map" | "history" | "earnings";
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
  const weeklyEarnings = useGetCourierEarnings(
    { period: "week" },
    { query: { queryKey: getGetCourierEarningsQueryKey({ period: "week" }), refetchInterval: 15000 } },
  );
  const monthlyEarnings = useGetCourierEarnings(
    { period: "month" },
    { query: { queryKey: getGetCourierEarningsQueryKey({ period: "month" }), refetchInterval: 15000 } },
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
  const updateAvailability = useUpdateCourierAvailability();
  const declineDelivery = useDeclineCourierDelivery();
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
  const gpsNeedsAttention = isOnline && gpsStatus.ageSeconds > 60;
  const profileName = profile.name.trim();
  const genericName = /^(motoboy|motobói|entregador|courier|driver)(\s+\d+)?$/i;
  const nameIsUsable =
    Boolean(profileName) &&
    !profileName.includes("@") &&
    !genericName.test(profileName);
  const emailName = profile.email.split("@")[0]?.trim() ?? "";
  const firstNameCandidate = (nameIsUsable ? profileName : emailName)
    .split(/\s+/)[0]
    ?.trim() ?? "";
  const firstName = firstNameCandidate
    ? firstNameCandidate.charAt(0).toLocaleUpperCase("pt-BR") + firstNameCandidate.slice(1)
    : "Sem nome";
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
    void App.getInfo().then((info) => {
      if (mounted && info.version && info.version !== "0.0.0") setAppVersion(info.version);
    }).catch(() => undefined);
    return () => { mounted = false; };
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
  const hasActiveWork = Boolean(activeRoute || activeIndividualDelivery);
  const pendingOffers = useMemo(
    () =>
      (routes.data ?? []).filter((route) => route.status === "OFFERED").length +
      individualDeliveries.filter((delivery) => delivery.status === "OFFERED").length,
    [routes.data, individualDeliveries],
  );
  useEffect(() => {
    if (routes.isLoading || deliveries.isLoading || routes.isError || deliveries.isError) return;
    if (!offerCountInitialized.current) {
      offerCountInitialized.current = true;
      previousOfferCount.current = pendingOffers;
      return;
    }
    if (pendingOffers > previousOfferCount.current) {
      void triggerCourierLightHaptic().catch(() => undefined);
      if (isNativeApp) playNativeOfferTone();
    }
    previousOfferCount.current = pendingOffers;
  }, [pendingOffers, routes.isLoading, deliveries.isLoading, routes.isError, deliveries.isError]);
  const historyDeliveries = useMemo(
    () =>
      (deliveries.data ?? [])
        .filter((delivery) => delivery.status === "COMPLETED" || delivery.status === "NOT_DELIVERED")
        .slice()
        .sort((a, b) => new Date(b.updatedAt ?? b.createdAt).getTime() - new Date(a.updatedAt ?? a.createdAt).getTime()),
    [deliveries.data],
  );
  const toggleAvailability = async () => {
    if (updateAvailability.isPending) return;
    if (isOnline && hasActiveWork) {
      setAvailabilityError("Conclua ou finalize sua entrega ativa antes de ficar offline.");
      return;
    }
    setAvailabilityError("");
    const nextOnline = !isOnline;
    try {
      const result = await updateAvailability.mutateAsync({ data: { online: nextOnline } });
      setIsOnline(result.online);
      if (!result.online) {
        setGpsStatus({ ...initialGpsStatus, locationMessage: "GPS pausado enquanto você está offline." });
      } else {
        setGpsStatus(initialGpsStatus);
      }
      void triggerCourierLightHaptic();
    } catch {
      setAvailabilityError("Não foi possível atualizar sua disponibilidade. Tente novamente.");
    }
  };
  const declineIndividualDelivery = async (deliveryId: string) => {
    setDeclineError("");
    try {
      await declineDelivery.mutateAsync({ deliveryId });
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: getListDeliveriesQueryKey() }),
        queryClient.invalidateQueries({ queryKey: getListCourierRoutesQueryKey() }),
      ]);
    } catch {
      setDeclineError("Não foi possível recusar esta oferta. Tente novamente.");
    }
  };
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
      busy={updateStatus.isPending || declineDelivery.isPending}
      nextStatus={nextCourierStatus[delivery.status]}
      nextStatusLabel={nextStatusLabel[delivery.status]}
      declining={declineDelivery.isPending}
      onUpdate={updateDelivery}
      onDecline={declineIndividualDelivery}
      onShowMap={() => changeActiveTab("map")}
    />
  );

  return (
    <main className={`courier-pwa min-h-[100dvh] bg-[#f5f2ee] text-[#272729] ${activeTab === "map" ? "fixed inset-0 z-40 overflow-hidden" : "courier-app-shell"}`}>
      {activeTab !== "map" && (
        <header className="courier-header px-4 pb-3 pt-[max(10px,env(safe-area-inset-top))] text-white">
          <div className="courier-header-inner mx-auto max-w-2xl">
            <div className="courier-header-top">
              <div className="courier-official-brand" aria-label="Minas Mais Entregas">
                <span className="courier-official-brand__name" data-testid="text-brand-name">MINAS MAIS</span>
                <span className="courier-official-brand__subtitle" data-testid="text-brand-subtitle">ENTREGAS</span>
              </div>
              <Sheet open={menuOpen} onOpenChange={setMenuOpen}>
                <SheetTrigger asChild>
                  <button type="button" className="courier-avatar-button" aria-label="Abrir perfil" data-testid="button-courier-profile">
                    {firstName.charAt(0).toLocaleUpperCase("pt-BR")}
                  </button>
                </SheetTrigger>
                <SheetContent side="right" className="courier-profile-sheet flex w-[min(23rem,calc(100vw-1rem))] flex-col border-0 bg-[#faf8f4] p-5 pb-[max(20px,env(safe-area-inset-bottom))] pt-[max(24px,env(safe-area-inset-top))]">
                  <SheetHeader className="text-left">
                    <SheetTitle className="text-xl font-bold">Seu perfil</SheetTitle>
                    <SheetDescription>Seus dados locais e preferências deste aparelho.</SheetDescription>
                  </SheetHeader>
                  <div className="mt-6 flex items-center gap-3 rounded-2xl bg-white p-4">
                    <span className="courier-profile-avatar">{firstName.charAt(0).toLocaleUpperCase("pt-BR")}</span>
                    <div className="min-w-0"><p className="truncate text-sm font-bold">{profile.name || firstName}</p><p className="truncate text-xs text-muted-foreground">{profile.email}</p></div>
                  </div>
                  <dl className="mt-4 divide-y divide-[#e9e4dc] rounded-2xl bg-white px-4">
                    <div className="py-3"><dt className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Telefone</dt><dd className={`mt-1 text-sm ${profile.phone ? "" : "text-muted-foreground"}`}>{profile.phone || "Não informado — fale com o administrador"}</dd></div>
                    <div className="py-3"><dt className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Filial</dt><dd className={`mt-1 text-sm ${profile.storeName ? "" : "text-muted-foreground"}`}>{profile.storeName || "Não informado — fale com o administrador"}</dd></div>
                    <div className="py-3"><dt className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Conta</dt><dd className="mt-1 text-sm">{profile.email}</dd></div>
                  </dl>
                  <div className="mt-4 space-y-2">
                    <div className="courier-profile-inline-row">
                      <span className="flex min-w-0 items-center gap-2 text-sm font-semibold"><LocateFixed size={17} /> GPS · <b className={gpsStatus.tone === "green" ? "text-[#28794f]" : gpsStatus.tone === "red" || !isOnline ? "text-[#727983]" : "text-[#9a6a16]"}>{!isOnline ? "Inativo" : gpsStatus.tone === "green" ? "Ativo" : gpsStatus.tone === "red" ? "Inativo" : "Aguardando"}</b></span>
                      <button type="button" className="button-secondary min-h-12 shrink-0" onClick={() => refreshGps()} data-testid="button-courier-gps-status">Verificar</button>
                    </div>
                    <div className="courier-profile-inline-row" data-testid="button-courier-push-status">
                      <span className="flex min-w-0 items-center gap-2 text-sm font-semibold">{pushIsActive ? <Bell size={17} /> : <BellOff size={17} />} Notificações</span>
                      <button type="button" role="switch" aria-checked={pushIsActive} aria-label={pushIsActive ? "Desativar notificações" : "Ativar notificações"} className={`courier-profile-switch ${pushIsActive ? "active" : ""}`} onClick={() => void togglePush()} disabled={pushToggleDisabled} data-testid="button-courier-notifications"><span /></button>
                    </div>
                    {pushMessage && <p role="status" className="px-1 text-xs text-[#8b3d45]">{pushMessage}</p>}
                    <Link href="/account" onClick={() => setMenuOpen(false)} className="button-secondary min-h-12 w-full justify-start" data-testid="link-courier-password">
                      <KeyRound size={17} /> Alterar senha
                    </Link>
                  </div>
                  <p className="mt-auto border-t border-[#e9e4dc] pt-4 text-xs text-muted-foreground">Minas Mais Entregas · Versão {appVersion}</p>
                  <button type="button" className="button-quiet min-h-12 w-full justify-start" onClick={() => void handleSignOut()} data-testid="button-courier-sign-out">
                    <LogOut size={17} /> Sair da conta
                  </button>
                </SheetContent>
              </Sheet>
            </div>
            <h1 className="courier-greeting">Olá, {firstName} <Hand size={17} aria-hidden="true" /></h1>
            <section className={`courier-online-card ${isOnline ? "is-online" : "is-offline"}`} aria-label="Disponibilidade do motoboy">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className={`courier-online-pulse ${isOnline ? "is-online" : ""}`} />
                  <span className="text-[12px] font-extrabold">{isOnline ? "Você está online" : "Você está offline"}</span>
                </div>
                <p className="mt-1 text-[12px] leading-snug text-current/75">{isOnline ? "Disponível para receber pedidos" : "Ative para receber pedidos"}</p>
              </div>
              <button type="button" role="switch" aria-checked={isOnline} aria-label={isOnline ? "Ficar offline" : "Ficar online"} className={`courier-online-toggle ${isOnline ? "active" : ""}`} onClick={() => void toggleAvailability()} disabled={updateAvailability.isPending} aria-busy={updateAvailability.isPending} data-testid="toggle-courier-availability">
                <span className={`courier-online-knob ${isOnline ? "is-online" : ""}`}>{updateAvailability.isPending ? <LoaderCircle size={14} className="animate-spin" /> : isOnline ? <Check size={14} /> : null}</span>
              </button>
            </section>
            {availabilityError && <div className="mt-2 rounded-xl border border-[#edc9c4] bg-[#fff1ed] px-3 py-2.5 text-xs leading-relaxed text-[#94382e]" role="alert" data-testid="alert-courier-availability">{availabilityError}</div>}
          </div>
        </header>
      )}

      <div className={activeTab === "map" ? "h-full w-full" : "courier-content-shell mx-auto w-full max-w-2xl px-3 sm:px-5"}>
        <Tabs value={activeTab} onValueChange={changeActiveTab}>
          <TabsContent value="deliveries" forceMount aria-hidden={activeTab !== "deliveries"} className={`courier-tab-panel courier-tab-panel--deliveries ${activeTab === "deliveries" ? "mt-0" : ""} ${skipTabTransition ? "courier-tab-panel--no-transition" : ""}`} data-transitioning={tabTransitioning ? "true" : "false"}>
            {notificationsNeedAttention && (
              <section className="courier-device-notice" role="status" data-testid="alert-courier-device">
                <BellOff size={15} aria-hidden="true" />
                <span>Notificações desativadas neste aparelho.</span>
                <button type="button" onClick={() => void togglePush()} disabled={pushToggleDisabled} data-testid="button-courier-device-alert">Ativar</button>
              </section>
            )}
            {gpsNeedsAttention && (
              <section className="courier-device-notice courier-device-notice--gps" role="status" data-testid="alert-courier-gps">
                <LocateFixed size={15} aria-hidden="true" />
                <span>Sem envio de GPS há mais de 1 minuto.</span>
                <button type="button" onClick={() => refreshGps()} data-testid="button-courier-device-gps">Verificar</button>
              </section>
            )}
            {returningDeliveries.length > 0 && <p className="mt-3 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm font-bold text-amber-950" role="status">{returningDeliveries.length} {returningDeliveries.length === 1 ? "produto para devolver" : "produtos para devolver"} na filial. A Central confirmará quando receber.</p>}
            {actionError && <div className="mt-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800" role="alert">{actionError}</div>}
            {declineError && <div className="mt-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800" role="alert" data-testid="alert-delivery-decline">{declineError}</div>}
            <CourierRoutesSection
              courierId={profile.id}
              routes={routes.data ?? []}
              deliveries={individualDeliveries}
              isLoading={routes.isLoading || deliveries.isLoading}
              isError={routes.isError || deliveries.isError}
              online={isOnline}
              onRetry={() => { void routes.refetch(); void deliveries.refetch(); }}
              onShowMap={() => changeActiveTab("map")}
              onCurrentPositionChange={setCurrentPosition}
              onGpsStatusChange={handleGpsStatusChange}
              renderIndividualDelivery={renderIndividualDelivery}
            />
            {!hasActiveWork && pendingOffers === 0 && isOnline && <button type="button" className="courier-daily-summary mt-3 w-full text-left" onClick={() => changeActiveTab("earnings")} data-testid="button-courier-daily-summary">
              <span className="courier-summary-icon"><TrendingUp size={17} /></span>
              <span className="min-w-0 flex-1"><span className="block text-sm font-extrabold">Seu dia está rendendo</span><span className="mt-1 block text-sm font-bold">{dailyEarnings.isLoading ? "Atualizando seus totais…" : `Hoje: ${dailyEarnings.data?.completedDeliveries ?? "—"} ${(dailyEarnings.data?.completedDeliveries ?? 0) === 1 ? "entrega" : "entregas"} · ${money(dailyEarnings.data?.amountToReceive ?? 0)}`}</span></span>
            </button>}
            {!hasActiveWork && pendingOffers === 0 && isOnline && <p className="courier-keep-open-note">Mantenha o app aberto para não perder pedidos.</p>}
          </TabsContent>

          <TabsContent value="history" forceMount aria-hidden={activeTab !== "history"} className={`courier-tab-panel courier-tab-panel--deliveries ${skipTabTransition ? "courier-tab-panel--no-transition" : ""}`}>
            <div className="courier-page-heading"><div className="eyebrow">SUAS ATIVIDADES</div><h1>Histórico</h1><p>Entregas concluídas e não realizadas.</p></div>
            <div className="courier-activity-switch" role="tablist" aria-label="Histórico e ganhos">
              <button type="button" role="tab" aria-selected="true" onClick={() => changeActiveTab("history")} data-testid="tab-courier-history">Histórico</button>
              <button type="button" role="tab" aria-selected="false" onClick={() => changeActiveTab("earnings")} data-testid="tab-courier-earnings-page">Ganhos</button>
            </div>
            <div className="courier-period-switch mt-3" role="tablist" aria-label="Período do histórico">
              {(["day", "week", "month"] as const).map((option) => <button key={option} type="button" role="tab" aria-selected={period === option} onClick={() => setPeriod(option)} data-testid={`tab-history-period-${option}`}>{periodNames[option]}</button>)}
            </div>
            <section className="courier-total-strip courier-total-strip--selected" aria-label="Totais do período">
              <div className="courier-total-cell"><span>{periodNames[period]}</span><strong>{earnings.isLoading ? "—" : `${earnings.data?.completedDeliveries ?? "—"} ${earnings.data?.completedDeliveries === 1 ? "entrega" : "entregas"}`}</strong><b>{earnings.isLoading ? "—" : money(earnings.data?.amountToReceive ?? 0)}</b></div>
            </section>
            <div className="mt-5 flex items-center justify-between gap-2">
              <h2 className="text-base font-extrabold">Entregas recentes</h2>
              <button type="button" className="button-quiet min-h-12" onClick={() => { void deliveries.refetch(); }} data-testid="button-history-refresh">Atualizar</button>
            </div>
            {deliveries.isLoading ? <div className="mt-3 space-y-3" role="status" aria-label="Carregando histórico"><div className="skeleton h-24 w-full rounded-2xl" /><div className="skeleton h-24 w-full rounded-2xl" /></div>
              : deliveries.isError ? <div className="courier-state-card mt-3" role="alert"><p className="font-bold">Não foi possível carregar o histórico.</p><button type="button" className="button-secondary mt-3" onClick={() => void deliveries.refetch()}>Tentar novamente</button></div>
                : historyDeliveries.length === 0 ? <div className="courier-state-card mt-3"><span className="courier-awaiting-icon"><History size={19} /></span><h2 className="mt-3 font-bold">Ainda sem entregas no histórico</h2><p className="mt-1 text-sm text-muted-foreground">Entregas concluídas ou não realizadas aparecerão aqui.</p></div>
                  : <div className="mt-3 space-y-2.5">{historyDeliveries.map((delivery) => <article className="courier-history-row" key={delivery.id} data-testid={`history-delivery-${delivery.id}`}>
                    <div className="flex items-start justify-between gap-3"><div className="min-w-0"><p className="font-mono text-xs font-bold text-[#a51b26]">{delivery.code}</p><h3 className="mt-1 truncate text-sm font-bold">{delivery.customerName}</h3></div><span className={`courier-history-status ${delivery.status === "COMPLETED" ? "completed" : "not-delivered"}`}>{delivery.status === "COMPLETED" ? "Concluída" : "Não realizada"}</span></div>
                    <p className="mt-2 line-clamp-2 text-xs leading-relaxed text-muted-foreground">{delivery.destination}</p>
                    <div className="mt-3 flex items-center justify-between gap-3 border-t border-[#eee9e3] pt-2.5 text-xs"><span className="truncate text-muted-foreground">{delivery.storeName}{delivery.createdAt ? ` · Criada ${new Date(delivery.createdAt).toLocaleDateString("pt-BR", { day: "2-digit", month: "short" })}` : ""}</span></div>
                  </article>)}</div>}
          </TabsContent>

          <TabsContent value="earnings" forceMount aria-hidden={activeTab !== "earnings"} className={`courier-tab-panel courier-tab-panel--deliveries ${skipTabTransition ? "courier-tab-panel--no-transition" : ""}`}>
            <div className="courier-page-heading"><div className="eyebrow">SEU DESEMPENHO</div><h1>Ganhos</h1><p>Totais informados pela Central.</p></div>
            <div className="courier-activity-switch" role="tablist" aria-label="Histórico e ganhos">
              <button type="button" role="tab" aria-selected="false" onClick={() => changeActiveTab("history")} data-testid="tab-courier-history">Histórico</button>
              <button type="button" role="tab" aria-selected="true" onClick={() => changeActiveTab("earnings")} data-testid="tab-courier-earnings-page">Ganhos</button>
            </div>
            <div className="courier-period-switch" role="tablist" aria-label="Período dos ganhos">
              {(["day", "week", "month"] as const).map((option) => <button key={option} type="button" role="tab" aria-selected={period === option} onClick={() => setPeriod(option)} data-testid={`tab-earnings-${option}`}>{periodNames[option]}</button>)}
            </div>
            {earnings.isError ? <div className="courier-state-card mt-3" role="alert"><p className="font-bold">Não foi possível consultar seus ganhos.</p><button type="button" className="button-secondary mt-3" onClick={() => void earnings.refetch()}>Tentar novamente</button></div>
              : <section className="courier-earnings-hero mt-3" aria-live="polite" data-testid="summary-courier-earnings">
                <span className="courier-summary-icon"><TrendingUp size={18} /></span><p className="mt-4 text-xs font-semibold text-white/75">A receber · {periodNames[period].toLocaleLowerCase("pt-BR")}</p>
                <strong className="mt-1 block text-3xl font-extrabold tracking-tight">{earnings.isLoading ? "—" : money(earnings.data?.amountToReceive ?? 0)}</strong>
                <div className="mt-4 flex items-center justify-between border-t border-white/20 pt-3 text-xs"><span className="text-white/75">Entregas concluídas</span><b>{earnings.isLoading ? "—" : `${earnings.data?.completedDeliveries ?? "—"} ${earnings.data?.completedDeliveries === 1 ? "entrega concluída" : "entregas concluídas"}`}</b></div>
              </section>}
            <button type="button" className="button-secondary mt-4 min-h-12 w-full justify-center" onClick={() => changeActiveTab("history")}><History size={16} /> Ver histórico de entregas</button>
          </TabsContent>

          <TabsContent value="map" forceMount aria-hidden={activeTab !== "map"} data-transitioning={tabTransitioning ? "true" : "false"} className={`courier-tab-panel courier-tab-panel--map fixed inset-0 z-50 m-0 h-[100dvh] overflow-hidden ${skipTabTransition ? "courier-tab-panel--no-transition" : ""}`}>
            {activeRoute ? <CourierRouteMapTab route={activeRoute} currentPosition={currentPosition} activeDelivery={activeRouteDelivery} resizeVersion={mapResizeVersion} />
              : activeIndividualDelivery ? <CourierDeliveryNavigation deliveryId={activeIndividualDelivery.id} delivery={activeIndividualDelivery} resizeVersion={mapResizeVersion} />
                : <section className="grid h-full place-items-center p-6 text-center"><div><MapIcon className="mx-auto text-muted-foreground" size={24} /><h2 className="mt-3 text-base font-bold">Nenhuma rota ativa no momento</h2><p className="mx-auto mt-1 max-w-sm text-sm text-muted-foreground">Quando você aceitar uma rota ou entrega, o mapa com o destino aparecerá aqui.</p>{(routes.data ?? []).some((route) => route.status === "OFFERED") && <p className="mt-2 text-xs text-muted-foreground">Há uma rota aguardando aceite. Acesse Início para aceitar e calcular o trajeto.</p>}<button type="button" className="button-primary mt-4 min-h-12" onClick={() => changeActiveTab("deliveries")}><PackageCheck size={15} /> Ver início</button></div></section>}
          </TabsContent>
        </Tabs>
      </div>

      <nav className="courier-bottom-nav" aria-label="Navegação principal">
        <button type="button" className={activeTab === "deliveries" ? "active" : ""} onClick={() => changeActiveTab("deliveries")} aria-current={activeTab === "deliveries" ? "page" : undefined} data-testid="nav-courier-home">
          <span className="courier-nav-icon"><House size={19} /></span><span>Início</span>{pendingOffers > 0 && <i className="courier-offer-badge">{pendingOffers}</i>}
        </button>
        <button type="button" className="courier-nav-map" onClick={() => changeActiveTab("map")} aria-label="Abrir mapa" data-testid="nav-courier-map"><span><MapIcon size={22} /></span><small>Mapa</small></button>
        <button type="button" className={activeTab === "history" || activeTab === "earnings" ? "active" : ""} onClick={() => changeActiveTab("history")} aria-current={activeTab === "history" || activeTab === "earnings" ? "page" : undefined} data-testid="nav-courier-history"><span className="courier-nav-icon"><History size={19} /></span><span>Histórico e ganhos</span></button>
      </nav>
    </main>
  );
}

function CourierIndividualDeliveryCard({
  delivery,
  active,
  busy,
  declining,
  nextStatus,
  nextStatusLabel: actionLabel,
  onUpdate,
  onDecline,
  onShowMap,
}: {
  delivery: Delivery;
  active: boolean;
  busy: boolean;
  declining: boolean;
  nextStatus?: string;
  nextStatusLabel?: string;
  onUpdate: (deliveryId: string, status: string, evidencePath?: string) => Promise<void>;
  onDecline: (deliveryId: string) => Promise<void>;
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

  if (delivery.status === "IN_TRANSIT") {
    return (
      <article className="courier-active-delivery" data-delivery-status={delivery.status} data-testid={`card-delivery-${delivery.id}`}>
        <h3 className="courier-active-delivery__customer">{delivery.customerName}</h3>
        <p className="courier-active-delivery__status">A caminho do cliente</p>
        <p className="courier-active-delivery__destination" title={delivery.destination}>{delivery.destination}</p>
        {delivery.notes && (
          <p className="courier-active-delivery__notes">
            <MessageCircle size={16} aria-hidden="true" />
            <span>Observação: {delivery.notes}</span>
          </p>
        )}
        <div className="courier-active-delivery__details">
          <span>
            {[delivery.distanceKm != null ? `${Number(delivery.distanceKm).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} km` : null, delivery.estimatedMinutes != null ? `${delivery.estimatedMinutes} min` : null].filter(Boolean).join(" · ")}
          </span>
          <strong>{money(delivery.deliveryAmount)}</strong>
        </div>
        <div className="courier-active-delivery__actions" aria-label="Contato e rota">
          {delivery.customerPhone && (
            <a className="courier-icon-action" href={`tel:${delivery.customerPhone}`} aria-label="Telefone do cliente" title="Telefone">
              <Phone size={19} aria-hidden="true" />
            </a>
          )}
          {whatsappNumber && (
            <a className="courier-icon-action" href={`https://wa.me/${whatsappNumber}`} target="_blank" rel="noreferrer" aria-label="WhatsApp do cliente" title="WhatsApp">
              <MessageCircle size={19} aria-hidden="true" />
            </a>
          )}
          <button type="button" className="courier-icon-action" onClick={onShowMap} aria-label="Ver rota no mapa" title="Mapa">
            <MapIcon size={19} aria-hidden="true" />
          </button>
        </div>
        <div className="courier-active-delivery__evidence">
          {nextStatus && <EvidencePhotoAction
            deliveryId={delivery.id}
            disabled={busy}
            label="Tirar foto da entrega"
            confirmationLabel="Deslize para confirmar"
            onComplete={async (evidencePath) => onUpdate(delivery.id, nextStatus, evidencePath)}
          />}
        </div>
        <CourierUnableToDeliverAction deliveryId={delivery.id} disabled={busy} className="courier-active-delivery__unable" />
      </article>
    );
  }

  return (
    <article className={`panel courier-delivery-card ${active ? "courier-delivery-card--active border-l-4 border-l-[#a91d2a]" : ""}`} data-delivery-status={delivery.status} data-testid={`card-delivery-${delivery.id}`}>
      <div className="courier-delivery-card-heading">
        <div className="min-w-0">
          <div className="courier-delivery-code">{delivery.status === "OFFERED" ? `Nova entrega ${delivery.code}` : delivery.code}</div>
          <h3>{delivery.customerName}</h3>
          {delivery.status !== "OFFERED" && <p>{statusLabel[delivery.status] ?? delivery.status}</p>}
        </div>
        <span className="courier-delivery-mark" aria-hidden="true">
          <PackageCheck size={20} />
        </span>
      </div>
      {delivery.storeLatitude != null && delivery.storeLongitude != null &&
        delivery.customerLatitude != null && delivery.customerLongitude != null && (
        <div className="courier-map-preview courier-delivery-map mt-3 overflow-hidden rounded-xl border border-[#e9e3da]" data-testid={`map-preview-${delivery.id}`}>
          <LiveMap
            markers={[
              {
                id: `store-${delivery.id}`,
                latitude: delivery.storeLatitude,
                longitude: delivery.storeLongitude,
                title: `Filial · ${delivery.storeName}`,
                detail: delivery.storeAddress ?? delivery.storeName,
                kind: "store",
                label: "F",
              },
              {
                id: `destination-${delivery.id}`,
                latitude: delivery.customerLatitude,
                longitude: delivery.customerLongitude,
                title: `Destino · ${delivery.customerName}`,
                detail: delivery.destination,
                kind: "stop",
                sequence: 1,
              },
            ]}
            ariaLabel={`Prévia da filial e destino da entrega ${delivery.code}`}
            size="compact"
            showCenterOnMe={false}
            autoFitOnGeometryChange
          />
        </div>
      )}
      <div className="courier-delivery-locations">
        <p><MapPin size={15} aria-hidden="true" /><span><b>Retirada:</b> {delivery.storeName}{delivery.storeAddress ? ` · ${delivery.storeAddress}` : ""}</span></p>
        <p><MapPin size={15} aria-hidden="true" /><span><b>Destino:</b> {delivery.destination}</span></p>
      </div>
      {delivery.notes && <p className="mt-2 rounded-lg bg-[#f6f4f1] p-3 text-xs">Observações: {delivery.notes}</p>}
      {delivery.status === "OFFERED" && (delivery.estimatedMinutes != null || delivery.distanceKm != null || delivery.deliveryAmount != null) && (
        <div className="courier-offer-estimate" aria-label="Estimativa da entrega">
          <span>
            {[delivery.distanceKm != null ? `${Number(delivery.distanceKm).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} km` : null, delivery.estimatedMinutes != null ? `${delivery.estimatedMinutes} min` : null].filter(Boolean).join(" · ")}
          </span>
          <strong>{money(delivery.deliveryAmount)}</strong>
        </div>
      )}
      {delivery.status !== "OFFERED" && (delivery.estimatedMinutes != null || delivery.distanceKm != null) && (
        <div className="mt-3 flex flex-wrap gap-2 text-[11px] font-semibold text-[#6d625a]" aria-label="Estimativa da entrega">
          {delivery.estimatedMinutes != null && <span className="inline-flex items-center gap-1 rounded-full bg-[#f4f0eb] px-2.5 py-1.5"><Clock3 size={13} />{delivery.estimatedMinutes} min</span>}
          {delivery.distanceKm != null && <span className="inline-flex items-center gap-1 rounded-full bg-[#f4f0eb] px-2.5 py-1.5"><RouteIcon size={13} />{delivery.distanceKm} km</span>}
        </div>
      )}
      {isReturning && (
        <p className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs font-semibold text-amber-950">
          Leve o produto de volta à filial ao encerrar a rota.
        </p>
      )}
      {!isReturning && (active || ["ACCEPTED", "TO_STORE", "AT_STORE", "IN_TRANSIT"].includes(delivery.status)) && (
        <div className="courier-delivery-contact-actions mt-3 flex flex-wrap gap-2">
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
        </div>
      )}
      <div className="courier-delivery-footer mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-border pt-3">
        <span className="courier-delivery-amount">{money(delivery.deliveryAmount)}</span>
        {delivery.status === "IN_TRANSIT" && nextStatus ? (
          <div className="courier-delivery-evidence w-full space-y-2">
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
      {delivery.status === "OFFERED" && (
        <button
          type="button"
          className="courier-decline-button mt-2 w-full"
          disabled={busy || declining}
          onClick={() => void onDecline(delivery.id)}
          aria-busy={declining}
          data-testid={`button-decline-delivery-${delivery.id}`}
        >
          {declining ? <><LoaderCircle size={15} className="animate-spin" /> Recusando oferta…</> : "Recusar oferta"}
        </button>
      )}
    </article>
  );
}
