import { useMemo, useState, type ReactNode } from "react";
import { useGetDeliveryAnalytics, getGetDeliveryAnalyticsQueryKey, useListCouriers, getListCouriersQueryKey, useListStores, getListStoresQueryKey } from "@workspace/api-client-react";
import { Download, RefreshCw, ChartNoAxesCombined, Bike, PackageCheck, Wallet } from "lucide-react";

const money = (value: number) => value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const dateLabel = (value: string) => new Date(`${value}T12:00:00`).toLocaleDateString("pt-BR", { day: "2-digit", month: "short" });
const stamp = (value?: string | null) => value ? new Date(value).toLocaleString("pt-BR") : "—";
const statusLabels: Record<string, string> = {
  REQUESTED: "Solicitada", AWAITING_COURIER: "Aguardando motoboy", OFFERED: "Oferta enviada",
  ACCEPTED: "Aceita", TO_STORE: "A caminho da loja", AT_STORE: "Na loja",
  IN_TRANSIT: "Em entrega", COMPLETED: "Concluída", CANCELLED: "Cancelada",
};

function csvCell(value: string | number) {
  return `"${String(value).replaceAll('"', '""')}"`;
}

export default function Reports() {
  const today = new Date().toISOString().slice(0, 10);
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - 29);
  const [from, setFrom] = useState(startDate.toISOString().slice(0, 10));
  const [to, setTo] = useState(today);
  const [storeId, setStoreId] = useState("");
  const [courierId, setCourierId] = useState("");
  const [status, setStatus] = useState("");
  const params = useMemo(() => ({
    from: from || undefined, to: to || undefined,
    storeId: storeId || undefined, courierId: courierId || undefined, status: status || undefined,
  }), [from, to, storeId, courierId, status]);
  const analytics = useGetDeliveryAnalytics(params, {
    query: { queryKey: getGetDeliveryAnalyticsQueryKey(params), refetchOnWindowFocus: true },
  });
  const stores = useListStores({ query: { queryKey: getListStoresQueryKey() } });
  const couriers = useListCouriers(undefined, { query: { queryKey: getListCouriersQueryKey() } });
  const data = analytics.data;
  const peak = Math.max(1, ...(data?.daily ?? []).map((day) => day.created));

  const exportCsv = () => {
    if (!data?.deliveries.length) return;
    const header = ["Código", "Cliente", "Destino", "Filial", "Motoboy", "Status", "Tarifa", "Criada em", "Chegada à loja", "Saída da loja", "Concluída em", "Comprovante"];
    const rows = data.deliveries.map((delivery) => [
      delivery.code, delivery.customerName, delivery.destination, delivery.storeName,
      delivery.courierName ?? "", statusLabels[delivery.status] ?? delivery.status,
      delivery.deliveryAmount.toFixed(2), stamp(delivery.createdAt), stamp(delivery.storeArrivedAt),
      stamp(delivery.storeDepartedAt), stamp(delivery.completedAt), delivery.evidenceAvailable ? "Disponível" : "Não disponível",
    ]);
    const csv = [header, ...rows].map((row) => row.map((cell) => csvCell(cell)).join(";")).join("\r\n");
    const url = URL.createObjectURL(new Blob(["\uFEFF", csv], { type: "text/csv;charset=utf-8" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `minas-mais-relatorio-${from || "inicio"}-${to || "hoje"}.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="soft-enter space-y-5">
      <header className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
        <div>
          <div className="eyebrow">CENTRAL · INDICADORES REAIS</div>
          <h1 className="mt-2 text-[28px] font-bold tracking-[-.045em] sm:text-[34px]">Relatórios</h1>
          <p className="mt-1 text-sm text-muted-foreground">Acompanhe volumes, tempos e repasses do período selecionado.</p>
        </div>
        <button className="button-secondary min-h-10" type="button" onClick={exportCsv} disabled={!data?.deliveries.length} data-testid="button-export-report">
          <Download size={15} />Exportar CSV filtrado
        </button>
      </header>

      <section className="panel grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-5" aria-label="Filtros do relatório">
        <label className="field-label">De<input type="date" value={from} onChange={(event) => setFrom(event.target.value)} data-testid="filter-report-from" /></label>
        <label className="field-label">Até<input type="date" value={to} onChange={(event) => setTo(event.target.value)} data-testid="filter-report-to" /></label>
        <label className="field-label">Filial<select className="filter-select w-full" value={storeId} onChange={(event) => setStoreId(event.target.value)}><option value="">Todas as filiais</option>{(stores.data ?? []).map((store) => <option key={store.id} value={store.id}>{store.name}</option>)}</select></label>
        <label className="field-label">Motoboy<select className="filter-select w-full" value={courierId} onChange={(event) => setCourierId(event.target.value)}><option value="">Todos os motoboys</option>{(couriers.data ?? []).map((courier) => <option key={courier.id} value={courier.id}>{courier.name}</option>)}</select></label>
        <label className="field-label">Status<select className="filter-select w-full" value={status} onChange={(event) => setStatus(event.target.value)}><option value="">Todos os status</option>{Object.entries(statusLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
      </section>

      {analytics.isLoading ? <section className="panel space-y-3 p-5" aria-label="Carregando relatório"><div className="skeleton h-6 w-48"/><div className="skeleton h-28 w-full"/><div className="skeleton h-40 w-full"/></section> :
        analytics.isError ? <section className="panel p-7 text-center"><ChartNoAxesCombined className="mx-auto text-primary" size={24}/><p className="mt-3 font-semibold">Não foi possível carregar os indicadores</p><p className="mt-1 text-sm text-muted-foreground">Confira os filtros ou tente consultar novamente.</p><button className="button-secondary mt-4" type="button" onClick={() => void analytics.refetch()}><RefreshCw size={14}/>Tentar novamente</button></section> :
        data ? <>
          <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <ReportMetric label="Entregas no período" value={data.summary.total.toLocaleString("pt-BR")} note={`${data.summary.completed} concluídas · ${data.summary.cancelled} canceladas`} icon={<PackageCheck size={17}/>} />
            <ReportMetric label="Tempo total médio" value={`${data.summary.averageTotalMinutes} min`} note="do registro à conclusão" icon={<ChartNoAxesCombined size={17}/>} />
            <ReportMetric label="Tempo médio na loja" value={`${data.summary.averageStoreMinutes} min`} note={`entrega: ${data.summary.averageDeliveryMinutes} min em média`} icon={<Bike size={17}/>} />
            <ReportMetric label="Repasse aos motoboys" value={money(data.summary.courierAmount)} note="valor contabilizado no período" icon={<Wallet size={17}/>} />
          </section>
          {!data.deliveries.length ? <section className="panel px-5 py-12 text-center"><PackageCheck size={24} className="mx-auto text-muted-foreground"/><h2 className="mt-3 font-semibold">Nenhuma entrega neste recorte</h2><p className="mt-1 text-sm text-muted-foreground">Altere o período ou os filtros para consultar outros registros.</p></section> : <>
            <section className="panel overflow-hidden">
              <div className="border-b border-border px-4 py-4 sm:px-5"><div className="eyebrow">MOVIMENTO DIÁRIO</div><h2 className="mt-1 font-bold">Registros por dia</h2></div>
              {data.daily.length ? <div className="divide-y divide-border">{data.daily.map((day) => <div key={day.date} className="grid grid-cols-[76px_1fr_90px] items-center gap-3 px-4 py-3 sm:px-5"><time className="text-xs font-semibold">{dateLabel(day.date)}</time><div className="space-y-1.5"><div className="h-2 overflow-hidden rounded-full bg-[#f1eeea]"><span className="block h-full rounded-full bg-[#b91e2c]" style={{ width: `${Math.max(2, day.created / peak * 100)}%` }}/></div><div className="text-[10px] text-muted-foreground">{day.created} registrados · {day.completed} concluídos</div></div><div className="text-right font-mono text-xs">{day.created} pedidos</div></div>)}</div> : <p className="p-5 text-sm text-muted-foreground">Sem totais diários para o filtro selecionado.</p>}
            </section>
            <section className="grid gap-4 lg:grid-cols-[.78fr_1.5fr]">
              <div className="panel overflow-hidden">
                <div className="border-b border-border px-4 py-4"><div className="eyebrow">PRODUÇÃO</div><h2 className="mt-1 font-bold">Por motoboy</h2></div>
                {data.couriers.length ? <ul className="divide-y divide-border">{data.couriers.map((courier) => <li key={courier.courierId} className="flex items-center gap-3 px-4 py-3"><span className="avatar">{courier.courierName.slice(0, 2).toUpperCase()}</span><div className="min-w-0 flex-1"><div className="truncate text-xs font-semibold">{courier.courierName}</div><div className="mt-1 text-[10px] text-muted-foreground">{courier.completedDeliveries} entregas · média {courier.averageTotalMinutes} min</div></div><strong className="text-xs">{money(courier.courierAmount)}</strong></li>)}</ul> : <p className="p-5 text-sm text-muted-foreground">Sem entregas atribuídas a motoboys neste período.</p>}
              </div>
              <div className="panel overflow-hidden">
                <div className="border-b border-border px-4 py-4"><div className="eyebrow">REGISTROS DO FILTRO</div><h2 className="mt-1 font-bold">Entregas</h2></div>
                <div className="overflow-x-auto"><table className="delivery-table w-full min-w-[760px]"><thead><tr><th>Pedido</th><th>Filial / motoboy</th><th>Status</th><th>Tarifa</th><th>Horários de operação</th></tr></thead><tbody>{data.deliveries.map((delivery) => <tr key={delivery.id} className="row-hover"><td><div className="table-code">{delivery.code}</div><span className="text-[10px] text-muted-foreground">{delivery.customerName}</span></td><td><div className="font-semibold">{delivery.storeName}</div><span className="text-[10px] text-muted-foreground">{delivery.courierName ?? "Sem motoboy"}</span></td><td><span className="badge-neutral rounded-full px-2 py-1 text-[10px] font-semibold">{statusLabels[delivery.status] ?? delivery.status}</span></td><td className="font-semibold">{money(delivery.deliveryAmount)}</td><td><div className="text-[10px]">Chegada {stamp(delivery.storeArrivedAt)}</div><div className="mt-1 text-[10px]">Saída {stamp(delivery.storeDepartedAt)} · Conclusão {stamp(delivery.completedAt)}</div></td></tr>)}</tbody></table></div>
              </div>
            </section>
          </>}
        </> : null}
      {(stores.isError || couriers.isError) && <p role="status" className="text-xs text-amber-800">Não foi possível carregar uma ou mais opções de filtro. Os indicadores permanecem baseados na consulta atual.</p>}
    </div>
  );
}

function ReportMetric({ label, value, note, icon }: { label: string; value: string; note: string; icon: ReactNode }) {
  return <article className="panel metric-card p-4"><div className="flex items-center justify-between"><span className="eyebrow">{label}</span><span className="metric-icon metric-icon-red">{icon}</span></div><div className="mono mt-3 text-2xl font-semibold">{value}</div><p className="mt-1 text-[11px] text-muted-foreground">{note}</p></article>;
}
