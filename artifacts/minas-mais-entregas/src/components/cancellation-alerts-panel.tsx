import { useQueryClient } from "@tanstack/react-query";
import {
  getGetDeliveryAnalyticsQueryKey,
  getGetDashboardSummaryQueryKey,
  getListDeliveryCancellationsQueryKey,
  getListDeliveryCancellationReasonsQueryKey,
  getListDeliveriesQueryKey,
  useActOnDeliveryCancellation,
  useListDeliveryCancellations,
  useListDeliveryCancellationReasons,
  useUpdateDeliveryCancellationReasons,
  type DeliveryCancellationReason,
} from "@workspace/api-client-react";
import { AlertTriangle, Bell, Check, Clock3, Plus, Settings2, X } from "lucide-react";
import { useEffect, useState } from "react";
import { usePushNotifications } from "@/hooks/use-push-notifications";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

function timeLabel(value: Date) {
  return value.toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
}

function CentralPushButton() {
  const push = usePushNotifications();
  return (
    <div className="flex flex-col items-start gap-1 sm:items-end">
      <button
        type="button"
        className={push.enabled ? "button-secondary min-h-12" : "button-primary min-h-12"}
        onClick={() => void push.activate()}
        disabled={push.pending || push.checking || push.enabled}
      >
        {push.enabled ? <Check size={15} /> : <Bell size={15} />}
        {push.pending ? "Ativando…" : push.enabled ? "Notificações ativadas" : "Ativar notificações"}
      </button>
      {push.message && <span role="status" className="max-w-xs text-xs text-muted-foreground">{push.message}</span>}
    </div>
  );
}

export default function CancellationAlertsPanel() {
  const queryClient = useQueryClient();
  const alerts = useListDeliveryCancellations({
    query: {
      queryKey: getListDeliveryCancellationsQueryKey(),
      refetchInterval: 15_000,
      refetchOnWindowFocus: true,
    },
  });
  const reasons = useListDeliveryCancellationReasons({
    query: { queryKey: getListDeliveryCancellationReasonsQueryKey() },
  });
  const action = useActOnDeliveryCancellation();
  const updateReasons = useUpdateDeliveryCancellationReasons();
  const [actionError, setActionError] = useState("");
  const [reasonSettingsOpen, setReasonSettingsOpen] = useState(false);
  const [reasonDrafts, setReasonDrafts] = useState<DeliveryCancellationReason[]>([]);
  const [settingsMessage, setSettingsMessage] = useState("");

  useEffect(() => {
    if (reasons.data) setReasonDrafts(reasons.data);
  }, [reasons.data]);

  const invalidate = async () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: getListDeliveryCancellationsQueryKey() }),
      queryClient.invalidateQueries({ queryKey: getListDeliveriesQueryKey() }),
      queryClient.invalidateQueries({ queryKey: getGetDashboardSummaryQueryKey() }),
      queryClient.invalidateQueries({ queryKey: getGetDeliveryAnalyticsQueryKey() }),
    ]);

  const act = async (cancellationId: string, selected: "REQUEUE" | "CLOSE" | "CONFIRM_RETURN") => {
    setActionError("");
    try {
      await action.mutateAsync({ cancellationId, data: { action: selected } });
      await invalidate();
    } catch {
      setActionError("Não foi possível atualizar a ocorrência. Atualize a lista e tente novamente.");
    }
  };

  const saveReasons = async () => {
    setSettingsMessage("");
    try {
      await updateReasons.mutateAsync({ data: { reasons: reasonDrafts } });
      await queryClient.invalidateQueries({ queryKey: getListDeliveryCancellationReasonsQueryKey() });
      setSettingsMessage("Motivos salvos.");
      setReasonSettingsOpen(false);
    } catch {
      setSettingsMessage("Não foi possível salvar os motivos.");
    }
  };

  return (
    <section className="panel mb-5 overflow-hidden" aria-label="Ocorrências de entrega">
      <header className="flex flex-col gap-3 border-b border-border p-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="eyebrow">ACOMPANHAMENTO</div>
          <h2 className="mt-1 text-base font-bold">Ocorrências dos motoboys</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Alertas e devoluções atualizados automaticamente.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className="button-secondary min-h-12"
            onClick={() => setReasonSettingsOpen(true)}
          >
            <Settings2 size={15} /> Configurar motivos
          </button>
          <CentralPushButton />
        </div>
      </header>

      {settingsMessage && <p role="status" className="px-4 pt-3 text-xs text-muted-foreground">{settingsMessage}</p>}
      {actionError && <p role="alert" className="mx-4 mt-3 rounded-lg bg-red-50 p-3 text-sm text-red-800">{actionError}</p>}
      {alerts.isLoading ? (
        <p className="p-4 text-sm text-muted-foreground">Carregando ocorrências…</p>
      ) : alerts.isError ? (
        <div className="p-4 text-sm text-red-700">
          Não foi possível carregar as ocorrências.
          <button type="button" className="ml-2 underline" onClick={() => void alerts.refetch()}>Tentar novamente</button>
        </div>
      ) : !alerts.data?.length ? (
        <div className="flex items-center gap-3 p-4 text-sm text-muted-foreground">
          <Check size={18} className="text-green-700" /> Nenhuma ocorrência pendente.
        </div>
      ) : (
        <div className="divide-y divide-border">
          {alerts.data.map((item) => {
            const isUrgent = item.priority || item.status === "ROUTE_ABORTED";
            const returning = item.status === "RETURNING_TO_STORE";
            return (
              <article
                key={item.id}
                className={`flex flex-col gap-3 border-l-4 p-4 sm:flex-row sm:items-start sm:justify-between ${
                  isUrgent ? "border-l-red-700 bg-red-50/60" : returning ? "border-l-amber-500 bg-amber-50/40" : "border-l-[#a91d2a]"
                }`}
              >
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    {isUrgent && <AlertTriangle size={15} className="text-red-700" />}
                    <span className="font-mono text-xs font-bold text-primary">{item.code}</span>
                    <span className={`rounded-full px-2 py-1 text-[10px] font-bold ${isUrgent ? "bg-red-100 text-red-800" : returning ? "bg-amber-100 text-amber-900" : "bg-[#f3e8e9] text-primary"}`}>
                      {isUrgent ? "PRIORIDADE" : returning ? "RETORNANDO À FILIAL" : "AGUARDANDO CENTRAL"}
                    </span>
                  </div>
                  <p className="mt-1 text-sm font-bold">{item.customerName} · {item.storeName}</p>
                  <p className="mt-1 text-sm font-semibold text-[#8a1b28]">{item.reason}</p>
                  {item.observation && <p className="mt-1 text-xs text-muted-foreground">{item.observation}</p>}
                  <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                    <span>Motoboy: {item.courierName ?? "não vinculado"}</span>
                    <span className="inline-flex items-center gap-1"><Clock3 size={12} />{timeLabel(new Date(item.requestedAt))}</span>
                  </div>
                  {item.routeContinues && (
                    <p className="mt-2 text-xs font-semibold text-green-800">
                      A rota continua com os pedidos restantes.
                    </p>
                  )}
                  {returning && (
                    <p className="mt-2 text-xs font-semibold text-amber-900">
                      O motoboy está levando o produto de volta à filial.
                    </p>
                  )}
                </div>
                <div className="flex flex-wrap gap-2 sm:shrink-0">
                  {returning ? (
                    <button
                      type="button"
                      className="button-primary min-h-12"
                      disabled={action.isPending}
                      onClick={() => void act(item.id, "CONFIRM_RETURN")}
                    >
                      <Check size={15} /> Produto devolvido
                    </button>
                  ) : (
                    <>
                      <button
                        type="button"
                        className="button-secondary min-h-12"
                        disabled={action.isPending}
                        onClick={() => void act(item.id, "REQUEUE")}
                      >
                        Reenviar pedido
                      </button>
                      <button
                        type="button"
                        className="button-secondary min-h-12 border-red-200 text-red-700"
                        disabled={action.isPending}
                        onClick={() => void act(item.id, "CLOSE")}
                      >
                        Encerrar pedido
                      </button>
                    </>
                  )}
                </div>
              </article>
            );
          })}
        </div>
      )}

      <Dialog open={reasonSettingsOpen} onOpenChange={setReasonSettingsOpen}>
        <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>Configurar motivos de ocorrência</DialogTitle>
            <DialogDescription>Os motivos ativos aparecem no PWA do motoboy.</DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            {reasonDrafts.map((reason, index) => (
              <div key={reason.id} className="cancellation-reason-row flex items-center gap-2">
                <input
                  type="checkbox"
                  className="h-5 w-5 accent-[#a91d2a]"
                  checked={reason.active}
                  disabled={reason.id === "MOTORCYCLE_ISSUE"}
                  aria-label={`Ativar ${reason.label}`}
                  onChange={(event) => setReasonDrafts((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, active: event.target.checked } : item))}
                />
                <input
                  type="text"
                  className="h-12 min-w-0 flex-1 rounded-lg border border-border px-3 text-sm"
                  value={reason.label}
                  disabled={reason.id === "MOTORCYCLE_ISSUE"}
                  aria-label="Nome do motivo"
                  maxLength={160}
                  onChange={(event) => setReasonDrafts((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, label: event.target.value } : item))}
                />
                <button
                  type="button"
                  className="grid h-12 w-12 place-items-center rounded-lg border border-border text-muted-foreground disabled:cursor-not-allowed disabled:opacity-40"
                  disabled={reason.id === "MOTORCYCLE_ISSUE"}
                  aria-label={`Remover ${reason.label}`}
                  onClick={() => setReasonDrafts((current) => current.filter((_, itemIndex) => itemIndex !== index))}
                >
                  <X size={16} />
                </button>
              </div>
            ))}
            <button
              type="button"
              className="button-secondary min-h-12 w-full"
              onClick={() => setReasonDrafts((current) => [
                ...current,
                { id: crypto.randomUUID(), label: "", active: true, position: current.length },
              ])}
            >
              <Plus size={15} /> Adicionar motivo
            </button>
          </div>
          <DialogFooter className="gap-2 sm:gap-2">
            <button type="button" className="button-secondary min-h-12" onClick={() => setReasonSettingsOpen(false)}>Cancelar</button>
            <button type="button" className="button-primary min-h-12" disabled={updateReasons.isPending || !reasonDrafts.some((reason) => reason.active && reason.label.trim())} onClick={() => void saveReasons()}>
              {updateReasons.isPending ? "Salvando…" : "Salvar motivos"}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
