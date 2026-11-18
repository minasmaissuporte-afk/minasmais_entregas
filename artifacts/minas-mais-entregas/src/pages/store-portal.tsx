import { useQueryClient } from "@tanstack/react-query";
import { useMemo, useState, type ComponentType } from "react";
import {
  getListActiveRoutesQueryKey,
  getListCouriersQueryKey,
  getListDeliveriesQueryKey,
  useListActiveRoutes,
  useListCouriers,
  useListDeliveries,
  useUpdateDeliveryStatus,
  type AppUser,
  type Delivery,
} from "@workspace/api-client-react";
import { BarChart3, Bike, Check, CircleHelp, FilePlus2, KeyRound, LogOut, PackageCheck, Pencil, Truck, X } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { supportWhatsAppUrl } from "@/lib/support";
import { paymentLabel } from "@/lib/payment";
import DeliveryProgress from "@/components/delivery-progress";
import RequeueButton, { REQUEUE_STATUSES } from "@/components/requeue-button";

/** Entrega esperando um motoboy aceitar (pode entrar numa rota agrupada ou ser cancelada pela loja). */
const waitingForCourier = (d: { status: string; courierId?: string | null; routeId?: string | null }) =>
  !d.routeId && (d.status === "REQUESTED" || d.status === "AWAITING_COURIER" || d.status === "NOT_DELIVERED" || (d.status === "OFFERED" && !d.courierId));

/** A loja edita a entrega só enquanto ela está na fila, antes de um motoboy aceitar (mesma regra da API). */
const editableByStore = (d: { status: string; courierId?: string | null; routeId?: string | null }) =>
  !d.routeId && !d.courierId && ["REQUESTED", "OFFERED", "AWAITING_COURIER"].includes(d.status);

/** Último motivo informado pelo motoboy ao devolver a entrega. */
const returnReason = (events: { kind: string; label: string }[]) => {
  const label = [...events].reverse().find((event) => ["courier_unable_to_deliver", "courier_returning_to_store", "courier_route_aborted"].includes(event.kind))?.label;
  if (!label) return "";
  const reason = label.includes(": ") ? label.slice(label.indexOf(": ") + 2) : label;
  return `Motivo: ${reason}`;
};
import LiveMap, { type MapMarker } from "@/components/live-map";
import { Link } from "wouter";
import { StatusBadge } from "@/components/delivery-status";
import { AutoDismissFeedback, type FeedbackMessage } from "@/components/auto-dismiss-feedback";

export default function StorePortal({
  profile,
  NewDeliveryModal,
  DispatchModal,
  GroupRouteModal,
  RemoveFromRouteModal,
  CancelDeliveryModal,
  EditDeliveryModal,
}: {
  profile: AppUser;
  /** Formulário de nova entrega (o mesmo da Central). */
  NewDeliveryModal?: ComponentType<{ onClose: () => void }>;
  /** Despachar uma entrega para um motoboy. */
  DispatchModal?: ComponentType<{ deliveryId: string; onClose: () => void }>;
  /** Montar rota com várias entregas, escolhendo o motoboy. */
  GroupRouteModal?: ComponentType<{ deliveryIds: string[]; onClose: () => void; onCreated: (message: string) => void }>;
  /** Tirar uma entrega da rota (volta para a fila ou é cancelada). */
  RemoveFromRouteModal?: ComponentType<{ delivery: { id: string; code: string; routeId: string; status: string }; onClose: () => void; onDone: (message: string) => void }>;
  /** Cancelar uma entrega que ainda não foi para um motoboy. */
  CancelDeliveryModal?: ComponentType<{ deliveryId: string; code: string; onClose: () => void; onCancelled: () => void }>;
  /** Editar endereço, pagamento, receita e observações enquanto a entrega está na fila. */
  EditDeliveryModal?: ComponentType<{ delivery: Delivery; onClose: () => void; onSaved: () => void }>;
}) {
  const { signOut } = useAuth();
  const [newDeliveryOpen, setNewDeliveryOpen] = useState(false);
  const [dispatchId, setDispatchId] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [groupOpen, setGroupOpen] = useState(false);
  const [routeFeedback, setRouteFeedback] = useState<FeedbackMessage | null>(null);
  const [removeTarget, setRemoveTarget] = useState<{ id: string; code: string; routeId: string; status: string } | null>(null);
  const [cancelTarget, setCancelTarget] = useState<{ id: string; code: string } | null>(null);
  const [editTarget, setEditTarget] = useState<Delivery | null>(null);
  const toggleSelected = (id: string, checked: boolean) =>
    setSelectedIds((current) =>
      checked ? (current.includes(id) || current.length >= 10 ? current : [...current, id]) : current.filter((item) => item !== id),
    );
  const queryClient = useQueryClient();
  const [selectedCourierId, setSelectedCourierId] = useState("");
  const deliveries = useListDeliveries(
    {},
    { query: { queryKey: getListDeliveriesQueryKey(), refetchInterval: 15000 } },
  );
  const couriers = useListCouriers(undefined, {
    query: { queryKey: getListCouriersQueryKey(), refetchInterval: 15000 },
  });
  // Trajeto de cada entrega em andamento da filial (loja → cliente), como no app do motoboy.
  const activeRoutes = useListActiveRoutes({ query: { queryKey: getListActiveRoutesQueryKey(), refetchInterval: 30000 } });
  const routeLines = useMemo(
    () => (activeRoutes.data ?? [])
      .filter((route) => !selectedCourierId || route.courierId === selectedCourierId)
      .map((route) => ({ id: route.id, geometry: route.routeGeometry, color: "#b91e2c" })),
    [activeRoutes.data, selectedCourierId],
  );
  const activeCouriers = useMemo(
    () => (couriers.data ?? []).filter((courier) => courier.status === "BUSY"),
    [couriers.data],
  );
  const effectiveSelectedCourierId = activeCouriers.some(
    (courier) => courier.id === selectedCourierId,
  ) ? selectedCourierId : "";
  const trackingMarkers: MapMarker[] = activeCouriers
    .filter(
      (courier) =>
        (!effectiveSelectedCourierId || courier.id === effectiveSelectedCourierId) &&
        courier.currentLatitude != null &&
        courier.currentLongitude != null,
    )
    .map((courier) => ({
      id: courier.id,
      latitude: courier.currentLatitude!,
      longitude: courier.currentLongitude!,
      title: courier.name,
      label: courier.name.split(" ")[0],
      detail: `Entrega ${courier.currentDeliveryCode ?? ""} · posição recebida ${
        courier.lastLocationAt
          ? new Date(courier.lastLocationAt).toLocaleTimeString("pt-BR", {
              hour: "2-digit",
              minute: "2-digit",
            })
          : "sem horário"
      }`,
      kind: "courier",
      color: "#b91e2c",
    }));
  // Loja e cliente de cada entrega em andamento: início e fim do trajeto desenhado.
  const activeDeliveries = (deliveries.data ?? []).filter((delivery) =>
    ["ACCEPTED", "TO_STORE", "AT_STORE", "IN_TRANSIT"].includes(delivery.status) &&
    (!effectiveSelectedCourierId || delivery.courierId === effectiveSelectedCourierId));
  const firstWithStore = activeDeliveries.find((delivery) => delivery.storeLatitude != null && delivery.storeLongitude != null);
  const placeMarkers: MapMarker[] = [
    ...(firstWithStore
      ? [{
          id: `store-${firstWithStore.storeId}`,
          latitude: firstWithStore.storeLatitude!,
          longitude: firstWithStore.storeLongitude!,
          title: firstWithStore.storeName,
          detail: firstWithStore.storeAddress ?? firstWithStore.storeName,
          kind: "store" as const,
          color: "#ffffff",
          textColor: "#b91e2c",
        }]
      : []),
    ...activeDeliveries
      .filter((delivery) => delivery.customerLatitude != null && delivery.customerLongitude != null)
      .map((delivery) => ({
        id: `destination-${delivery.id}`,
        latitude: delivery.customerLatitude!,
        longitude: delivery.customerLongitude!,
        title: `Cliente · ${delivery.customerName}`,
        detail: `${delivery.code} · ${delivery.destination}`,
        kind: "destination" as const,
        color: "#b91e2c",
      })),
  ];
  const updateStatus = useUpdateDeliveryStatus();
  const [pendingDeliveryId, setPendingDeliveryId] = useState<string | null>(null);
  const [pickupFeedback, setPickupFeedback] = useState<{ deliveryId: string; feedback: FeedbackMessage } | null>(null);
  const confirmPickup = (deliveryId: string, code: string) => {
    setPickupFeedback(null);
    setPendingDeliveryId(deliveryId);
    updateStatus.mutate(
      { deliveryId, data: { status: "IN_TRANSIT" } },
      {
        onSuccess: () => {
          setPickupFeedback({ deliveryId, feedback: { kind: "success", text: `Saída de ${code} confirmada. O motoboy já está a caminho do cliente.` } });
          void queryClient.invalidateQueries({ queryKey: getListDeliveriesQueryKey() });
        },
        onError: () => setPickupFeedback({ deliveryId, feedback: { kind: "error", text: "Não foi possível confirmar a saída. Verifique a conexão e tente novamente." } }),
        onSettled: () => setPendingDeliveryId(null),
      },
    );
  };

  return (
    <main className="min-h-[100dvh] bg-[#f4f3f1] px-4 pb-10 pt-4 text-[#24272d] sm:px-6">
      <div className="mx-auto max-w-3xl">
        <header className="flex items-center justify-between rounded-xl border border-[#e7e6e3] bg-white px-4 py-3">
          <div className="flex items-center gap-3">
            <span className="brand-mark">MM</span>
            <div>
              <div className="text-sm font-bold">Minas Mais</div>
              <div className="text-[11px] text-muted-foreground">Área da unidade</div>
            </div>
          </div>
          <div className="flex items-center gap-1 sm:gap-2">
            {profile.role === "STORE_MANAGER" && (
              <Link href="/reports" className="button-secondary min-h-9 px-2 text-xs sm:px-3" aria-label="Contabilidade da filial" data-testid="link-store-reports">
                <BarChart3 size={14} /> <span className="hidden sm:inline">Contabilidade</span>
              </Link>
            )}
            <a
              href={supportWhatsAppUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="button-secondary min-h-9 px-2 text-xs sm:px-3"
              aria-label="Ajuda e Suporte: entre em contato com nossa equipe"
              title="Ajuda e Suporte"
              data-testid="link-store-support"
            >
              <CircleHelp size={14} /> <span className="hidden sm:inline">Suporte</span>
            </a>
            <Link href="/account" className="button-secondary min-h-9 px-2 text-xs sm:px-3" aria-label="Alterar senha">
              <KeyRound size={14} /> <span className="hidden sm:inline">Senha</span>
            </Link>
            <button
              className="button-quiet min-h-9 px-2 text-xs sm:px-3"
              onClick={() => void signOut()}
            >
              <LogOut size={15} /> Sair
            </button>
          </div>
        </header>

        <div className="mb-5 mt-6">
          <div className="eyebrow">OPERAÇÃO DA UNIDADE</div>
          <h1 className="mt-2 text-[28px] font-bold tracking-[-.045em]">Entregas da loja</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Olá, {profile.name}. Aqui aparecem somente as entregas da sua unidade.
          </p>
          {NewDeliveryModal && (
            <button
              type="button"
              className="button-primary mt-4 min-h-12 w-full px-5 text-base sm:w-auto"
              onClick={() => setNewDeliveryOpen(true)}
              data-testid="button-store-new-delivery"
            >
              <FilePlus2 size={18} aria-hidden="true" /> Nova entrega
            </button>
          )}
        </div>
        <section className="panel mb-5 overflow-hidden" aria-label="Rastreamento dos motoboys da unidade">
          <div className="flex flex-col gap-3 border-b border-border px-4 py-4 sm:flex-row sm:items-end sm:justify-between sm:px-5">
            <div>
              <div className="eyebrow">ACOMPANHAMENTO</div>
              <h2 className="mt-1 text-sm font-bold">Motoboys com entregas da unidade</h2>
              <p className="mt-1 text-xs text-muted-foreground">Acompanhe todos ou selecione um motoboy.</p>
            </div>
            <label className="sr-only" htmlFor="store-track-courier">Selecionar motoboy para acompanhar</label>
            <select
              id="store-track-courier"
              className="filter-select w-full sm:w-auto"
              value={effectiveSelectedCourierId}
              onChange={(event) => setSelectedCourierId(event.target.value)}
              aria-label="Selecionar motoboy para acompanhar"
            >
              <option value="">Todos os motoboys em atendimento</option>
              {activeCouriers.map((courier) => (
                <option key={courier.id} value={courier.id}>{courier.name}</option>
              ))}
            </select>
          </div>
          {couriers.isLoading ? (
            <div className="skeleton m-4 h-[280px]" />
          ) : trackingMarkers.length || routeLines.length ? (
            <LiveMap
              markers={[...trackingMarkers, ...placeMarkers]}
              extraRoutes={routeLines}
              ariaLabel="Localização atual dos motoboys atendendo esta unidade"
            />
          ) : (
            <div className="p-5 text-sm text-muted-foreground">
              {effectiveSelectedCourierId
                ? `Aguardando uma posição GPS real de ${activeCouriers.find((courier) => courier.id === effectiveSelectedCourierId)?.name ?? "motoboy selecionado"}. O PWA precisa estar aberto com a localização permitida.`
                : "Nenhuma posição GPS recebida para entregas ativas desta unidade. O mapa será atualizado quando o motoboy permitir a localização no PWA."}
            </div>
          )}
        </section>
        {GroupRouteModal && (
          <div className="panel mb-3 flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between" aria-live="polite">
            <p className="text-sm text-muted-foreground">
              {selectedIds.length
                ? `${selectedIds.length} entrega${selectedIds.length > 1 ? "s" : ""} marcada${selectedIds.length > 1 ? "s" : ""} para a mesma rota.`
                : "Toda entrega nova já vai para os motoboys da cidade. Para mandar várias com o mesmo motoboy, marque as que ainda não foram aceitas e monte a rota."}
            </p>
            <div className="flex flex-wrap gap-2">
              {selectedIds.length > 0 && (
                <button type="button" className="button-quiet min-h-11" onClick={() => setSelectedIds([])}>Limpar</button>
              )}
              <button
                type="button"
                className="button-primary min-h-11"
                disabled={selectedIds.length < 2}
                onClick={() => setGroupOpen(true)}
                data-testid="button-store-create-route"
              >
                <Bike size={16} aria-hidden="true" /> Montar rota{selectedIds.length >= 2 ? ` com ${selectedIds.length}` : ""}
              </button>
            </div>
          </div>
        )}
        {routeFeedback && (
          <AutoDismissFeedback feedback={routeFeedback} onDismiss={() => setRouteFeedback(null)} className="mb-3" />
        )}
        {deliveries.isLoading ? (
          <div className="panel p-5 text-sm text-muted-foreground">Carregando entregas…</div>
        ) : deliveries.isError ? (
          <div className="panel p-5 text-sm text-red-700" role="alert">
            Não foi possível carregar as entregas.
            <button className="button-secondary mt-3 block" type="button" onClick={() => void deliveries.refetch()}>Tentar novamente</button>
          </div>
        ) : deliveries.data?.length ? (
          <div className="space-y-3">
            {deliveries.data.map((delivery) => (
              <article key={delivery.id} className="panel p-4 sm:p-5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  {GroupRouteModal && waitingForCourier(delivery) && delivery.status !== "NOT_DELIVERED" && (
                    <input
                      type="checkbox"
                      className="mt-1 !h-5 !w-5 shrink-0 accent-[#b91e2c]"
                      aria-label={`Marcar ${delivery.code} para a mesma rota`}
                      checked={selectedIds.includes(delivery.id)}
                      disabled={!selectedIds.includes(delivery.id) && selectedIds.length >= 10}
                      onChange={(event) => toggleSelected(delivery.id, event.target.checked)}
                      data-testid={`checkbox-store-route-${delivery.id}`}
                    />
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="font-mono text-xs font-semibold text-[#a91d2a]">{delivery.code}</div>
                    <h2 className="mt-1 text-sm font-bold">{delivery.customerName}</h2>
                    <p className="mt-1 text-xs text-muted-foreground">{delivery.destination}</p>
                    <p className="mt-1 text-[11px] text-muted-foreground">Pedido {delivery.orderNumber}{delivery.courierName ? ` · Motoboy: ${delivery.courierName}` : ""}</p>
                    {(delivery.requiresPrescription || delivery.routeId || paymentLabel(delivery)) && (
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {paymentLabel(delivery) && (
                          <span className="rounded-md bg-[#f3f1ef] px-2 py-0.5 text-[11px] font-semibold text-[#4b4f56]">{paymentLabel(delivery)}</span>
                        )}
                        {delivery.requiresPrescription && (
                          <span className="rounded-md bg-[#eef4ff] px-2 py-0.5 text-[11px] font-semibold text-[#1d4f91]">
                            {delivery.prescriptionCollectedAt ? "Receita recolhida" : "Com receita"}
                          </span>
                        )}
                        {delivery.routeId && (
                          <span className="rounded-md bg-[#f3f1ef] px-2 py-0.5 text-[11px] font-semibold text-[#4b4f56]">Em rota</span>
                        )}
                      </div>
                    )}
                  </div>
                  <StatusBadge status={delivery.status} />
                </div>
                <div className="mt-3">
                  <DeliveryProgress status={delivery.status} events={delivery.events} createdAt={delivery.createdAt} compact />
                </div>
                {delivery.status === "OFFERED" && !delivery.courierId && !delivery.routeId && (
                  <p className="mt-3 text-xs text-muted-foreground">Na fila dos motoboys da cidade. Quem aceitar primeiro leva.</p>
                )}
                {["AWAITING_COURIER", "RETURNING_TO_STORE", "NOT_DELIVERED"].includes(delivery.status) && (
                  <p className="mt-3 rounded-lg bg-[#fff6e8] px-3 py-2 text-xs text-[#7a4b06]" role="status">
                    {delivery.status === "RETURNING_TO_STORE" ? "O produto está voltando para a loja. " : "O motoboy devolveu esta entrega. "}
                    {returnReason(delivery.events)}
                  </p>
                )}
                {RemoveFromRouteModal && delivery.routeId && (
                  <button
                    type="button"
                    className="button-secondary mt-4 min-h-11 w-full sm:w-auto"
                    onClick={() => setRemoveTarget({ id: delivery.id, code: delivery.code, routeId: delivery.routeId!, status: delivery.status })}
                    data-testid={`button-store-remove-route-${delivery.id}`}
                  >
                    <X size={15} aria-hidden="true" /> Tirar da rota
                  </button>
                )}
                {!delivery.routeId && REQUEUE_STATUSES.includes(delivery.status) && (
                  <span className="mt-4 inline-block w-full sm:mr-2 sm:w-auto">
                    <RequeueButton
                      deliveryId={delivery.id}
                      code={delivery.code}
                      className="button-primary min-h-11 w-full sm:w-auto"
                      onDone={(text) => setRouteFeedback({ kind: "success", text })}
                    />
                  </span>
                )}
                {EditDeliveryModal && editableByStore(delivery) && (
                  <button
                    type="button"
                    className="button-secondary mt-4 min-h-11 w-full sm:mr-2 sm:w-auto"
                    onClick={() => setEditTarget(delivery)}
                    data-testid={`button-store-edit-${delivery.id}`}
                  >
                    <Pencil size={15} aria-hidden="true" /> Editar
                  </button>
                )}
                {CancelDeliveryModal && waitingForCourier(delivery) && (
                  <button
                    type="button"
                    className="button-quiet mt-4 min-h-11 w-full sm:w-auto"
                    onClick={() => setCancelTarget({ id: delivery.id, code: delivery.code })}
                    data-testid={`button-store-cancel-${delivery.id}`}
                  >
                    <X size={15} aria-hidden="true" /> Cancelar entrega
                  </button>
                )}
                {delivery.status === "AT_STORE" ? (
                  <button
                    className="button-primary mt-4 w-full sm:w-auto"
                    disabled={pendingDeliveryId === delivery.id}
                    aria-busy={pendingDeliveryId === delivery.id}
                    onClick={() => confirmPickup(delivery.id, delivery.code)}
                  >
                    <Check size={15} /> {pendingDeliveryId === delivery.id ? "Confirmando saída…" : "Confirmar saída para entrega"}
                  </button>
                ) : null}
                {pickupFeedback?.deliveryId === delivery.id && (
                  <AutoDismissFeedback
                    feedback={pickupFeedback.feedback}
                    onDismiss={() => setPickupFeedback(null)}
                    className="mt-3"
                  />
                )}
              </article>
            ))}
          </div>
        ) : (
          <div className="panel p-8 text-center">
            <PackageCheck className="mx-auto text-muted-foreground" size={23} />
            <h2 className="mt-3 text-sm font-bold">Nenhuma entrega para mostrar</h2>
            <p className="mt-1 text-xs text-muted-foreground">
              As entregas vinculadas à sua unidade aparecerão aqui.
            </p>
          </div>
        )}
      </div>
      {NewDeliveryModal && newDeliveryOpen && (
        <NewDeliveryModal onClose={() => setNewDeliveryOpen(false)} />
      )}
      {DispatchModal && dispatchId && (
        <DispatchModal deliveryId={dispatchId} onClose={() => setDispatchId(null)} />
      )}
      {RemoveFromRouteModal && removeTarget && (
        <RemoveFromRouteModal
          delivery={removeTarget}
          onClose={() => setRemoveTarget(null)}
          onDone={(text) => setRouteFeedback({ kind: "success", text })}
        />
      )}
      {EditDeliveryModal && editTarget && (
        <EditDeliveryModal
          delivery={editTarget}
          onClose={() => setEditTarget(null)}
          onSaved={() => {
            void queryClient.invalidateQueries({ queryKey: getListDeliveriesQueryKey() });
            setRouteFeedback({ kind: "success", text: `Entrega ${editTarget.code} atualizada.` });
          }}
        />
      )}
      {CancelDeliveryModal && cancelTarget && (
        <CancelDeliveryModal
          deliveryId={cancelTarget.id}
          code={cancelTarget.code}
          onClose={() => setCancelTarget(null)}
          onCancelled={() => setRouteFeedback({ kind: "success", text: `Entrega ${cancelTarget.code} cancelada.` })}
        />
      )}
      {GroupRouteModal && groupOpen && (
        <GroupRouteModal
          deliveryIds={selectedIds}
          onClose={() => setGroupOpen(false)}
          onCreated={(text) => {
            setSelectedIds([]);
            setRouteFeedback({ kind: "success", text });
          }}
        />
      )}
    </main>
  );
}
