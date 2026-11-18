import { useMemo, useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  getGetStoreAccountingQueryKey,
  useGetStoreAccounting,
  usePayCourier,
  type StoreAccountingCourier,
} from "@workspace/api-client-react";
import { ArrowLeft, Banknote, CheckCircle2, Download, HandCoins, PackageCheck, RefreshCw, Wallet } from "lucide-react";
import { Link } from "wouter";
import { AutoDismissFeedback, type FeedbackMessage } from "@/components/auto-dismiss-feedback";
import { statusLabel } from "@/components/delivery-status";

const money = (value: number) => value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const day = (value?: string | null) =>
  value ? new Date(value).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" }) : "—";

function localDate(date: Date) {
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 10);
}

function Metric({ label, value, note, icon, tone }: { label: string; value: string; note: string; icon: ReactNode; tone?: "green" | "red" }) {
  return (
    <article className="panel p-4" data-testid={`accounting-${label.toLowerCase().replaceAll(" ", "-")}`}>
      <div className="flex items-start justify-between gap-3">
        <span className="text-[11px] font-semibold uppercase tracking-[.08em] text-muted-foreground">{label}</span>
        <span className="grid size-8 place-items-center rounded-lg bg-[#fbeeee] text-primary">{icon}</span>
      </div>
      <div className={`mt-3 text-2xl font-bold tracking-tight ${tone === "green" ? "text-[#28794f]" : tone === "red" ? "text-[#a3141f]" : ""}`}>{value}</div>
      <p className="mt-1 text-xs text-muted-foreground">{note}</p>
    </article>
  );
}

/**
 * Contabilidade da filial (gerente): quantos pedidos, quanto as entregas custaram,
 * quanto já foi pago e quanto falta pagar a cada motoboy.
 */
export default function StoreAccountingPage() {
  const qc = useQueryClient();
  const initial = useMemo(() => {
    const now = new Date();
    return { from: localDate(new Date(now.getFullYear(), now.getMonth(), 1)), to: localDate(now) };
  }, []);
  const [from, setFrom] = useState(initial.from);
  const [to, setTo] = useState(initial.to);
  const [feedback, setFeedback] = useState<FeedbackMessage | null>(null);
  const invalidRange = Boolean(from && to && from > to);
  const params = useMemo(() => ({ from: from || undefined, to: to || undefined }), [from, to]);
  const accounting = useGetStoreAccounting(params as never, {
    query: { queryKey: getGetStoreAccountingQueryKey(params as never), enabled: !invalidRange },
  });
  const pay = usePayCourier();
  const data = accounting.data;

  const markPaid = (courier: StoreAccountingCourier) => {
    if (!window.confirm(`Confirmar o pagamento de ${money(courier.amountToPay)} para ${courier.courierName}?\n\nAs entregas concluídas dele neste período ficam marcadas como pagas.`)) return;
    setFeedback(null);
    pay.mutate(
      { data: { courierId: courier.courierId, from, to } as never },
      {
        onSuccess: (result) => {
          void qc.invalidateQueries({ queryKey: getGetStoreAccountingQueryKey(params as never) });
          setFeedback({ kind: "success", text: `Pagamento registrado: ${result.paidDeliveries} ${result.paidDeliveries === 1 ? "entrega" : "entregas"} · ${money(result.amount)} para ${courier.courierName}.` });
        },
        onError: (error) => {
          const apiError = error as Error & { data?: { error?: string } };
          setFeedback({ kind: "error", text: apiError.data?.error ?? "Não foi possível registrar o pagamento. Tente de novo." });
        },
      },
    );
  };

  const exportCsv = () => {
    if (!data) return;
    const cell = (value: string | number) => `"${String(value).replaceAll('"', '""')}"`;
    const header = ["Código", "Pedido", "Cliente", "Motoboy", "Situação", "Valor (R$)", "Registrada", "Concluída", "Pago ao motoboy"];
    const rows = data.deliveries.map((item) => [
      item.code, item.orderNumber, item.customerName, item.courierName ?? "", statusLabel(item.status),
      item.amount.toFixed(2).replace(".", ","), day(item.createdAt), day(item.completedAt),
      item.status === "COMPLETED" ? (item.paidAt ? `Sim (${day(item.paidAt)})` : "A pagar") : "",
    ]);
    const csv = [header, ...rows].map((row) => row.map(cell).join(";")).join("\r\n");
    const url = URL.createObjectURL(new Blob(["﻿", csv], { type: "text/csv;charset=utf-8" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `contabilidade-${data.storeName.toLowerCase().replace(/\s+/g, "-")}-${from}-${to}.csv`;
    anchor.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  return (
    <div className="soft-enter space-y-5">
      <header className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
        <div>
          <Link href="/" className="back-link mb-3"><ArrowLeft size={15} />Voltar para as entregas</Link>
          <div className="eyebrow">{data ? data.storeName.toUpperCase() : "SUA FILIAL"} · CONTABILIDADE</div>
          <h1 className="mt-2 text-[28px] font-bold tracking-[-.045em] sm:text-[34px]">Contabilidade da filial</h1>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">Pedidos do período, quanto já foi pago e quanto falta pagar a cada motoboy.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" className="button-secondary min-h-10" onClick={() => void accounting.refetch()} disabled={invalidRange || accounting.isFetching}>
            <RefreshCw size={15} className={accounting.isFetching ? "animate-spin" : ""} /> Atualizar
          </button>
          <button type="button" className="button-primary min-h-10" onClick={exportCsv} disabled={!data?.deliveries.length} data-testid="button-accounting-export">
            <Download size={15} /> Exportar CSV
          </button>
        </div>
      </header>

      <section className="panel grid gap-3 p-4 sm:grid-cols-2" aria-label="Período">
        <label className="field-label">De<input type="date" value={from} onChange={(event) => setFrom(event.target.value)} data-testid="accounting-from" /></label>
        <label className="field-label">Até<input type="date" value={to} onChange={(event) => setTo(event.target.value)} data-testid="accounting-to" /></label>
      </section>
      {invalidRange && <p className="panel p-4 text-sm text-amber-900" role="alert">A data inicial precisa ser anterior ou igual à data final.</p>}
      {feedback && <AutoDismissFeedback feedback={feedback} onDismiss={() => setFeedback(null)} />}

      {accounting.isLoading ? (
        <section className="panel space-y-3 p-5" aria-label="Carregando"><div className="skeleton h-6 w-48" /><div className="skeleton h-28 w-full" /></section>
      ) : accounting.isError || !data ? (
        <section className="panel p-6 text-center" role="alert">
          <p className="font-semibold">Não foi possível carregar a contabilidade.</p>
          <button type="button" className="button-secondary mt-3" onClick={() => void accounting.refetch()}>Tentar novamente</button>
        </section>
      ) : (
        <>
          <section className="grid grid-cols-2 gap-3 lg:grid-cols-4" aria-label="Resumo do período" data-testid="accounting-summary">
            <Metric label="Pedidos" value={String(data.totalDeliveries)} note={`${data.completedDeliveries} entregues · ${data.cancelledDeliveries} cancelados`} icon={<PackageCheck size={16} />} />
            <Metric label="Valor das entregas" value={money(data.amountTotal)} note="Entregas concluídas no período" icon={<Wallet size={16} />} />
            <Metric label="Pago aos motoboys" value={money(data.amountPaid)} note="Já acertado" icon={<CheckCircle2 size={16} />} tone="green" />
            <Metric label="A pagar aos motoboys" value={money(data.amountToPay)} note={data.amountToPay > 0 ? "Falta acertar" : "Tudo pago"} icon={<HandCoins size={16} />} tone={data.amountToPay > 0 ? "red" : undefined} />
          </section>

          <section className="panel overflow-hidden" data-testid="accounting-couriers">
            <div className="border-b border-border px-4 py-4 sm:px-5">
              <div className="eyebrow">ACERTO COM OS MOTOBOYS</div>
              <h2 className="mt-1 font-bold">Por motoboy</h2>
            </div>
            {data.couriers.length ? (
              <ul className="divide-y divide-border">
                {data.couriers.map((courier) => (
                  <li key={courier.courierId} className="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:px-5" data-testid={`accounting-courier-${courier.courierId}`}>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-semibold">{courier.courierName}</div>
                      <div className="mt-1 text-xs text-muted-foreground">
                        {courier.completedDeliveries} {courier.completedDeliveries === 1 ? "entrega" : "entregas"} · total {money(courier.amountTotal)} · pago {money(courier.amountPaid)}
                      </div>
                    </div>
                    <div className="flex items-center justify-between gap-3 sm:justify-end">
                      <span className="text-right">
                        <span className="block text-[11px] text-muted-foreground">A pagar</span>
                        <strong className={courier.amountToPay > 0 ? "text-[#a3141f]" : "text-[#28794f]"}>{money(courier.amountToPay)}</strong>
                      </span>
                      {courier.amountToPay > 0 ? (
                        <button type="button" className="button-primary min-h-10" onClick={() => markPaid(courier)} disabled={pay.isPending} data-testid={`button-pay-${courier.courierId}`}>
                          <Banknote size={15} /> Marcar como pago
                        </button>
                      ) : (
                        <span className="rounded-md bg-[#eaf6ef] px-2.5 py-1 text-xs font-semibold text-[#28794f]">Pago</span>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="p-5 text-sm text-muted-foreground">Nenhuma entrega concluída neste período.</p>
            )}
          </section>

          <section className="panel overflow-hidden" data-testid="accounting-deliveries">
            <div className="flex items-end justify-between gap-2 border-b border-border px-4 py-4 sm:px-5">
              <div><div className="eyebrow">DETALHAMENTO</div><h2 className="mt-1 font-bold">Pedidos do período</h2></div>
              <span className="text-xs text-muted-foreground">{data.deliveries.length} {data.deliveries.length === 1 ? "pedido" : "pedidos"}</span>
            </div>
            {data.deliveries.length ? (
              <div className="overflow-x-auto">
                <table className="delivery-table w-full min-w-[720px]">
                  <thead><tr><th>Código</th><th>Pedido</th><th>Cliente</th><th>Motoboy</th><th>Situação</th><th className="text-right">Valor</th><th>Pagamento</th></tr></thead>
                  <tbody>
                    {data.deliveries.map((item) => (
                      <tr key={item.id}>
                        <td className="whitespace-nowrap font-mono text-xs font-semibold text-[#a91d2a]">{item.code}</td>
                        <td className="whitespace-nowrap">{item.orderNumber}</td>
                        <td>{item.customerName}</td>
                        <td>{item.courierName ?? "—"}</td>
                        <td>{statusLabel(item.status)}</td>
                        <td className="text-right">{item.status === "COMPLETED" ? money(item.amount) : "—"}</td>
                        <td>{item.status !== "COMPLETED" ? "—" : item.paidAt ? <span className="text-[#28794f]">Pago em {day(item.paidAt)}</span> : <span className="font-semibold text-[#a3141f]">A pagar</span>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="p-5 text-sm text-muted-foreground">Nenhum pedido registrado neste período.</p>
            )}
          </section>
        </>
      )}
    </div>
  );
}
