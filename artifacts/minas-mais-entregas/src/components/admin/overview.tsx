import { useEffect, useMemo, useState } from "react";
import { Link, useLocation } from "wouter";
import {
  getListActiveRoutesQueryKey,
  getListCouriersQueryKey,
  getListDeliveriesQueryKey,
  getListDeliveryCancellationsQueryKey,
  getListStoresQueryKey,
  useListActiveRoutes,
  useListCouriers,
  useListDeliveries,
  useListDeliveryCancellations,
  useListStores,
  type Courier,
  type Delivery,
  type Store,
} from "@workspace/api-client-react";
import {
  AlertTriangle,
  Bike,
  Calendar,
  ChevronRight,
  Download,
  Layers,
  Maximize2,
  RefreshCw,
  ShieldCheck,
  SignalLow,
  Store as StoreIcon,
} from "lucide-react";
import LiveMap, { type MapMarker } from "@/components/live-map";
import { statusNames } from "@/components/delivery-status";
import {
  ActionButton,
  Card,
  CardHeader,
  FilterSelect,
  Indicator,
  PanelState,
  StatusPill,
  deliveryPill,
} from "./admin-ui";
import {
  applyFilters,
  courierAgeMs,
  courierMetrics,
  courierState,
  deliveryMetrics,
  emptyFilters,
  expectedAt,
  completedAt,
  formatAge,
  formatClock,
  isDelayed,
  periodLabel,
  type OverviewFilters,
  type PeriodKey,
} from "@/lib/operations";

/*
 * "Visão geral" of the Figma dashboard, fed only by the real API:
 * /deliveries, /couriers, /stores, /operations/active-routes and
 * /delivery-cancellations. Refreshes every 15 s (design rule) and keeps the
 * last data on screen when a refresh fails.
 */

const REFRESH_MS = 15_000;
const AUTO_REFRESH_KEY = "adm-auto-refresh";

const MARKER = {
  busy: "#456fad",
  available: "#1b6e46",
  urgent: "#b91e2c",
  offline: "#98a2b3",
};

function useNow(intervalMs = 1000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") setNow(Date.now());
    }, intervalMs);
    return () => window.clearInterval(timer);
  }, [intervalMs]);
  return now;
}

/** Shared data for the overview, the map page and the couriers page. */
export function useOperationsData(autoRefresh = true) {
  const live = { refetchInterval: autoRefresh ? REFRESH_MS : (false as const), refetchIntervalInBackground: false, refetchOnWindowFocus: true };
  const deliveries = useListDeliveries({}, { query: { queryKey: getListDeliveriesQueryKey({}), ...live } });
  const couriers = useListCouriers(undefined, { query: { queryKey: getListCouriersQueryKey(), ...live } });
  const stores = useListStores({ query: { queryKey: getListStoresQueryKey() } });
  const routes = useListActiveRoutes({ query: { queryKey: getListActiveRoutesQueryKey(), ...live } });
  const cancellations = useListDeliveryCancellations({ query: { queryKey: getListDeliveryCancellationsQueryKey(), ...live } });
  const queries = [deliveries, couriers, stores, routes, cancellations];
  const lastUpdatedAt = Math.max(...queries.map((query) => query.dataUpdatedAt || 0));
  return {
    deliveries,
    couriers,
    stores,
    routes,
    cancellations,
    isLoading: deliveries.isLoading || couriers.isLoading,
    hasError: queries.some((query) => query.isError),
    isFetching: queries.some((query) => query.isFetching),
    lastUpdatedAt: lastUpdatedAt || null,
    refetchAll: () => Promise.all(queries.map((query) => query.refetch())),
  };
}

function storeCityLabel(stores: Store[]) {
  const counts = new Map<string, number>();
  for (const store of stores) {
    if (!store.city) continue;
    const label = store.stateCode ? `${store.city}, ${store.stateCode}` : store.city;
    counts.set(label, (counts.get(label) ?? 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
}

export default function AdminOverview() {
  const [location] = useLocation();
  const [autoRefresh, setAutoRefresh] = useState(() => {
    try {
      return window.localStorage.getItem(AUTO_REFRESH_KEY) !== "0";
    } catch {
      return true;
    }
  });
  const [filters, setFilters] = useState<OverviewFilters>(emptyFilters);
  const [period, setPeriod] = useState<PeriodKey>("today");
  const data = useOperationsData(autoRefresh);
  const now = useNow();

  useEffect(() => {
    try {
      window.localStorage.setItem(AUTO_REFRESH_KEY, autoRefresh ? "1" : "0");
    } catch {
      // Preference only lives for this visit.
    }
  }, [autoRefresh]);

  // Header bell from another page lands here with ?alertas=1.
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get("alertas")) {
      window.setTimeout(() => document.getElementById("alertas")?.scrollIntoView({ behavior: "smooth", block: "start" }), 300);
    }
  }, [location]);

  const allDeliveries = data.deliveries.data ?? [];
  const allCouriers = data.couriers.data ?? [];
  const stores = data.stores.data ?? [];
  const filtered = useMemo(() => applyFilters(allDeliveries, filters, now), [allDeliveries, filters, now]);
  const metrics = useMemo(() => deliveryMetrics(filtered, period, now), [filtered, period, now]);
  const visibleCouriers = filters.courierId ? allCouriers.filter((courier) => courier.id === filters.courierId) : allCouriers;
  const courierStats = useMemo(() => courierMetrics(visibleCouriers, now), [visibleCouriers, now]);
  const hasFilters = Object.values(filters).some(Boolean);
  const setFilter = (key: keyof OverviewFilters, value: string) => setFilters((current) => ({ ...current, [key]: value }));

  const completedContext = metrics.completedChange == null
    ? "Sem base de comparação"
    : `${metrics.completedChange >= 0 ? "↑" : "↓"} ${Math.abs(metrics.completedChange).toLocaleString("pt-BR", { maximumFractionDigits: 0 })}% vs. ${period === "7d" ? "7 dias anteriores" : period === "yesterday" ? "anteontem" : "ontem"}`;

  return (
    <div className="flex flex-col gap-6">
      {/* Resumo e filtros */}
      <section aria-labelledby="overview-title" className="flex flex-col gap-4">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <p className="text-[10px] font-medium tracking-[0.7px] text-[var(--adm-muted)]">OPERAÇÃO / VISÃO GERAL</p>
            <h1 id="overview-title" className="mt-3 text-[24px] font-semibold leading-tight tracking-[-0.01em] text-[var(--adm-ink)] sm:text-[28px]">Sua operação, em tempo real.</h1>
            <p className="mt-2 text-[13px] text-[var(--adm-muted)]">Acompanhe cada entrega. Antecipe o próximo passo.</p>
          </div>
          <div className="flex flex-col gap-3 sm:items-end">
            <div className="flex flex-wrap items-center gap-3 sm:justify-end">
              <LiveChip hasError={data.hasError} lastUpdatedAt={data.lastUpdatedAt} />
              <label className="relative block w-full sm:w-[311px]">
                <span className="sr-only">Período</span>
                <Calendar size={18} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[var(--adm-muted)]" aria-hidden="true" />
                <select className="adm-select !pl-10" value={period} onChange={(event) => setPeriod(event.target.value as PeriodKey)}>
                  <option value="today">{periodLabel("today", new Date(now))}</option>
                  <option value="yesterday">{periodLabel("yesterday", new Date(now))}</option>
                  <option value="7d">{periodLabel("7d", new Date(now))}</option>
                </select>
              </label>
            </div>
            <Link href="/reports" className="adm-action adm-action--secondary !min-h-[34px] !rounded-[7px] !px-3 !text-[11px] !font-medium">
              <Download size={16} aria-hidden="true" /> Exportar relatório
            </Link>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <div className="grid w-full grid-cols-2 gap-3 sm:w-auto sm:grid-cols-4">
            <FilterSelect label="Filial" className="min-w-0 xl:w-[198px]" value={filters.storeId} data-active={Boolean(filters.storeId)} onChange={(event) => setFilter("storeId", event.target.value)}>
              <option value="">Todas as filiais</option>
              {stores.map((store) => <option key={store.id} value={store.id}>{store.name}</option>)}
            </FilterSelect>
            <FilterSelect label="Status" className="min-w-0 xl:w-[198px]" value={filters.status} data-active={Boolean(filters.status)} onChange={(event) => setFilter("status", event.target.value)}>
              <option value="">Todos os status</option>
              <option value="DELAYED">Atrasadas</option>
              {Object.entries(statusNames).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </FilterSelect>
            <FilterSelect label="Motoboy" className="min-w-0 xl:w-[198px]" value={filters.courierId} data-active={Boolean(filters.courierId)} onChange={(event) => setFilter("courierId", event.target.value)}>
              <option value="">Todos os motoboys</option>
              {allCouriers.map((courier) => <option key={courier.id} value={courier.id}>{courier.name}</option>)}
            </FilterSelect>
            <FilterSelect label="Prioridade" className="min-w-0 xl:w-[198px]" value={filters.priority} data-active={Boolean(filters.priority)} onChange={(event) => setFilter("priority", event.target.value)}>
              <option value="">Todas as prioridades</option>
              <option value="urgent">Urgente</option>
              <option value="normal">Normal</option>
            </FilterSelect>
          </div>
          <button type="button" className="min-h-[38px] rounded-[8px] px-2 text-[11px] font-medium text-[var(--adm-muted)] hover:text-[var(--adm-ink)] disabled:opacity-50" onClick={() => setFilters(emptyFilters)} disabled={!hasFilters}>
            Limpar filtros
          </button>
          <button
            type="button"
            role="switch"
            aria-checked={autoRefresh}
            onClick={() => setAutoRefresh((value) => !value)}
            className="ml-auto inline-flex min-h-[38px] items-center gap-2 rounded-[8px] px-2 text-[11px] text-[var(--adm-muted)] hover:text-[var(--adm-ink)]"
            title={autoRefresh ? "Pausar atualização automática" : "Retomar atualização automática"}
          >
            <RefreshCw size={14} className={autoRefresh && data.isFetching ? "animate-spin" : ""} aria-hidden="true" />
            {autoRefresh ? "Atualização automática" : "Atualização pausada"}
          </button>
        </div>
      </section>

      {/* Indicadores */}
      <section aria-label="Indicadores" className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <Indicator label="Entregas pendentes" value={String(metrics.pending).padStart(2, "0")} context="Aguardando coleta" loading={data.deliveries.isLoading} />
        <Indicator label="Em andamento" value={String(metrics.inTransit).padStart(2, "0")} context="Em rota agora" loading={data.deliveries.isLoading} />
        <Indicator
          label={period === "today" ? "Concluídas hoje" : period === "yesterday" ? "Concluídas ontem" : "Concluídas (7 dias)"}
          value={metrics.completed}
          context={completedContext}
          contextTone={metrics.completedChange != null && metrics.completedChange >= 0 ? "success" : "muted"}
          loading={data.deliveries.isLoading}
        />
        <Indicator
          label="Entregas urgentes"
          value={String(metrics.urgent).padStart(2, "0")}
          context={metrics.urgentAtRisk ? `${metrics.urgentAtRisk} com risco de atraso` : "Nenhuma com atraso"}
          highlight={metrics.urgent > 0}
          loading={data.deliveries.isLoading}
        />
        <Indicator
          label="Motoboys disponíveis"
          value={courierStats.available.length}
          context={`de ${courierStats.connected} conectados`}
          loading={data.couriers.isLoading}
        />
        <Indicator
          label="Tempo médio"
          value={metrics.averageMinutes == null ? "—" : `${Math.round(metrics.averageMinutes)} min`}
          context={metrics.averageMinutes == null ? "Sem entregas concluídas" : "Do pedido à entrega"}
          loading={data.deliveries.isLoading}
        />
      </section>

      {data.hasError && !data.isLoading && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-[10px] border border-[#f3d9a4] bg-[var(--adm-warning-bg)] px-4 py-3 text-[12px] text-[#6b4a00]" role="status">
          <span>Não foi possível atualizar agora. Os últimos dados continuam visíveis{data.lastUpdatedAt ? ` (sincronizados às ${formatClock(data.lastUpdatedAt)})` : ""}.</span>
          <button type="button" className="inline-flex items-center gap-1.5 font-semibold" onClick={() => void data.refetchAll()}><RefreshCw size={13} aria-hidden="true" /> Tentar novamente</button>
        </div>
      )}

      {/* minmax(0,1fr) no celular: sem isso a coluna implícita cresce até a largura da tabela e a página rola na horizontal. */}
      <div className="grid grid-cols-[minmax(0,1fr)] gap-5 lg:grid-cols-[minmax(0,1fr)_388px] lg:items-start [&>*>*]:min-w-0">
        <div className="contents lg:flex lg:flex-col lg:gap-6">
          <div className="order-1 lg:order-none">
            <OperationMap data={data} filters={filters} now={now} onClearFilters={() => setFilters(emptyFilters)} />
          </div>
          <div className="order-3 lg:order-none">
            <RecentDeliveries deliveries={filtered} isLoading={data.deliveries.isLoading} isError={data.deliveries.isError && !data.deliveries.data} onRetry={() => void data.deliveries.refetch()} hasFilters={hasFilters} onClearFilters={() => setFilters(emptyFilters)} now={now} />
          </div>
        </div>
        <div className="contents lg:flex lg:flex-col lg:gap-5">
          <div className="order-2 lg:order-none" id="alertas">
            <OperationAlerts deliveries={filtered} couriers={visibleCouriers} occurrences={data.cancellations.data?.length ?? 0} now={now} isLoading={data.isLoading} />
          </div>
          <div className="order-4 lg:order-none">
            <ActiveCouriers couriers={visibleCouriers} deliveries={allDeliveries} now={now} isLoading={data.couriers.isLoading} isError={data.couriers.isError && !data.couriers.data} onRetry={() => void data.couriers.refetch()} />
          </div>
          <div className="order-5 lg:order-none">
            <OperationHealth onTime={metrics.onTime} previous={metrics.previousOnTime} period={period} isLoading={data.deliveries.isLoading} />
          </div>
        </div>
      </div>
    </div>
  );
}

function LiveChip({ hasError, lastUpdatedAt }: { hasError: boolean; lastUpdatedAt: number | null }) {
  if (hasError) {
    return (
      <span className="inline-flex h-[25px] items-center gap-2 rounded-full bg-[var(--adm-warning-bg)] px-3 text-[11px] font-medium text-[#6b4a00]" role="status">
        <span className="size-1.5 rounded-full bg-[#d97706]" aria-hidden="true" /> Reconectando…
      </span>
    );
  }
  return (
    <span className="inline-flex h-[25px] items-center gap-2 rounded-full bg-[var(--adm-success-bg)] px-3 text-[11px] font-medium text-[var(--adm-success)]" role="status">
      <span className="size-1.5 animate-pulse rounded-full bg-[var(--adm-success)]" aria-hidden="true" />
      {lastUpdatedAt ? `Ao vivo · atualizado às ${formatClock(lastUpdatedAt)}` : "Conectando…"}
    </span>
  );
}

/* ---------------------------------------------------------------- Mapa */

export function OperationMap({
  data,
  filters = emptyFilters,
  now,
  tall = false,
  onClearFilters,
}: {
  data: ReturnType<typeof useOperationsData>;
  filters?: OverviewFilters;
  now: number;
  tall?: boolean;
  onClearFilters?: () => void;
}) {
  const [layers, setLayers] = useState({ couriers: true, stores: true, route: true });
  const [layersOpen, setLayersOpen] = useState(false);
  const deliveries = data.deliveries.data ?? [];
  const couriers = (data.couriers.data ?? []).filter((courier) => !filters.courierId || courier.id === filters.courierId);
  const stores = (data.stores.data ?? []).filter((store) => !filters.storeId || store.id === filters.storeId);
  const routes = data.routes.data ?? [];
  const deliveryByCode = new Map(deliveries.map((delivery) => [delivery.code, delivery]));

  const courierMarkers: MapMarker[] = couriers
    .filter((courier) => courier.currentLatitude != null && courier.currentLongitude != null)
    .map((courier) => {
      const state = courierState(courier, now);
      const current = courier.currentDeliveryCode ? deliveryByCode.get(courier.currentDeliveryCode) : undefined;
      const urgent = Boolean(current && (current.priority === "urgent" || isDelayed(current, now)));
      const age = courierAgeMs(courier, now);
      return {
        id: courier.id,
        latitude: courier.currentLatitude!,
        longitude: courier.currentLongitude!,
        title: courier.name,
        detail: state === "offline"
          ? `Sem sinal — última posição há ${formatAge(age)}`
          : `${courier.currentDeliveryCode ? `${courier.currentDeliveryCode} · ` : ""}GPS há ${formatAge(age)}`,
        kind: "courier",
        label: courier.name.split(" ")[0],
        color: state === "offline" ? MARKER.offline : urgent ? MARKER.urgent : state === "busy" ? MARKER.busy : MARKER.available,
      };
    });
  const storeMarkers: MapMarker[] = stores
    .filter((store) => store.active && store.latitude != null && store.longitude != null)
    .map((store) => ({
      id: `store-${store.id}`,
      latitude: store.latitude!,
      longitude: store.longitude!,
      title: `Filial ${store.name}`,
      detail: `${store.city}${store.stateCode ? ` · ${store.stateCode}` : ""}`,
      kind: "store",
      color: "#ffffff",
      textColor: "#b91e2c",
    }));
  const selectedRoute = filters.courierId ? routes.find((route) => route.courierId === filters.courierId) : routes[0];
  const markers = [...(layers.couriers ? courierMarkers : []), ...(layers.stores ? storeMarkers : [])];
  const routeGeometry = layers.route ? selectedRoute?.routeGeometry : undefined;
  const latestAge = courierMarkers.reduce<number | null>((latest, marker) => {
    const courier = couriers.find((item) => item.id === marker.id);
    const age = courier ? courierAgeMs(courier, now) : null;
    return age != null && (latest == null || age < latest) ? age : latest;
  }, null);
  const live = latestAge != null && latestAge <= 120_000;
  const city = storeCityLabel(data.stores.data ?? []);
  const loading = data.couriers.isLoading || data.stores.isLoading || data.routes.isLoading;
  const failed = data.couriers.isError && data.stores.isError && !data.couriers.data && !data.stores.data;

  return (
    <Card aria-labelledby="map-title" className="overflow-hidden">
      <CardHeader
        title={<span id="map-title">Mapa da operação</span>}
        aside={
          <div className="flex items-center gap-4">
            {city && <span className="hidden text-[12px] text-[var(--adm-muted)] sm:inline">{city}</span>}
            {!tall && (
              <Link href="/mapa" className="adm-icon-button" aria-label="Abrir mapa em tela cheia" title="Abrir mapa em tempo real">
                <Maximize2 size={18} aria-hidden="true" />
              </Link>
            )}
          </div>
        }
      >
        <span className={`inline-flex h-6 items-center gap-1.5 rounded-[6px] px-2.5 text-[11px] font-medium ${live ? "bg-[var(--adm-success-bg)] text-[var(--adm-success)]" : "bg-[var(--adm-chip)] text-[var(--adm-muted)]"}`}>
          <span className={`size-1.5 rounded-full bg-current ${live ? "animate-pulse" : ""}`} aria-hidden="true" />
          {live ? "Ao vivo" : latestAge == null ? "Aguardando GPS" : `GPS há ${formatAge(latestAge)}`}
        </span>
      </CardHeader>
      {loading ? (
        <PanelState state="loading" title="Carregando a operação" detail="Sincronizando entregas e localizações." />
      ) : failed ? (
        <PanelState
          state="error"
          title="Não foi possível atualizar"
          detail="Sua conexão foi interrompida. As entregas continuam disponíveis para consulta."
          action={<ActionButton onClick={() => void data.refetchAll()}>Tentar novamente</ActionButton>}
          footnote={data.lastUpdatedAt ? `Última sincronização às ${formatClock(data.lastUpdatedAt)}` : undefined}
        />
      ) : !markers.length && !routeGeometry?.length && onClearFilters && (filters.courierId || filters.storeId) ? (
        <PanelState
          state="empty"
          title="Nenhuma posição por aqui"
          detail="Não há motoboys com GPS nem filiais com coordenadas para os filtros selecionados."
          action={<ActionButton variant="secondary" onClick={onClearFilters}>Limpar filtros</ActionButton>}
        />
      ) : (
        <div className={`adm-map-frame relative border-t border-[var(--adm-border)] ${tall ? "adm-map-frame--tall" : ""}`}>
          <LiveMap
            markers={markers}
            routeGeometry={routeGeometry}
            routeColor={MARKER.busy}
            ariaLabel="Mapa da operação com motoboys, filiais e rota ativa"
            showCenterControls
            centerOnStoresOnly={!courierMarkers.length}
            showCenterOnMe={false}
            controlsAboveAttribution
          />
          <div className="absolute left-4 top-4 z-10">
            <button
              type="button"
              className="inline-flex h-8 items-center gap-2 rounded-[7px] border border-[var(--adm-border-strong)] bg-white px-2.5 text-[11px] font-medium text-[var(--adm-ink)] shadow-[0_3px_12px_rgba(26,38,51,0.1)]"
              aria-expanded={layersOpen}
              aria-controls="map-layers"
              onClick={() => setLayersOpen((open) => !open)}
            >
              <Layers size={16} aria-hidden="true" /> Camadas
            </button>
            {layersOpen && (
              <fieldset id="map-layers" className="mt-2 w-48 rounded-[8px] border border-[var(--adm-border-strong)] bg-white p-2 shadow-[0_3px_12px_rgba(26,38,51,0.1)]">
                <legend className="sr-only">Camadas do mapa</legend>
                {([
                  ["couriers", "Motoboys"],
                  ["stores", "Filiais"],
                  ["route", "Rota ativa"],
                ] as const).map(([key, label]) => (
                  <label key={key} className="flex min-h-9 cursor-pointer items-center gap-2 rounded-[6px] px-2 text-[12px] text-[var(--adm-ink)] hover:bg-[var(--adm-surface-soft)]">
                    <input type="checkbox" className="!h-4 !w-4 accent-[#b91e2c]" checked={layers[key]} onChange={(event) => setLayers((current) => ({ ...current, [key]: event.target.checked }))} />
                    {label}
                  </label>
                ))}
              </fieldset>
            )}
          </div>
          <div className="pointer-events-none absolute bottom-4 left-4 z-10 hidden max-w-[calc(100%-120px)] flex-wrap items-center gap-x-5 gap-y-1 rounded-[8px] border border-[var(--adm-border-strong)] bg-white px-3 py-2 text-[11px] text-[var(--adm-muted)] sm:flex" aria-hidden="true">
            {[
              [MARKER.busy, "Em rota"],
              [MARKER.available, "Disponível"],
              [MARKER.urgent, "Urgente"],
              [MARKER.offline, "Offline"],
            ].map(([color, label]) => (
              <span key={label} className="inline-flex items-center gap-1.5"><span className="size-1.5 rounded-full" style={{ background: color }} />{label}</span>
            ))}
            <span className="inline-flex items-center gap-1.5"><StoreIcon size={14} className="text-[var(--adm-primary)]" />Filiais</span>
          </div>
          {!courierMarkers.length && (
            <p className="pointer-events-none absolute left-1/2 top-4 z-10 -translate-x-1/2 rounded-[8px] bg-white/95 px-3 py-1.5 text-[11px] text-[var(--adm-muted)] shadow-sm">
              Nenhum motoboy com GPS no momento.
            </p>
          )}
        </div>
      )}
    </Card>
  );
}

/* -------------------------------------------------------------- Alertas */

function OperationAlerts({
  deliveries,
  couriers,
  occurrences,
  now,
  isLoading,
}: {
  deliveries: Delivery[];
  couriers: Courier[];
  occurrences: number;
  now: number;
  isLoading: boolean;
}) {
  const delayed = deliveries.filter((delivery) => isDelayed(delivery, now));
  const signalLost = courierMetrics(couriers, now).signalLost;
  const storeCounts = new Map<string, number>();
  for (const delivery of delayed) storeCounts.set(delivery.storeName, (storeCounts.get(delivery.storeName) ?? 0) + 1);
  const topStore = [...storeCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];

  type Alert = { key: string; tone: "warning" | "neutral" | "danger"; icon: typeof AlertTriangle; title: string; detail: string; href: string };
  const alerts: Alert[] = [];
  if (occurrences > 0) {
    alerts.push({
      key: "occurrences",
      tone: "danger",
      icon: AlertTriangle,
      title: `${occurrences} ${occurrences === 1 ? "ocorrência dos motoboys" : "ocorrências dos motoboys"}`,
      detail: "Entregas não concluídas aguardando a Central",
      href: "/entregas#ocorrencias",
    });
  }
  if (delayed.length) {
    alerts.push({
      key: "delayed",
      tone: "warning",
      icon: AlertTriangle,
      title: `${delayed.length} ${delayed.length === 1 ? "entrega com risco de atraso" : "entregas com risco de atraso"}`,
      detail: topStore ? `Filial ${topStore} · priorize as coletas` : "Priorize as coletas",
      href: delayed.length === 1 ? `/deliveries/${delayed[0].id}` : "/entregas",
    });
  }
  for (const courier of signalLost.slice(0, 3)) {
    alerts.push({
      key: `signal-${courier.id}`,
      tone: "neutral",
      icon: SignalLow,
      title: `${courier.name} está sem sinal`,
      detail: courier.lastLocationAt ? `Última localização há ${formatAge(courierAgeMs(courier, now))}` : "Ainda sem localização registrada",
      href: "/motoboys",
    });
  }
  const total = occurrences + delayed.length + signalLost.length;
  const toneClass = { warning: "bg-[var(--adm-warning-bg)]", neutral: "bg-[var(--adm-surface-soft)]", danger: "bg-[var(--adm-danger-bg)]" };
  const iconClass = { warning: "text-[#d97706]", neutral: "text-[var(--adm-muted)]", danger: "text-[var(--adm-primary)]" };

  return (
    <Card aria-labelledby="alerts-title">
      <div className="flex items-center justify-between px-5 pb-3 pt-4">
        <h2 id="alerts-title" className="text-[15px] font-semibold text-[var(--adm-ink)]">Atenção à operação</h2>
        <span className={`rounded-[6px] px-2.5 py-1.5 text-[11px] font-semibold leading-none ${total ? "bg-[var(--adm-danger-bg)] text-[var(--adm-primary)]" : "bg-[var(--adm-success-bg)] text-[var(--adm-success)]"}`} aria-label={`${total} alertas`}>
          {String(total).padStart(2, "0")}
        </span>
      </div>
      <div className="flex flex-col gap-2 px-4 pb-4">
        {isLoading ? (
          <>
            <span className="adm-skeleton h-12 w-full" aria-hidden="true" />
            <span className="adm-skeleton h-12 w-full" aria-hidden="true" />
          </>
        ) : alerts.length ? (
          alerts.map((alert) => {
            const Icon = alert.icon;
            return (
              <Link key={alert.key} href={alert.href} className={`group flex min-h-[48px] items-center gap-3 rounded-[8px] px-3 py-2 ${toneClass[alert.tone]} hover:brightness-[.98]`}>
                <Icon size={18} className={`shrink-0 ${iconClass[alert.tone]}`} aria-hidden="true" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[11px] font-medium text-[var(--adm-ink)]">{alert.title}</span>
                  <span className="mt-1 block truncate text-[11px] text-[var(--adm-muted)]">{alert.detail}</span>
                </span>
                <ChevronRight size={14} className="shrink-0 text-[var(--adm-muted)] transition-transform group-hover:translate-x-0.5" aria-hidden="true" />
              </Link>
            );
          })
        ) : (
          <p className="flex min-h-[48px] items-center gap-3 rounded-[8px] bg-[var(--adm-success-bg)] px-3 text-[11px] font-medium text-[var(--adm-success)]" role="status">
            <ShieldCheck size={18} aria-hidden="true" /> Nenhum alerta agora. A operação segue normal.
          </p>
        )}
      </div>
    </Card>
  );
}

/* ------------------------------------------------------ Motoboys ativos */

export function ActiveCouriers({
  couriers,
  deliveries,
  now,
  isLoading,
  isError,
  onRetry,
  full = false,
}: {
  couriers: Courier[];
  deliveries: Delivery[];
  now: number;
  isLoading: boolean;
  isError: boolean;
  onRetry: () => void;
  full?: boolean;
}) {
  const [tab, setTab] = useState<"busy" | "available" | "offline">("busy");
  const stats = courierMetrics(couriers, now);
  const deliveryByCode = new Map(deliveries.map((delivery) => [delivery.code, delivery]));
  const lists = { busy: stats.busy, available: stats.available, offline: stats.offline };
  const tabs = [
    ["busy", "Em rota", stats.busy.length],
    ["available", "Disponíveis", stats.available.length],
    ...(full ? [["offline", "Offline", stats.offline.length] as const] : []),
  ] as const;
  const rows = full ? lists[tab] : lists[tab].slice(0, 4);

  return (
    <Card aria-labelledby="couriers-title">
      <div className="flex items-center justify-between px-5 pb-2 pt-4">
        <h2 id="couriers-title" className="text-[16px] font-semibold text-[var(--adm-ink)]">Motoboys ativos</h2>
        <span className="rounded-[6px] bg-[var(--adm-success-bg)] px-2.5 py-1.5 text-[11px] font-semibold leading-none text-[var(--adm-success)]">{stats.connected} online</span>
      </div>
      <div className="relative mx-5 mt-2 flex gap-8 border-b border-[var(--adm-border)]" role="tablist" aria-label="Situação dos motoboys">
        {tabs.map(([key, label, count]) => (
          <button
            key={key}
            type="button"
            role="tab"
            id={`couriers-tab-${key}`}
            aria-selected={tab === key}
            aria-controls="couriers-panel"
            onClick={() => setTab(key)}
            className={`-mb-px min-h-[36px] border-b-2 pb-2 text-[12px] ${tab === key ? "border-[var(--adm-primary)] font-semibold text-[var(--adm-ink)]" : "border-transparent font-medium text-[var(--adm-muted)] hover:text-[var(--adm-ink)]"}`}
          >
            {label} <span className="ml-1 tabular-nums">{count}</span>
          </button>
        ))}
      </div>
      <div id="couriers-panel" role="tabpanel" aria-labelledby={`couriers-tab-${tab}`} className="px-5 pt-2">
        {isLoading ? (
          <div className="flex flex-col gap-3 py-2" aria-hidden="true">{[0, 1, 2].map((item) => <span key={item} className="adm-skeleton h-11 w-full" />)}</div>
        ) : isError ? (
          <div className="py-6 text-center text-[12px] text-[var(--adm-muted)]" role="alert">
            Não foi possível carregar os motoboys.
            <div className="mt-3"><ActionButton variant="secondary" onClick={onRetry}>Tentar novamente</ActionButton></div>
          </div>
        ) : rows.length ? (
          <ul>
            {rows.map((courier, index) => {
              const current = courier.currentDeliveryCode ? deliveryByCode.get(courier.currentDeliveryCode) : undefined;
              const late = current ? isDelayed(current, now) : false;
              const state = courierState(courier, now);
              const pill = state === "offline"
                ? { tone: "neutral" as const, label: "Offline" }
                : late
                  ? { tone: "danger" as const, label: "Atrasada" }
                  : state === "busy"
                    ? { tone: "info" as const, label: "Em rota" }
                    : { tone: "success" as const, label: "Disponível" };
              const age = courierAgeMs(courier, now);
              return (
                <li key={courier.id} className={`flex items-start gap-3 py-2 ${index > 0 ? "border-t border-[var(--adm-chip)]" : ""}`}>
                  <span className={`mt-0.5 grid size-[34px] shrink-0 place-items-center rounded-[9px] ${late ? "bg-[var(--adm-danger-bg)] text-[var(--adm-primary)]" : "bg-[var(--adm-chip)] text-[var(--adm-muted)]"}`} aria-hidden="true">
                    <Bike size={20} strokeWidth={1.75} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[12px] font-semibold text-[var(--adm-ink)]">{courier.name}</span>
                    <span className="mt-1 block truncate text-[11px] text-[var(--adm-muted)]">
                      {current
                        ? <Link href={`/deliveries/${current.id}`} className="hover:underline">{current.code} · {current.storeName} → {current.customerName}</Link>
                        : courier.currentDeliveryCode ?? (courier.phone || "Sem entrega no momento")}
                    </span>
                  </span>
                  <span className="flex shrink-0 flex-col items-end gap-1">
                    <StatusPill tone={pill.tone}>{pill.label}</StatusPill>
                    <span className="text-[10px] text-[var(--adm-muted)]">{courier.lastLocationAt ? `GPS há ${formatAge(age)}` : "Sem GPS"}</span>
                  </span>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="py-6 text-center text-[12px] text-[var(--adm-muted)]">
            {tab === "busy" ? "Nenhum motoboy em rota agora." : tab === "available" ? "Nenhum motoboy disponível agora." : "Nenhum motoboy offline."}
          </p>
        )}
      </div>
      <div className="mx-5 mt-2 flex items-center justify-between border-t border-[var(--adm-border)] py-3">
        <span className="text-[11px] text-[var(--adm-muted)]">{stats.offline.length} offline</span>
        {!full && (
          <Link href="/motoboys" className="adm-link">Ver todos os motoboys <ChevronRight size={13} aria-hidden="true" /></Link>
        )}
      </div>
    </Card>
  );
}

/* ---------------------------------------------------- Entregas recentes */

function RecentDeliveries({
  deliveries,
  isLoading,
  isError,
  onRetry,
  hasFilters,
  onClearFilters,
  now,
}: {
  deliveries: Delivery[];
  isLoading: boolean;
  isError: boolean;
  onRetry: () => void;
  hasFilters: boolean;
  onClearFilters: () => void;
  now: number;
}) {
  const recent = [...deliveries]
    .sort((a, b) => Date.parse(b.updatedAt ?? b.createdAt) - Date.parse(a.updatedAt ?? a.createdAt))
    .slice(0, 5);

  return (
    <Card aria-labelledby="recent-title" className="overflow-hidden">
      <CardHeader
        title={<span id="recent-title">Entregas recentes</span>}
        aside={<Link href="/entregas" className="adm-link">Ver todas <ChevronRight size={13} aria-hidden="true" /></Link>}
      >
        <span className="text-[11px] text-[var(--adm-muted)]">Últimas movimentações da operação</span>
      </CardHeader>
      {isLoading ? (
        <div className="flex flex-col gap-2 px-5 pb-5" aria-hidden="true">{[0, 1, 2, 3].map((item) => <span key={item} className="adm-skeleton h-9 w-full" />)}</div>
      ) : isError ? (
        <PanelState state="error" title="Não foi possível atualizar" detail="Sua conexão foi interrompida. Tente novamente em instantes." action={<ActionButton onClick={onRetry}>Tentar novamente</ActionButton>} />
      ) : !recent.length ? (
        <PanelState
          state="empty"
          title="Nenhuma entrega por aqui"
          detail={hasFilters ? "Não há entregas para os filtros selecionados. Ajuste a busca para ver outros resultados." : "Quando uma entrega for registrada, ela aparecerá aqui."}
          action={hasFilters ? <ActionButton variant="secondary" onClick={onClearFilters}>Limpar filtros</ActionButton> : undefined}
        />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] border-collapse text-left">
            <thead>
              <tr className="bg-[var(--adm-surface-soft)] text-[11px] font-medium text-[var(--adm-muted)]">
                <th scope="col" className="h-[30px] py-0 pl-5 pr-3 font-medium">Entrega</th>
                <th scope="col" className="px-3 font-medium">Origem / destino</th>
                <th scope="col" className="px-3 font-medium">Motoboy</th>
                <th scope="col" className="px-3 font-medium">Status</th>
                <th scope="col" className="py-0 pl-3 pr-5 font-medium">Previsão</th>
              </tr>
            </thead>
            <tbody>
              {recent.map((delivery, index) => {
                const late = isDelayed(delivery, now);
                const pill = deliveryPill(delivery.status, late);
                const expected = expectedAt(delivery);
                const done = completedAt(delivery);
                let eta = "—";
                let etaDetail = "Sem previsão";
                let etaTone = "text-[var(--adm-muted)]";
                if (delivery.status === "COMPLETED" && done != null) {
                  eta = formatClock(done);
                  if (expected != null) {
                    const diff = Math.round((done - expected) / 60_000);
                    etaDetail = diff <= 0 ? "No prazo" : `+${diff} min`;
                    etaTone = diff <= 0 ? "text-[var(--adm-success)]" : "text-[var(--adm-primary)]";
                  } else {
                    etaDetail = "Concluída";
                  }
                } else if (expected != null && ["CANCELLED", "NOT_DELIVERED"].indexOf(delivery.status) < 0) {
                  eta = formatClock(expected);
                  const diff = Math.round((expected - now) / 60_000);
                  etaDetail = diff >= 0 ? `Em ${diff} min` : `+${Math.abs(diff)} min`;
                  if (diff < 0) etaTone = "text-[var(--adm-primary)]";
                }
                return (
                  <tr key={delivery.id} className={`adm-row ${late ? "bg-[#fffcfc]" : ""} ${index > 0 ? "border-t border-[#f1f3f5]" : ""}`}>
                    <td className="py-2 pl-5 pr-3 align-top">
                      <Link href={`/deliveries/${delivery.id}`} className="block text-[11px] font-semibold text-[var(--adm-ink)] hover:text-[var(--adm-primary)] hover:underline">{delivery.code}</Link>
                      <span className={`mt-1 block text-[10px] ${delivery.priority === "urgent" ? "font-semibold text-[var(--adm-primary)]" : "text-[var(--adm-muted)]"}`}>{delivery.priority === "urgent" ? "Urgente" : "Normal"}</span>
                    </td>
                    <td className="max-w-[260px] px-3 py-2 align-top">
                      <span className="block truncate text-[11px] font-medium text-[var(--adm-ink)]">{delivery.storeName} → {delivery.customerName}</span>
                      <span className="mt-1 block truncate text-[10px] text-[var(--adm-muted)]">{delivery.destination}</span>
                    </td>
                    <td className="px-3 py-2 align-middle text-[11px] text-[var(--adm-ink)]">{delivery.courierName ?? <span className="text-[var(--adm-muted)]">Não atribuído</span>}</td>
                    <td className="px-3 py-2 align-middle"><StatusPill tone={pill.tone}>{pill.label}</StatusPill></td>
                    <td className="py-2 pl-3 pr-5 align-top">
                      <span className={`block text-[11px] font-medium ${late ? "text-[var(--adm-primary)]" : "text-[var(--adm-ink)]"}`}>{eta}</span>
                      <span className={`mt-1 block text-[10px] ${etaTone}`}>{etaDetail}</span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

/* ---------------------------------------------------- Saúde da operação */

function OperationHealth({
  onTime,
  previous,
  period,
  isLoading,
}: {
  onTime: { share: number; measured: number } | null;
  previous: { share: number; measured: number } | null;
  period: PeriodKey;
  isLoading: boolean;
}) {
  const diff = onTime && previous ? onTime.share - previous.share : null;
  const compareLabel = period === "7d" ? "aos 7 dias anteriores" : period === "yesterday" ? "a anteontem" : "a ontem";
  return (
    <Card aria-labelledby="health-title" className="px-5 pb-4 pt-[18px]">
      <div className="flex items-start gap-3">
        <span className="grid size-8 shrink-0 place-items-center rounded-[8px] bg-[var(--adm-success-bg)] text-[var(--adm-success)]" aria-hidden="true"><ShieldCheck size={18} /></span>
        <div className="min-w-0 flex-1">
          <h2 id="health-title" className="text-[12px] font-medium text-[var(--adm-ink)]">Dentro do prazo</h2>
          <p className="mt-1 text-[11px] text-[var(--adm-muted)]">{onTime ? `${onTime.measured} ${onTime.measured === 1 ? "entrega concluída" : "entregas concluídas"} com previsão` : "Entregas concluídas com previsão"}</p>
        </div>
        {isLoading ? (
          <span className="adm-skeleton h-7 w-16" aria-hidden="true" />
        ) : (
          <strong className={`text-[23px] font-semibold tabular-nums ${onTime ? "text-[var(--adm-success)]" : "text-[var(--adm-muted)]"}`}>
            {onTime ? `${onTime.share.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%` : "—"}
          </strong>
        )}
      </div>
      <div className="mt-[18px] h-[5px] overflow-hidden rounded-[3px] bg-[#edf1f3]" role="progressbar" aria-label="Entregas dentro do prazo" aria-valuemin={0} aria-valuemax={100} aria-valuenow={onTime ? Math.round(onTime.share) : 0}>
        <div className="h-full rounded-[3px] bg-[#55a17b] transition-[width] duration-500" style={{ width: `${onTime?.share ?? 0}%` }} />
      </div>
      <p className="mt-3 text-[11px] text-[var(--adm-muted)]">
        {diff == null
          ? onTime ? "Sem base de comparação" : "Sem entregas concluídas com previsão no período"
          : `${diff >= 0 ? "↑" : "↓"} ${Math.abs(diff).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} p.p. em relação ${compareLabel}`}
      </p>
    </Card>
  );
}
