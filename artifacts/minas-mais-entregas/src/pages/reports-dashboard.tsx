import { useMemo, useState, type ReactNode } from "react";
import {
  getGetDeliveryAnalyticsQueryKey,
  getListCouriersQueryKey,
  getListStoresQueryKey,
  useGetDeliveryAnalytics,
  useListCouriers,
  useListStores,
} from "@workspace/api-client-react";
import {
  AlertCircle,
  Bike,
  CalendarDays,
  ChartNoAxesCombined,
  CheckCircle2,
  Clock3,
  Download,
  PackageCheck,
  RefreshCw,
  Store,
  Wallet,
} from "lucide-react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Link } from "wouter";

const CHART_COLORS = {
  created: "#1F74AD",
  completed: "#44986D",
  status: "#61A9BD",
  courier: "#E98E2E",
};

const STATUS_LABELS: Record<string, string> = {
  REQUESTED: "Solicitada",
  AWAITING_COURIER: "Aguardando motoboy",
  OFFERED: "Oferta enviada",
  ACCEPTED: "Aceita",
  TO_STORE: "A caminho da loja",
  AT_STORE: "Na loja",
  IN_TRANSIT: "Em entrega",
  COMPLETED: "Concluída",
  CANCELLED: "Cancelado pela Central",
  RETURNING_TO_STORE: "Retornando à filial",
  NOT_DELIVERED: "Não entregue",
};

const money = (value: number) =>
  value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const number = (value: number) => value.toLocaleString("pt-BR");
const dateLabel = (value: string) =>
  new Date(`${value}T12:00:00`).toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "short",
  });
const stamp = (value?: string | null) =>
  value ? new Date(value).toLocaleString("pt-BR") : "—";
const minutesLabel = (value: number) =>
  value > 0 ? `${value.toLocaleString("pt-BR", { maximumFractionDigits: 1 })} min` : "—";

function localDateValue(date: Date) {
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000)
    .toISOString()
    .slice(0, 10);
}

function csvCell(value: string | number) {
  return `"${String(value).replaceAll('"', '""')}"`;
}

function errorDetails(error: unknown) {
  if (error && typeof error === "object" && "data" in error) {
    const data = (error as { data?: unknown }).data;
    if (data && typeof data === "object" && "error" in data) {
      const message = (data as { error?: unknown }).error;
      if (typeof message === "string" && message.trim()) return message;
    }
  }
  return "Não foi possível consultar os dados deste período. Tente atualizar ou ajustar os filtros.";
}

function fillMissingDays(
  daily: { date: string; created: number; completed: number }[],
  from: string,
  to: string,
) {
  if (!from || !to) return daily;
  const start = new Date(`${from}T00:00:00.000Z`);
  const end = new Date(`${to}T00:00:00.000Z`);
  const days = Math.round((end.getTime() - start.getTime()) / 86_400_000) + 1;
  if (!Number.isFinite(days) || days < 1 || days > 366) return daily;

  const byDate = new Map(daily.map((item) => [item.date.slice(0, 10), item]));
  return Array.from({ length: days }, (_, index) => {
    const date = new Date(start);
    date.setUTCDate(start.getUTCDate() + index);
    const key = date.toISOString().slice(0, 10);
    return byDate.get(key) ?? { date: key, created: 0, completed: 0 };
  });
}

export default function ReportsDashboard() {
  const initialRange = useMemo(() => {
    const end = new Date();
    const start = new Date(end);
    start.setDate(start.getDate() - 29);
    return { from: localDateValue(start), to: localDateValue(end) };
  }, []);
  const [from, setFrom] = useState(initialRange.from);
  const [to, setTo] = useState(initialRange.to);
  const [storeId, setStoreId] = useState("");
  const [courierId, setCourierId] = useState("");
  const [status, setStatus] = useState("");
  const invalidRange = Boolean(from && to && from > to);
  const params = useMemo(
    () => ({
      from: from || undefined,
      to: to || undefined,
      storeId: storeId || undefined,
      courierId: courierId || undefined,
      status: status || undefined,
    }),
    [from, to, storeId, courierId, status],
  );
  const analytics = useGetDeliveryAnalytics(params, {
    query: {
      queryKey: getGetDeliveryAnalyticsQueryKey(params),
      enabled: !invalidRange,
      refetchOnWindowFocus: true,
    },
  });
  const stores = useListStores({ query: { queryKey: getListStoresQueryKey() } });
  const couriers = useListCouriers(undefined, {
    query: { queryKey: getListCouriersQueryKey() },
  });
  const data = analytics.data;
  const dailyData = useMemo(
    () => fillMissingDays(data?.daily ?? [], from, to),
    [data?.daily, from, to],
  );
  const courierData = useMemo(
    () =>
      (data?.couriers ?? []).map((courier) => ({
        name: courier.courierName,
        completedDeliveries: courier.completedDeliveries,
        courierAmount: courier.courierAmount,
        averageTotalMinutes: courier.averageTotalMinutes,
      })),
    [data?.couriers],
  );
  const statusData = useMemo(() => {
    const counts = new Map<string, number>();
    for (const delivery of data?.deliveries ?? []) {
      counts.set(delivery.status, (counts.get(delivery.status) ?? 0) + 1);
    }
    return [...counts.entries()]
      .map(([key, total]) => ({ name: STATUS_LABELS[key] ?? key, total }))
      .sort((a, b) => b.total - a.total);
  }, [data?.deliveries]);
  const cancellationReasonCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const item of data?.cancellations ?? []) {
      counts.set(item.reason, (counts.get(item.reason) ?? 0) + 1);
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1]);
  }, [data?.cancellations]);

  const exportCsv = () => {
    if (!data || (!data.deliveries.length && !data.cancellations.length)) return;
    const header = [
      "Tipo de registro",
      "Código",
      "Cliente",
      "Destino",
      "Filial",
      "Motoboy",
      "Status",
      "Tarifa",
      "Criada em",
      "Chegada à loja",
      "Saída da loja",
      "Concluída em",
      "Comprovante",
      "Motivo da ocorrência",
      "Observação",
      "Status da ocorrência",
      "Prioridade",
      "Horário da ocorrência",
      "Rota continua",
    ];
    const deliveryRows = data.deliveries.map((delivery) => [
      "Entrega",
      delivery.code,
      delivery.customerName,
      delivery.destination,
      delivery.storeName,
      delivery.courierName ?? "",
      STATUS_LABELS[delivery.status] ?? delivery.status,
      delivery.deliveryAmount.toFixed(2),
      stamp(delivery.createdAt),
      stamp(delivery.storeArrivedAt),
      stamp(delivery.storeDepartedAt),
      stamp(delivery.completedAt),
      delivery.evidenceAvailable ? "Disponível" : "Não disponível",
      "",
      "",
      "",
      "",
      "",
      "",
    ]);
    const cancellationRows = data.cancellations.map((item) => [
      "Ocorrência",
      item.code,
      item.customerName,
      "",
      item.storeName,
      item.courierName ?? "",
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      item.reason,
      item.observation ?? "",
      item.status,
      item.priority ? "Sim" : "Não",
      stamp(item.requestedAt),
      item.routeContinues ? "Sim" : "Não",
    ]);
    const rows = [...deliveryRows, ...cancellationRows];
    const csv = [header, ...rows]
      .map((row) => row.map(csvCell).join(";"))
      .join("\r\n");
    const url = URL.createObjectURL(
      new Blob(["\uFEFF", csv], { type: "text/csv;charset=utf-8" }),
    );
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `minas-mais-relatorio-${from || "inicio"}-${to || "hoje"}.csv`;
    anchor.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const total = data?.summary.total ?? 0;
  const completionRate = total
    ? Math.round((data!.summary.completed / total) * 100)
    : null;

  return (
    <div className="soft-enter space-y-5">
      <header className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
        <div>
          <div className="eyebrow">CENTRAL · DADOS DAS ENTREGAS</div>
          <h1 className="mt-2 text-[28px] font-bold tracking-[-.045em] sm:text-[34px]">
            Relatórios e indicadores
          </h1>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            Desempenho, prazos, volume diário e produção por motoboy, calculados a partir das entregas registradas.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            className="button-secondary min-h-10"
            type="button"
            onClick={() => void analytics.refetch()}
            disabled={invalidRange || analytics.isFetching}
            data-testid="button-refresh-report"
          >
            <RefreshCw size={15} className={analytics.isFetching ? "animate-spin" : ""} />
            Atualizar dados
          </button>
          <button
            className="button-primary min-h-10"
            type="button"
            onClick={exportCsv}
            disabled={!data || (!data.deliveries.length && !data.cancellations.length)}
            data-testid="button-export-report"
          >
            <Download size={15} />
            Exportar CSV
          </button>
        </div>
      </header>

      <section className="panel grid gap-3 p-4 sm:grid-cols-2 xl:grid-cols-5" aria-label="Filtros do relatório">
        <label className="field-label">
          De
          <input
            type="date"
            value={from}
            onChange={(event) => setFrom(event.target.value)}
            data-testid="filter-report-from"
          />
        </label>
        <label className="field-label">
          Até
          <input
            type="date"
            value={to}
            onChange={(event) => setTo(event.target.value)}
            data-testid="filter-report-to"
          />
        </label>
        <label className="field-label">
          Filial
          <select
            className="filter-select w-full"
            value={storeId}
            onChange={(event) => setStoreId(event.target.value)}
            data-testid="filter-report-store"
          >
            <option value="">Todas as filiais</option>
            {(stores.data ?? []).map((store) => (
              <option key={store.id} value={store.id}>
                {store.name}
              </option>
            ))}
          </select>
        </label>
        <label className="field-label">
          Motoboy
          <select
            className="filter-select w-full"
            value={courierId}
            onChange={(event) => setCourierId(event.target.value)}
            data-testid="filter-report-courier"
          >
            <option value="">Todos os motoboys</option>
            {(couriers.data ?? []).map((courier) => (
              <option key={courier.id} value={courier.id}>
                {courier.name}
              </option>
            ))}
          </select>
        </label>
        <label className="field-label">
          Status
          <select
            className="filter-select w-full"
            value={status}
            onChange={(event) => setStatus(event.target.value)}
            data-testid="filter-report-status"
          >
            <option value="">Todos os status</option>
            {Object.entries(STATUS_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
      </section>

      {invalidRange && (
        <div className="panel flex items-start gap-3 border-amber-300 p-4 text-sm text-amber-900" role="alert">
          <AlertCircle size={18} className="mt-0.5 shrink-0" />
          A data inicial precisa ser anterior ou igual à data final.
        </div>
      )}
      {analytics.isFetching && data && (
        <p className="text-xs text-muted-foreground" role="status">
          Atualizando os indicadores com os filtros selecionados…
        </p>
      )}

      {analytics.isLoading ? (
        <section className="panel space-y-3 p-5" aria-label="Carregando relatório">
          <div className="skeleton h-6 w-48" />
          <div className="skeleton h-28 w-full" />
          <div className="skeleton h-40 w-full" />
        </section>
      ) : analytics.isError ? (
        <section className="panel p-7 text-center" role="alert">
          <ChartNoAxesCombined className="mx-auto text-primary" size={26} />
          <h2 className="mt-3 font-semibold">Os indicadores não puderam ser carregados</h2>
          <p className="mx-auto mt-1 max-w-xl text-sm text-muted-foreground">
            {errorDetails(analytics.error)}
          </p>
          <button
            className="button-secondary mt-4"
            type="button"
            onClick={() => void analytics.refetch()}
            data-testid="button-retry-report"
          >
            <RefreshCw size={14} />
            Tentar novamente
          </button>
        </section>
      ) : data ? (
        <>
          <section
            className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-6"
            aria-label="Indicadores do período"
            data-testid="report-kpi-grid"
          >
            <ReportMetric
              label="Entregas registradas"
              value={number(data.summary.total)}
              note={`${number(data.summary.cancelled)} canceladas no período`}
              icon={<PackageCheck size={17} />}
            />
            <ReportMetric
              label="Entregas concluídas"
              value={number(data.summary.completed)}
              note={completionRate == null ? "Sem entregas no recorte" : `${completionRate}% do total`}
              icon={<CheckCircle2 size={17} />}
            />
            <ReportMetric
              label="Tempo total médio"
              value={minutesLabel(data.summary.averageTotalMinutes)}
              note="Do registro à conclusão"
              icon={<Clock3 size={17} />}
            />
            <ReportMetric
              label="Tempo médio na loja"
              value={minutesLabel(data.summary.averageStoreMinutes)}
              note="Chegada até a saída da filial"
              icon={<Store size={17} />}
            />
            <ReportMetric
              label="Tempo médio de entrega"
              value={minutesLabel(data.summary.averageDeliveryMinutes)}
              note="Saída da filial até a conclusão"
              icon={<Bike size={17} />}
            />
            <ReportMetric
              label="Repasses contabilizados"
              value={money(data.summary.courierAmount)}
              note="Entregas concluídas no recorte"
              icon={<Wallet size={17} />}
            />
          </section>

          {data.cancellations.length > 0 && (
            <section className="panel overflow-hidden" data-testid="report-cancellation-table">
              <div className="border-b border-border px-4 py-4 sm:px-5">
                <div className="eyebrow">NÃO ENTREGUES E DEVOLUÇÕES</div>
                <h2 className="mt-1 font-bold">Ocorrências por motivo, motoboy e filial</h2>
                <div className="mt-3 flex flex-wrap gap-2">
                  {cancellationReasonCounts.map(([reason, count]) => (
                    <span key={reason} className="rounded-full bg-[#f4e8e9] px-3 py-1.5 text-xs font-semibold text-primary">
                      {reason} · {number(count)}
                    </span>
                  ))}
                </div>
              </div>
              <div className="overflow-x-auto">
                <table className="delivery-table w-full min-w-[1000px]">
                  <thead>
                    <tr>
                      <th>Solicitada</th>
                      <th>Pedido / cliente</th>
                      <th>Motivo e observação</th>
                      <th>Filial</th>
                      <th>Motoboy</th>
                      <th>Situação</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.cancellations.map((item) => (
                      <tr key={item.id} className="row-hover">
                        <td className="text-xs">{stamp(item.requestedAt)}</td>
                        <td>
                          <Link href={`/deliveries/${item.deliveryId}`} className="table-code underline-offset-2 hover:underline">
                            {item.code}
                          </Link>
                          <span className="block text-[10px] text-muted-foreground">{item.customerName}</span>
                        </td>
                        <td>
                          <div className="font-semibold">{item.reason}</div>
                          {item.observation && <span className="text-[10px] text-muted-foreground">{item.observation}</span>}
                          {item.priority && <span className="ml-2 rounded-full bg-red-100 px-2 py-1 text-[9px] font-bold text-red-800">PRIORIDADE</span>}
                        </td>
                        <td>{item.storeName}</td>
                        <td>{item.courierName ?? "Sem motoboy"}</td>
                        <td className="text-xs">{item.status.replaceAll("_", " ")}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}

          {!data.deliveries.length ? (
            <section className="panel px-5 py-12 text-center" data-testid="report-empty-state">
              <CalendarDays size={26} className="mx-auto text-muted-foreground" />
              <h2 className="mt-3 font-semibold">Nenhuma entrega encontrada</h2>
              <p className="mx-auto mt-1 max-w-lg text-sm text-muted-foreground">
                Não há registros reais para o período e os filtros selecionados. Amplie o período ou remova algum filtro para consultar outros dados.
              </p>
            </section>
          ) : (
            <>
              <section className="grid gap-4 xl:grid-cols-[1.65fr_1fr]">
                <ChartPanel
                  eyebrow="VOLUME DIÁRIO"
                  title="Entregas registradas e concluídas"
                  description="Contagem diária no período filtrado"
                  testId="chart-deliveries-daily"
                >
                  {dailyData.length ? (
                    <div className="h-[290px] w-full">
                      <ResponsiveContainer width="100%" height="100%">
                        <BarChart data={dailyData} margin={{ top: 12, right: 12, left: -18, bottom: 2 }}>
                          <CartesianGrid strokeDasharray="3 3" vertical={false} />
                          <XAxis
                            dataKey="date"
                            tickFormatter={(value) => dateLabel(String(value))}
                            interval="preserveStartEnd"
                            minTickGap={24}
                            tick={{ fontSize: 11 }}
                          />
                          <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
                          <Tooltip
                            labelFormatter={(value) => dateLabel(String(value))}
                            formatter={(value, name) => [
                              `${number(Number(value))} entregas`,
                              name === "created" ? "Registradas" : "Concluídas",
                            ]}
                          />
                          <Legend
                            formatter={(value) => value === "created" ? "Registradas" : "Concluídas"}
                          />
                          <Bar dataKey="created" name="created" fill={CHART_COLORS.created} radius={[4, 4, 0, 0]} />
                          <Bar dataKey="completed" name="completed" fill={CHART_COLORS.completed} radius={[4, 4, 0, 0]} />
                        </BarChart>
                      </ResponsiveContainer>
                    </div>
                  ) : (
                    <ChartEmptyState />
                  )}
                </ChartPanel>

                <ChartPanel
                  eyebrow="SITUAÇÃO ATUAL"
                  title="Entregas por status"
                  description="Distribuição dos registros encontrados"
                  testId="chart-deliveries-status"
                >
                  {statusData.length ? (
                    <div className="h-[290px] w-full">
                      <ResponsiveContainer width="100%" height="100%">
                        <BarChart
                          data={statusData}
                          layout="vertical"
                          margin={{ top: 8, right: 18, left: 10, bottom: 4 }}
                        >
                          <CartesianGrid strokeDasharray="3 3" horizontal={false} />
                          <XAxis type="number" allowDecimals={false} tick={{ fontSize: 11 }} />
                          <YAxis
                            type="category"
                            dataKey="name"
                            width={118}
                            tick={{ fontSize: 10 }}
                          />
                          <Tooltip
                            formatter={(value) => [`${number(Number(value))} entregas`, "Total"]}
                          />
                          <Bar dataKey="total" name="Entregas" fill={CHART_COLORS.status} radius={[0, 4, 4, 0]} />
                        </BarChart>
                      </ResponsiveContainer>
                    </div>
                  ) : (
                    <ChartEmptyState />
                  )}
                </ChartPanel>
              </section>

              <section className="grid gap-4 xl:grid-cols-[1.15fr_1fr]">
                <ChartPanel
                  eyebrow="PRODUÇÃO"
                  title="Entregas concluídas por motoboy"
                  description="Volume concluído e repasse registrado no período"
                  testId="chart-deliveries-couriers"
                >
                  {courierData.length ? (
                    <div className="max-h-[440px] overflow-y-auto">
                      <div
                        className="w-full"
                        style={{ height: Math.max(260, courierData.length * 48) }}
                      >
                        <ResponsiveContainer width="100%" height="100%">
                          <BarChart
                            data={courierData}
                            layout="vertical"
                            margin={{ top: 8, right: 22, left: 8, bottom: 4 }}
                          >
                            <CartesianGrid strokeDasharray="3 3" horizontal={false} />
                            <XAxis type="number" allowDecimals={false} tick={{ fontSize: 11 }} />
                            <YAxis
                              type="category"
                              dataKey="name"
                              width={120}
                              tick={{ fontSize: 10 }}
                            />
                            <Tooltip
                              formatter={(value) => [`${number(Number(value))} entregas`, "Concluídas"]}
                            />
                            <Bar
                              dataKey="completedDeliveries"
                              name="Concluídas"
                              fill={CHART_COLORS.courier}
                              radius={[0, 4, 4, 0]}
                            />
                          </BarChart>
                        </ResponsiveContainer>
                      </div>
                    </div>
                  ) : (
                    <ChartEmptyState message="Não há entregas concluídas por motoboy neste recorte." />
                  )}
                </ChartPanel>

                <section className="panel overflow-hidden" data-testid="report-courier-details">
                  <div className="border-b border-border px-4 py-4 sm:px-5">
                    <div className="eyebrow">RESUMO INDIVIDUAL</div>
                    <h2 className="mt-1 font-bold">Produção e repasses</h2>
                  </div>
                  {courierData.length ? (
                    <ul className="divide-y divide-border">
                      {data.couriers.map((courier) => (
                        <li
                          key={courier.courierId}
                          className="flex items-center gap-3 px-4 py-3 sm:px-5"
                          data-testid={`report-courier-${courier.courierId}`}
                        >
                          <span className="avatar">
                            {courier.courierName.slice(0, 2).toUpperCase()}
                          </span>
                          <div className="min-w-0 flex-1">
                            <div className="truncate text-sm font-semibold">{courier.courierName}</div>
                            <div className="mt-1 text-xs text-muted-foreground">
                              {number(courier.completedDeliveries)} concluídas · média total {minutesLabel(courier.averageTotalMinutes)}
                            </div>
                          </div>
                          <strong className="whitespace-nowrap text-sm">
                            {money(courier.courierAmount)}
                          </strong>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <ChartEmptyState message="Os valores por motoboy aparecerão quando houver entregas concluídas atribuídas." />
                  )}
                </section>
              </section>

              <section className="panel overflow-hidden" data-testid="report-delivery-table">
                <div className="flex flex-col justify-between gap-2 border-b border-border px-4 py-4 sm:flex-row sm:items-end sm:px-5">
                  <div>
                    <div className="eyebrow">DETALHAMENTO</div>
                    <h2 className="mt-1 font-bold">Entregas do período</h2>
                  </div>
                  <span className="text-xs text-muted-foreground">
                    {number(data.deliveries.length)} registros · use Exportar CSV para baixar
                  </span>
                </div>
                <div className="overflow-x-auto">
                  <table className="delivery-table w-full min-w-[900px]">
                    <thead>
                      <tr>
                        <th>Pedido</th>
                        <th>Filial / motoboy</th>
                        <th>Status</th>
                        <th>Tarifa</th>
                        <th>Horários</th>
                        <th>Comprovante</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.deliveries.map((delivery) => (
                        <tr
                          key={delivery.id}
                          className="row-hover"
                          data-testid={`report-delivery-${delivery.id}`}
                        >
                          <td>
                            <Link
                              href={`/deliveries/${delivery.id}`}
                              className="table-code underline-offset-2 hover:underline"
                            >
                              {delivery.code}
                            </Link>
                            <span className="block text-[10px] text-muted-foreground">
                              {delivery.customerName}
                            </span>
                          </td>
                          <td>
                            <div className="font-semibold">{delivery.storeName}</div>
                            <span className="text-[10px] text-muted-foreground">
                              {delivery.courierName ?? "Sem motoboy"}
                            </span>
                          </td>
                          <td>
                            <span className="badge-neutral rounded-full px-2 py-1 text-[10px] font-semibold">
                              {STATUS_LABELS[delivery.status] ?? delivery.status}
                            </span>
                          </td>
                          <td className="font-semibold">{money(delivery.deliveryAmount)}</td>
                          <td>
                            <div className="text-[10px]">Criada {stamp(delivery.createdAt)}</div>
                            <div className="mt-1 text-[10px]">
                              Loja {stamp(delivery.storeArrivedAt)} · saída {stamp(delivery.storeDepartedAt)}
                            </div>
                            <div className="mt-1 text-[10px]">Conclusão {stamp(delivery.completedAt)}</div>
                          </td>
                          <td>
                            {delivery.evidenceAvailable ? (
                              <Link
                                href={`/deliveries/${delivery.id}`}
                                className="text-xs font-semibold text-primary underline-offset-2 hover:underline"
                              >
                                Abrir entrega
                              </Link>
                            ) : (
                              <span className="text-xs text-muted-foreground">Sem anexo</span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            </>
          )}
        </>
      ) : null}
      {(stores.isError || couriers.isError) && (
        <p role="status" className="text-xs text-amber-800">
          Não foi possível carregar uma ou mais opções de filtro. Os indicadores continuam vinculados aos dados do relatório.
        </p>
      )}
    </div>
  );
}

function ReportMetric({
  label,
  value,
  note,
  icon,
}: {
  label: string;
  value: string;
  note: string;
  icon: ReactNode;
}) {
  return (
    <article className="panel metric-card p-4" data-testid={`report-metric-${label.toLowerCase().replaceAll(" ", "-")}`}>
      <div className="flex items-center justify-between">
        <span className="eyebrow">{label}</span>
        <span className="metric-icon metric-icon-red">{icon}</span>
      </div>
      <div className="mono mt-3 text-2xl font-semibold" data-testid="report-metric-value">
        {value}
      </div>
      <p className="mt-1 text-[11px] text-muted-foreground">{note}</p>
    </article>
  );
}

function ChartPanel({
  eyebrow,
  title,
  description,
  testId,
  children,
}: {
  eyebrow: string;
  title: string;
  description: string;
  testId: string;
  children: ReactNode;
}) {
  return (
    <section className="panel overflow-hidden" data-testid={testId}>
      <div className="border-b border-border px-4 py-4 sm:px-5">
        <div className="eyebrow">{eyebrow}</div>
        <h2 className="mt-1 font-bold">{title}</h2>
        <p className="mt-1 text-xs text-muted-foreground">{description}</p>
      </div>
      <div className="p-3 sm:p-4">{children}</div>
    </section>
  );
}

function ChartEmptyState({
  message = "Sem dados suficientes para exibir este gráfico.",
}: {
  message?: string;
}) {
  return (
    <div className="grid min-h-[250px] place-items-center px-5 text-center text-sm text-muted-foreground">
      <p>{message}</p>
    </div>
  );
}
