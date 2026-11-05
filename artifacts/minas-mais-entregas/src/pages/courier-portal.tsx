import { useQueryClient } from "@tanstack/react-query";
import appMetadata from "../../package.json";
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
import { PushNotifications } from "@capacitor/push-notifications";
import { LocalNotifications } from "@capacitor/local-notifications";
import { Preferences } from "@capacitor/preferences";
import { ArrowLeft, Bell, BellOff, Bike, Check, CheckCircle2, Clock3, Hand, History, KeyRound, LoaderCircle, LocateFixed, LogOut, Map as MapIcon, MapPin, MessageCircle, PackageCheck, Phone, Route as RouteIcon, TrendingUp } from "lucide-react";
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
  const [gpsDetailsOpen, setGpsDetailsOpen] = useState(false);
  const [pushDetailsOpen, setPushDetailsOpen] = useState(false);
  const [gpsStatus, setGpsStatus] = useState<CourierGpsStatus>(initialGpsStatus);
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
    <main className={`courier-pwa min-h-[100dvh] bg-[#f5f2ee] text-[#272729] ${activeTab === "map" ? "fixed inset-0 z-40 overflow-hidden" : "pb-[calc(88px+env(safe-area-inset-bottom))]"}`}>
      {activeTab !== "map" && (
        <header className="courier-header px-4 pb-4 pt-[max(10px,env(safe-area-inset-top))] text-white">
          <div className="mx-auto max-w-2xl">
            <div className="flex min-h-10 items-center justify-between gap-3">
              <div className="flex min-w-0 items-center gap-2.5" aria-label="Minas Mais Entregas">
                <span className="courier-brand-mark"><Bike size={18} strokeWidth={2.4} /></span>
                <span className="truncate text-[11px] font-extrabold uppercase leading-[1.15] tracking-[.12em]">MINAS MAIS<br />ENTREGAS</span>
              </div>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  className="courier-header-status"
                  aria-label={gpsStatus.tone === "red" ? "GPS com problema. Ver detalhes" : "Ver status do GPS"}
                  aria-expanded={gpsDetailsOpen}
                  onClick={() => { setGpsDetailsOpen((open) => !open); setPushDetailsOpen(false); }}
                  data-testid="button-courier-gps-status"
                >
                  <LocateFixed size={17} /><i className={`status-dot status-${gpsStatus.tone}`} />
                </button>
                <button
                  type="button"
                  className="courier-header-status"
                  aria-label={pushIsActive ? "Notificações ativadas. Ver detalhes" : "Notificações desativadas. Ver detalhes"}
                  aria-expanded={pushDetailsOpen}
                  onClick={() => { setPushDetailsOpen((open) => !open); setGpsDetailsOpen(false); }}
                  data-testid="button-courier-push-status"
                >
                  {pushIsActive ? <Bell size={17} /> : <BellOff size={17} />}
                  <i className={`status-dot ${pushIsActive ? "status-green" : "status-yellow"}`} />
                </button>
                <Sheet open={menuOpen} onOpenChange={setMenuOpen}>
                  <SheetTrigger asChild>
                    <button type="button" className="courier-avatar-button" aria-label="Abrir perfil" data-testid="button-courier-profile">
                      {firstName.charAt(0).toLocaleUpperCase("pt-BR")}
                    </button>
                  </SheetTrigger>
                  <SheetContent side="right" className="courier-profile-sheet flex w-[min(23rem,calc(100vw-1rem))] flex-col border-0 bg-[#faf8f4] p-5 pb-[max(20px,env(safe-area-inset-bottom))] pt-[max(24px,env(safe-area-inset-top))] [&>button]:grid [&>button]:h-12 [&>button]:min-h-12 [&>button]:min-w-12 [&>button]:w-12 [&>button]:place-items-center">
                    <SheetHeader className="text-left">
                      <SheetTitle className="text-xl font-bold">Seu perfil</SheetTitle>
                      <SheetDescription>Seus dados locais e preferências deste aparelho.</SheetDescription>
                    </SheetHeader>
                    <div className="mt-6 flex items-center gap-3 rounded-2xl bg-white p-4">
                      <span className="courier-profile-avatar">{firstName.charAt(0).toLocaleUpperCase("pt-BR")}</span>
                      <div className="min-w-0"><p className="truncate text-sm font-bold">{profile.name || firstName}</p><p className="truncate text-xs text-muted-foreground">{profile.email}</p></div>
                    </div>
                    <dl className="mt-4 divide-y divide-[#e9e4dc] rounded-2xl bg-white px-4">
                      <div className="py-3"><dt className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Telefone</dt><dd className="mt-1 text-sm">{profile.phone || "Não informado"}</dd></div>
                      <div className="py-3"><dt className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Filial</dt><dd className="mt-1 text-sm">{profile.storeName || profile.storeId || "Não vinculada"}</dd></div>
                      <div className="py-3"><dt className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Conta</dt><dd className="mt-1 text-sm">{profile.email}</dd></div>
                    </dl>
                    <div className="mt-4 space-y-2">
                      <button type="button" className="button-secondary min-h-12 w-full justify-start" onClick={() => void togglePush()} disabled={pushToggleDisabled} data-testid="button-courier-notifications">
                        {pushIsActive ? <BellOff size={17} /> : <Bell size={17} />}
                        {pushIsActive ? "Desativar notificações" : "Ativar notificações"}
                      </button>
                      {pushMessage && <p role="status" className="px-1 text-xs text-[#8b3d45]">{pushMessage}</p>}
                      <Link href="/account" onClick={() => setMenuOpen(false)} className="button-secondary min-h-12 w-full justify-start" data-testid="link-courier-password">
                        <KeyRound size={17} /> Alterar senha
                      </Link>
                    </div>
                    <p className="mt-auto border-t border-[#e9e4dc] pt-4 text-xs text-muted-foreground">Minas Mais Entregas · Versão {appMetadata.version}</p>
                    <button type="button" className="button-quiet min-h-12 w-full justify-start" onClick={() => void handleSignOut()} data-testid="button-courier-sign-out">
                      <LogOut size={17} /> Sair da conta
                    </button>
                  </SheetContent>
                </Sheet>
              </div>
            </div>
            <div className="mt-3 flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="flex items-center gap-1.5 text-[13px] text-white/80"><Hand size={15} /> Olá, {firstName}</p>
                <h1 className="mt-0.5 text-xl font-extrabold tracking-[-.03em]">Sua jornada, no seu ritmo.</h1>
              </div>
              <span className="shrink-0 rounded-full border border-white/25 bg-white/10 px-2.5 py-1 text-[9px] font-bold uppercase tracking-[.12em]">Motoboy</span>
            </div>
            {(gpsDetailsOpen || pushDetailsOpen) && (
              <aside className="relative z-30 mt-3 rounded-xl bg-white p-4 text-[#29292b] shadow-lg" role="status">
                {gpsDetailsOpen ? <>
                  <div className="flex items-center gap-2 text-sm font-bold"><LocateFixed size={16} /> Status do GPS</div>
                  <p className="mt-2 text-xs">{gpsStatus.hasSent ? gpsNeedsAttention ? `Último envio há ${Math.floor(gpsStatus.ageSeconds / 60)} min.` : `Último envio há ${gpsStatus.ageSeconds} s.` : "Aguardando a primeira posição do aparelho."}</p>
                  {gpsStatus.accuracyMeters != null && <p className="mt-1 text-xs text-muted-foreground">Precisão aproximada: {Math.round(gpsStatus.accuracyMeters)} m.</p>}
                  {gpsStatus.locationMessage && <p className="mt-2 text-xs text-muted-foreground">{gpsStatus.locationMessage}</p>}
                  <button type="button" className="button-secondary mt-3 min-h-12 w-full justify-center" onClick={() => refreshGps()}><LocateFixed size={15} /> Tentar atualizar GPS</button>
                </> : <>
                  <div className="flex items-center gap-2 text-sm font-bold">{pushIsActive ? <Bell size={16} /> : <BellOff size={16} />} Notificações</div>
                  <p className="mt-2 text-xs">{!notificationStatusReady ? "Verificando este aparelho…" : pushIsActive ? isNativeApp ? "Ativadas neste aparelho." : "Ativadas para este PWA." : serviceWorkerStatus === "missing" ? "O Service Worker não está ativo. Feche e reabra o PWA." : pushKey.isError || (!isNativeApp && !currentVapidBytes) ? "Não foi possível carregar a configuração das notificações." : "Desativadas neste aparelho."}</p>
                  {pushMessage && <p className="mt-2 text-xs text-[#8b3d45]">{pushMessage}</p>}
                  <button type="button" className="button-secondary mt-3 min-h-12 w-full justify-center" onClick={() => void togglePush()} disabled={pushToggleDisabled}><Bell size={15} /> Configurar notificações</button>
                </>}
              </aside>
            )}
          </div>
        </header>
      )}

      <div className={activeTab === "map" ? "h-full w-full" : "mx-auto max-w-2xl px-3 pt-3 sm:px-5"}>
        <Tabs value={activeTab} onValueChange={changeActiveTab}>
          <TabsContent value="deliveries" forceMount aria-hidden={activeTab !== "deliveries"} className={`courier-tab-panel courier-tab-panel--deliveries ${activeTab === "deliveries" ? "mt-0" : ""} ${skipTabTransition ? "courier-tab-panel--no-transition" : ""}`} data-transitioning={tabTransitioning ? "true" : "false"}>
            <section className={`courier-online-card ${isOnline ? "is-online" : "is-offline"}`} aria-label="Disponibilidade do motoboy">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className={`courier-online-pulse ${isOnline ? "is-online" : ""}`} />
                  <span className="text-[10px] font-extrabold uppercase tracking-[.14em]">{isOnline ? "Você está online" : "Você está offline"}</span>
                </div>
                <p className="mt-1 text-[12px] leading-snug text-current/75">{isOnline ? "Pronto para receber novas entregas." : "Ative para começar a receber pedidos."}</p>
              </div>
              <button type="button" role="switch" aria-checked={isOnline} aria-label={isOnline ? "Ficar offline" : "Ficar online"} className={`courier-online-toggle ${isOnline ? "active" : ""}`} onClick={() => void toggleAvailability()} disabled={updateAvailability.isPending} aria-busy={updateAvailability.isPending} data-testid="toggle-courier-availability">
                <span className="courier-online-knob">{updateAvailability.isPending ? <LoaderCircle size={14} className="animate-spin" /> : isOnline ? <Check size={14} /> : null}</span>
              </button>
            </section>
            {availabilityError && <div className="mt-2 rounded-xl border border-[#edc9c4] bg-[#fff1ed] px-3 py-2.5 text-xs leading-relaxed text-[#94382e]" role="alert" data-testid="alert-courier-availability">{availabilityError}</div>}
            {(notificationsNeedAttention || gpsNeedsAttention) && (
              <section className="mt-3 flex items-start gap-2 rounded-xl border border-[#ead9b4] bg-[#fff8e9] p-3 text-[#6d5121]" role="status" data-testid="alert-courier-device">
                {notificationsNeedAttention ? <BellOff size={16} className="mt-0.5 shrink-0" /> : <LocateFixed size={16} className="mt-0.5 shrink-0" />}
                <div className="min-w-0 flex-1 text-xs leading-relaxed">{notificationsNeedAttention && <p>Notificações desativadas neste aparelho.</p>}{gpsNeedsAttention && <p>Sem envio de GPS há mais de 1 minuto.</p>}</div>
                <button type="button" className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-white text-[#755b2c]" aria-label="Ver detalhes do GPS" onClick={() => { setGpsDetailsOpen(true); setPushDetailsOpen(false); }} data-testid="button-courier-device-alert"><ArrowLeft size={15} className="rotate-180" /></button>
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
            <button type="button" className="courier-daily-summary mt-3 w-full text-left" onClick={() => changeActiveTab("earnings")} data-testid="button-courier-daily-summary">
              <span className="courier-summary-icon"><TrendingUp size={17} /></span>
              <span className="min-w-0 flex-1"><span className="block text-[10px] font-bold uppercase tracking-[.12em] text-[#827a71]">Resumo de hoje</span><span className="mt-1 block text-sm font-bold">{dailyEarnings.isLoading ? "Atualizando seus totais…" : `${dailyEarnings.data?.completedDeliveries ?? "—"} entregas concluídas`}</span></span>
              <strong className="shrink-0 text-sm">{dailyEarnings.isLoading ? "—" : money(dailyEarnings.data?.amountToReceive ?? 0)}</strong>
            </button>
          </TabsContent>

          <TabsContent value="history" forceMount aria-hidden={activeTab !== "history"} className={`courier-tab-panel courier-tab-panel--deliveries ${skipTabTransition ? "courier-tab-panel--no-transition" : ""}`}>
            <div className="courier-page-heading"><div className="eyebrow">SUAS ATIVIDADES</div><h1>Histórico</h1><p>Entregas concluídas e não realizadas.</p></div>
            <div className="courier-activity-switch" role="tablist" aria-label="Histórico e ganhos">
              <button type="button" role="tab" aria-selected="true" onClick={() => changeActiveTab("history")} data-testid="tab-courier-history">Histórico</button>
              <button type="button" role="tab" aria-selected="false" onClick={() => changeActiveTab("earnings")} data-testid="tab-courier-earnings-page">Ganhos</button>
            </div>
            <section className="courier-total-strip" aria-label="Totais do período">
              {(["day", "week", "month"] as const).map((key) => {
                const value = key === "day" ? dailyEarnings : key === "week" ? weeklyEarnings : monthlyEarnings;
                return <div className="courier-total-cell" key={key}><span>{periodNames[key]}</span><strong>{value.isLoading ? "—" : value.data?.completedDeliveries ?? "—"} entregas</strong><b>{value.isLoading ? "—" : money(value.data?.amountToReceive ?? 0)}</b></div>;
              })}
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
                <div className="mt-4 flex items-center justify-between border-t border-white/20 pt-3 text-xs"><span className="text-white/75">Entregas concluídas</span><b>{earnings.isLoading ? "—" : earnings.data?.completedDeliveries ?? "—"}</b></div>
              </section>}
            <h2 className="mb-3 mt-6 text-base font-extrabold">Visão por período</h2>
            <section className="courier-total-strip" aria-label="Totais de ganhos por período">
              {([{ label: "Hoje", value: dailyEarnings }, { label: "Esta semana", value: weeklyEarnings }, { label: "Este mês", value: monthlyEarnings }]).map(({ label, value }) => <div className="courier-total-cell" key={label}><span>{label}</span><strong>{value.isLoading ? "—" : value.data?.completedDeliveries ?? "—"} entregas</strong><b>{value.isLoading ? "—" : money(value.data?.amountToReceive ?? 0)}</b></div>)}
            </section>
            <button type="button" className="button-secondary mt-4 min-h-12 w-full justify-center" onClick={() => changeActiveTab("history")}><History size={16} /> Ver histórico de entregas</button>
          </TabsContent>

          <TabsContent value="map" forceMount aria-hidden={activeTab !== "map"} data-transitioning={tabTransitioning ? "true" : "false"} className={`courier-tab-panel courier-tab-panel--map fixed inset-0 z-50 m-0 h-[100dvh] overflow-hidden ${skipTabTransition ? "courier-tab-panel--no-transition" : ""}`}>
            {activeRoute ? <CourierRouteMapTab route={activeRoute} currentPosition={currentPosition} onBack={() => changeActiveTab("deliveries")} onRefresh={() => void routes.refetch()} activeDelivery={activeRouteDelivery} resizeVersion={mapResizeVersion} />
              : activeIndividualDelivery ? <CourierDeliveryNavigation deliveryId={activeIndividualDelivery.id} onBack={() => changeActiveTab("deliveries")} delivery={activeIndividualDelivery} resizeVersion={mapResizeVersion} />
                : <section className="grid h-full place-items-center p-6 text-center"><div><MapIcon className="mx-auto text-muted-foreground" size={24} /><h2 className="mt-3 text-base font-bold">Nenhuma rota ativa no momento</h2><p className="mx-auto mt-1 max-w-sm text-sm text-muted-foreground">Quando você aceitar uma rota ou entrega, o mapa com o destino aparecerá aqui.</p>{(routes.data ?? []).some((route) => route.status === "OFFERED") && <p className="mt-2 text-xs text-muted-foreground">Há uma rota aguardando aceite. Acesse Início para aceitar e calcular o trajeto.</p>}<button type="button" className="button-primary mt-4 min-h-12" onClick={() => changeActiveTab("deliveries")}><PackageCheck size={15} /> Ver início</button></div></section>}
          </TabsContent>
        </Tabs>
      </div>

      {activeTab !== "map" && <nav className="courier-bottom-nav" aria-label="Navegação principal">
        <button type="button" className={activeTab === "deliveries" ? "active" : ""} onClick={() => changeActiveTab("deliveries")} aria-current={activeTab === "deliveries" ? "page" : undefined} data-testid="nav-courier-home">
          <span className="courier-nav-icon"><Bike size={19} /></span><span>Início</span>{pendingOffers > 0 && <i className="courier-offer-badge">{pendingOffers}</i>}
        </button>
        <button type="button" className="courier-nav-map" onClick={() => changeActiveTab("map")} aria-label="Abrir mapa" data-testid="nav-courier-map"><span><MapIcon size={22} /></span><small>Mapa</small></button>
        <button type="button" className={activeTab === "history" || activeTab === "earnings" ? "active" : ""} onClick={() => changeActiveTab("history")} aria-current={activeTab === "history" || activeTab === "earnings" ? "page" : undefined} data-testid="nav-courier-history"><span className="courier-nav-icon"><History size={19} /></span><span>Histórico e ganhos</span></button>
      </nav>}
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
      {delivery.storeLatitude != null && delivery.storeLongitude != null &&
        delivery.customerLatitude != null && delivery.customerLongitude != null && (
        <div className="courier-map-preview mt-3 overflow-hidden rounded-xl border border-[#e9e3da]" data-testid={`map-preview-${delivery.id}`}>
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
      {delivery.notes && <p className="mt-2 rounded-lg bg-[#f6f4f1] p-3 text-xs">Observações: {delivery.notes}</p>}
      {(delivery.estimatedMinutes != null || delivery.distanceKm != null) && (
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
