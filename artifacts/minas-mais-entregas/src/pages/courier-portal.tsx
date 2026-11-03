import { useQueryClient } from "@tanstack/react-query";
import {
  getGetCourierDeliveryNavigationQueryKey,
  getGetCourierEarningsQueryKey,
  getListCourierRoutesQueryKey,
  getListDeliveriesQueryKey,
  getGetPushConfigQueryKey,
  useGetPushConfig,
  useSavePushSubscription,
  useRemovePushSubscription,
  useGetCourierEarnings,
  useListCourierRoutes,
  useListDeliveries,
  useUpdateDeliveryStatus,
  useUpdateCourierLocation,
  type AppUser,
} from "@workspace/api-client-react";
import { useClerk } from "@clerk/react";
import { Bike, CheckCircle2, Clock3, LogOut, PackageCheck, Bell, BellOff } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import CourierDeliveryNavigation from "@/components/courier-delivery-navigation";
import CourierRoutesSection from "@/pages/courier-routes-section";
import EvidencePhotoAction from "@/components/evidence-photo-action";

type Period = "day" | "week" | "month";
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
  ACCEPTED: "Aceita",
  TO_STORE: "A caminho da unidade",
  AT_STORE: "Na unidade",
  IN_TRANSIT: "Em entrega",
  COMPLETED: "Concluída",
};
const money = (amount: number) =>
  amount.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

function decodeVapidKey(value: string) {
  const stripWrappingQuotes = (input: string) => {
    const trimmed = input.trim();
    if (
      (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
      (trimmed.startsWith("'") && trimmed.endsWith("'"))
    ) {
      return trimmed.slice(1, -1).trim();
    }
    return trimmed;
  };

  let normalized = stripWrappingQuotes(value)
    .replace(/^(?:VAPID_)?PUBLIC_KEY\s*[:=]\s*/i, "")
    .replace(/^public\s+key\s*:\s*/i, "");
  normalized = stripWrappingQuotes(normalized).replace(/\s+/g, "");
  if (!/^[A-Za-z0-9+/_-]+={0,2}$/.test(normalized)) {
    throw new Error("A chave VAPID pública está em formato inválido. Use apenas o valor da chave, sem cabeçalho PEM ou rótulo.");
  }

  const unpadded = normalized.replace(/=+$/, "");
  if (unpadded.length % 4 === 1) {
    throw new Error("A chave VAPID pública está incompleta. Confira o segredo VAPID_PUBLIC_KEY.");
  }

  const base64 = unpadded.replace(/-/g, "+").replace(/_/g, "/");
  const padded = `${base64}${"=".repeat((4 - (base64.length % 4)) % 4)}`;
  const raw = window.atob(padded);
  if (raw.length !== 65 || raw.charCodeAt(0) !== 4) {
    throw new Error("A chave VAPID pública tem tamanho inválido. Confira o segredo VAPID_PUBLIC_KEY.");
  }
  return Uint8Array.from(raw, (character) => character.charCodeAt(0));
}

export default function CourierPortal({ profile }: { profile: AppUser }) {
  const { signOut } = useClerk();
  const queryClient = useQueryClient();
  const [period, setPeriod] = useState<Period>("day");
  const [actionError, setActionError] = useState("");
  const [pushMessage, setPushMessage] = useState("");
  const [pushSubscription, setPushSubscription] = useState<PushSubscription | null>(null);
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
  const pushConfig = useGetPushConfig({ query: { queryKey: getGetPushConfigQueryKey() } });
  const savePush = useSavePushSubscription();
  const removePush = useRemovePushSubscription();
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    void navigator.serviceWorker.ready
      .then((registration) => registration.pushManager.getSubscription())
      .then((subscription) => setPushSubscription(subscription));
  }, []);
  const togglePush = async () => {
    setPushMessage("");
    if (!pushConfig.data?.enabled || !pushConfig.data.publicKey) {
      setPushMessage("Notificações push não estão configuradas nesta instalação. Avise a central para habilitar o serviço.");
      return;
    }
    try {
      if (pushSubscription) {
        const json = pushSubscription.toJSON();
        if (!json.endpoint || !json.keys?.p256dh || !json.keys.auth) throw new Error("A assinatura atual não contém as chaves necessárias.");
        await removePush.mutateAsync({ data: { endpoint: json.endpoint, p256dh: json.keys.p256dh, auth: json.keys.auth } });
        await pushSubscription.unsubscribe();
        setPushSubscription(null);
        setPushMessage("Notificações desativadas neste aparelho.");
      } else {
        if (!("serviceWorker" in navigator) || !("PushManager" in window)) throw new Error("Este navegador não oferece notificações push.");
        const applicationServerKey = decodeVapidKey(pushConfig.data.publicKey);
        const permission = await Notification.requestPermission();
        if (permission !== "granted") throw new Error("Permita notificações nas configurações do navegador para ativar os avisos.");
        const registration = await navigator.serviceWorker.ready;
        const subscription = await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey,
        });
        const json = subscription.toJSON();
        if (!json.endpoint || !json.keys?.p256dh || !json.keys.auth) throw new Error("Não foi possível obter os dados da assinatura.");
        await savePush.mutateAsync({ data: { endpoint: json.endpoint, p256dh: json.keys.p256dh, auth: json.keys.auth } });
        setPushSubscription(subscription);
        setPushMessage("Notificações ativadas neste aparelho.");
      }
      await queryClient.invalidateQueries({ queryKey: getGetPushConfigQueryKey() });
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
    <main className="min-h-[100dvh] bg-[#f4f3f1] px-4 pb-10 pt-4 text-[#24272d] sm:px-6">
      <div className="mx-auto max-w-2xl">
        <header className="flex items-center justify-between rounded-xl border border-[#e7e6e3] bg-white px-4 py-3">
          <div className="flex items-center gap-3">
            <span className="brand-mark"><Bike size={18} /></span>
            <div>
              <div className="text-sm font-bold">Minas Mais</div>
              <div className="text-[11px] text-muted-foreground">Área do motoboy</div>
            </div>
          </div>
          <button
            className="button-quiet"
            onClick={() => void signOut({ redirectUrl: import.meta.env.BASE_URL })}
          >
            <LogOut size={15} /> Sair
          </button>
        </header>

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
            <span className="metric-icon metric-icon-red mt-0.5">{pushSubscription ? <Bell size={16} /> : <BellOff size={16} />}</span>
            <div>
              <h2 className="text-sm font-bold">Avisos de novas entregas</h2>
              <p className="mt-1 text-xs text-muted-foreground">
                {pushConfig.isLoading ? "Consultando configuração…" : pushConfig.isError ? "Não foi possível consultar a configuração de notificações." : !pushConfig.data?.enabled || !pushConfig.data.publicKey ? "Notificações push não estão configuradas para esta operação." : pushSubscription ? "Notificações ativadas neste aparelho." : "Ative para receber notificações neste aparelho."}
              </p>
              {pushConfig.isError && <button type="button" className="mt-1 text-xs font-semibold text-primary" onClick={() => void pushConfig.refetch()}>Tentar consultar novamente</button>}
              {pushMessage && <p role="status" className="mt-2 text-xs text-[#8b3d45]">{pushMessage}</p>}
            </div>
          </div>
          <button type="button" className={pushSubscription ? "button-secondary min-h-10" : "button-primary min-h-10"} onClick={() => void togglePush()} disabled={pushConfig.isLoading || savePush.isPending || removePush.isPending || (!pushSubscription && (!pushConfig.data?.enabled || !pushConfig.data.publicKey))} data-testid="button-toggle-push">
            {pushSubscription ? <BellOff size={15} /> : <Bell size={15} />}
            {savePush.isPending || removePush.isPending ? "Atualizando…" : pushSubscription ? "Desativar avisos" : "Ativar avisos"}
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
          routes={routes.data ?? []}
          isLoading={routes.isLoading}
          isError={routes.isError}
          onRetry={() => void routes.refetch()}
        />

        <section className="mt-6">
          <div className="mb-3 flex items-end justify-between">
            <div>
              <div className="eyebrow">SUA OPERAÇÃO</div>
              <h2 className="mt-1 text-lg font-bold">Entregas atribuídas</h2>
            </div>
            <span className="text-xs text-muted-foreground">{individualDeliveries.length} registros</span>
          </div>
          {deliveries.isLoading || routes.isLoading ? (
            <div className="panel p-5 text-sm text-muted-foreground">Carregando suas entregas…</div>
          ) : deliveries.isError || routes.isError ? (
            <div className="panel p-5 text-sm text-red-700">Não foi possível carregar as entregas.</div>
          ) : individualDeliveries.length ? (
            <div className="space-y-3">
              {individualDeliveries.map((delivery) => {
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
                      <CourierDeliveryNavigation deliveryId={delivery.id} />
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
                            className="button-primary min-h-9"
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
        <footer className="mt-6 text-center text-[11px] text-muted-foreground">
          {profile.email} · valores calculados pelo sistema a partir do valor cadastrado por entrega.
        </footer>
      </div>
    </main>
  );
}
