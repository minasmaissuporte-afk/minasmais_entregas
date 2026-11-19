import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  getGetDevDatabaseInfoQueryKey,
  getGetDevOverviewQueryKey,
  getGetDevRequestStatsQueryKey,
  getListDevApiErrorsQueryKey,
  useGetDevDatabaseInfo,
  useGetDevOverview,
  useGetDevRequestStats,
  useListDevApiErrors,
  type DevRequestStats,
  type ListDevApiErrorsStatus,
} from "@workspace/api-client-react";
import { BookOpen, Check, Copy, Database, ExternalLink, GitCommitHorizontal, RefreshCw, Search, Server, TriangleAlert } from "lucide-react";
import { StatusPill, type PillTone } from "@/components/admin/admin-ui";
import ErpIntegration from "@/pages/erp-integration";

/*
 * Painel técnico (administração + desenvolvimento): saúde e deploy, serviços configurados,
 * métricas de requisições da API, erros recentes, Integração ERP, banco de dados e referência.
 * Só administradores. Nenhum segredo aparece aqui, só se está configurado.
 */

const tabs = [
  { id: "visao-geral", label: "Visão geral" },
  { id: "requisicoes", label: "Requisições" },
  { id: "erros", label: "Erros" },
  { id: "erp", label: "Integração ERP" },
  { id: "banco", label: "Banco de dados" },
  { id: "referencia", label: "Referência" },
] as const;
type TabId = (typeof tabs)[number]["id"];

function initialTab(): TabId {
  const value = new URLSearchParams(window.location.search).get("aba");
  return tabs.some((tab) => tab.id === value) ? (value as TabId) : "visao-geral";
}

const number = (value: number | null | undefined) => (value ?? 0).toLocaleString("pt-BR");
const ms = (value: number | null | undefined) => (value == null ? "—" : `${value.toLocaleString("pt-BR", { maximumFractionDigits: 1 })} ms`);
const dateTime = (value: string | null | undefined) =>
  value ? new Date(value).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit" }) : "—";
const percent = (part: number, whole: number) => (whole ? `${((part / whole) * 100).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%` : "0%");

function bytes(value: number | null | undefined) {
  if (value == null) return "—";
  const units = ["B", "KB", "MB", "GB"];
  let size = value;
  let unit = 0;
  while (size >= 1024 && unit < units.length - 1) {
    size /= 1024;
    unit += 1;
  }
  return `${size.toLocaleString("pt-BR", { maximumFractionDigits: unit ? 1 : 0 })} ${units[unit]}`;
}

function duration(fromIso: string, toIso: string) {
  const minutes = Math.max(0, Math.round((new Date(toIso).getTime() - new Date(fromIso).getTime()) / 60_000));
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  return hours < 48 ? `${hours} h ${minutes % 60} min` : `${Math.floor(hours / 24)} dias`;
}

const live = { refetchInterval: 30_000, refetchOnWindowFocus: true };

function Section({ title, eyebrow, children, aside, id }: { title: string; eyebrow?: string; children: ReactNode; aside?: ReactNode; id?: string }) {
  return (
    <section className="panel mb-6 p-4 sm:p-6" aria-labelledby={id}>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          {eyebrow && <div className="eyebrow">{eyebrow}</div>}
          <h2 id={id} className="mt-1 text-lg font-bold">{title}</h2>
        </div>
        {aside}
      </div>
      <div className="mt-4">{children}</div>
    </section>
  );
}

function Tile({ label, value, hint, tone = "default" }: { label: string; value: ReactNode; hint?: ReactNode; tone?: "default" | "danger" | "success" }) {
  const color = tone === "danger" ? "text-[var(--adm-primary)]" : tone === "success" ? "text-[var(--adm-success)]" : "text-[#24272d]";
  return (
    <div className={`rounded-lg border bg-white px-3 py-2.5 ${tone === "danger" ? "border-[#f0ccd1]" : "border-border"}`}>
      <span className="block text-[12px] font-medium text-muted-foreground">{label}</span>
      <strong className={`mt-0.5 block text-2xl font-semibold tabular-nums ${color}`}>{value}</strong>
      {hint && <span className="block text-[11px] text-muted-foreground">{hint}</span>}
    </div>
  );
}

function KeyValue({ items }: { items: { label: string; value: ReactNode }[] }) {
  return (
    <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2 xl:grid-cols-3">
      {items.map((item) => (
        <div key={item.label} className="min-w-0">
          <dt className="text-[11px] font-semibold uppercase tracking-[.08em] text-muted-foreground">{item.label}</dt>
          <dd className="mt-0.5 break-words text-sm font-medium text-[#24272d]">{item.value}</dd>
        </div>
      ))}
    </dl>
  );
}

function CopyInline({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className="icon-button !h-7 !w-7"
      aria-label={`Copiar ${text}`}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setCopied(true);
          window.setTimeout(() => setCopied(false), 1500);
        } catch {
          /* sem permissão de área de transferência */
        }
      }}
    >
      {copied ? <Check size={13} /> : <Copy size={13} />}
    </button>
  );
}

function statusTone(status: number): PillTone {
  return status >= 500 ? "danger" : status >= 400 ? "warning" : "success";
}

export default function DevPanel() {
  const [tab, setTab] = useState<TabId>(initialTab);
  useEffect(() => {
    const url = new URL(window.location.href);
    if (tab === "visao-geral") url.searchParams.delete("aba");
    else url.searchParams.set("aba", tab);
    window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}`);
  }, [tab]);

  return (
    <div className="soft-enter" data-testid="dev-panel">
      <div className="mb-5">
        <div className="eyebrow">ADMINISTRAÇÃO · DESENVOLVIMENTO</div>
        <h1 className="mt-2 text-[28px] font-bold tracking-[-.045em] sm:text-[34px]">Painel técnico</h1>
        <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
          Saúde do sistema, deploy, serviços, requisições da API, erros, integração com o ERP e banco de dados. Só administradores veem esta página.
        </p>
      </div>

      <div className="mb-6 overflow-x-auto" role="tablist" aria-label="Seções do painel técnico">
        <div className="flex min-w-max gap-1 rounded-lg border border-border bg-white p-1">
          {tabs.map((item) => (
            <button
              key={item.id}
              type="button"
              role="tab"
              id={`tab-${item.id}`}
              aria-selected={tab === item.id}
              aria-controls={`panel-${item.id}`}
              onClick={() => setTab(item.id)}
              className={`h-9 rounded-md px-3.5 text-sm font-semibold transition-colors ${tab === item.id ? "bg-[var(--adm-primary)] text-white" : "text-[#4a4d52] hover:bg-[#f4f3f1]"}`}
              data-testid={`tab-${item.id}`}
            >
              {item.label}
            </button>
          ))}
        </div>
      </div>

      <div role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`}>
        {tab === "visao-geral" && <OverviewTab onOpen={setTab} />}
        {tab === "requisicoes" && <RequestsTab />}
        {tab === "erros" && <ErrorsTab />}
        {tab === "erp" && <ErpIntegration embedded />}
        {tab === "banco" && <DatabaseTab />}
        {tab === "referencia" && <ReferenceTab />}
      </div>
    </div>
  );
}

function OverviewTab({ onOpen }: { onOpen: (tab: TabId) => void }) {
  const overview = useGetDevOverview({ query: { queryKey: getGetDevOverviewQueryKey(), ...live } });
  const o = overview.data;
  if (overview.isLoading) return <p className="text-sm text-muted-foreground">Carregando…</p>;
  if (overview.isError || !o) return <p className="text-sm text-[var(--adm-primary)]">Não foi possível carregar o painel técnico.</p>;
  const missing = o.services.filter((service) => !service.configured);
  const shortSha = o.commitSha?.slice(0, 7) ?? null;
  return (
    <>
      <Section
        id="dev-health"
        eyebrow="AGORA"
        title="Saúde do sistema"
        aside={
          <button type="button" className="button-secondary h-9 px-3" onClick={() => void overview.refetch()}>
            <RefreshCw size={15} />
            Atualizar
          </button>
        }
      >
        <div className="mb-4 flex flex-wrap gap-2">
          <span data-testid="dev-api-status"><StatusPill tone="success">API respondendo</StatusPill></span>
          {o.databaseOk ? <StatusPill tone="success">Banco conectado · {ms(o.databaseLatencyMs)}</StatusPill> : <StatusPill tone="danger">Banco sem conexão</StatusPill>}
          {missing.length > 0 ? (
            <StatusPill tone="warning">{missing.length} serviço(s) sem configuração</StatusPill>
          ) : (
            <StatusPill tone="success">Todos os serviços configurados</StatusPill>
          )}
          {o.last24h.errors5xx > 0 && <StatusPill tone="danger">{o.last24h.errors5xx} erro(s) 5xx nas últimas 24 h</StatusPill>}
        </div>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <button type="button" className="text-left" onClick={() => onOpen("requisicoes")} title="Ver requisições">
            <Tile label="Requisições (24 h)" value={number(o.last24h.requests)} hint={`Média ${ms(o.last24h.avgMs)}`} />
          </button>
          <button type="button" className="text-left" onClick={() => onOpen("erros")} title="Ver erros">
            <Tile label="Erros 5xx (24 h)" value={number(o.last24h.errors5xx)} tone={o.last24h.errors5xx ? "danger" : "default"} hint={percent(o.last24h.errors5xx, o.last24h.requests)} />
          </button>
          <button type="button" className="text-left" onClick={() => onOpen("erros")} title="Ver erros">
            <Tile label="Erros 4xx (24 h)" value={number(o.last24h.errors4xx)} hint="Validação, permissão, não encontrado" />
          </button>
          <Tile label="Mais lenta (24 h)" value={ms(o.last24h.maxMs)} hint="Maior tempo de resposta" />
        </div>
      </Section>

      <Section id="dev-deploy" eyebrow="DEPLOY" title="Versão no ar">
        <KeyValue
          items={[
            { label: "Ambiente", value: <span className="uppercase">{o.environment}</span> },
            {
              label: "Commit",
              value: shortSha ? (
                o.repoUrl ? (
                  <a className="inline-flex items-center gap-1 font-mono text-[var(--adm-primary)] hover:underline" href={`${o.repoUrl}/commit/${o.commitSha}`} target="_blank" rel="noreferrer">
                    <GitCommitHorizontal size={14} aria-hidden="true" />
                    {shortSha}
                  </a>
                ) : (
                  <span className="font-mono">{shortSha}</span>
                )
              ) : (
                "Local (sem deploy)"
              ),
            },
            { label: "Branch", value: o.commitRef ?? "—" },
            { label: "Mensagem do commit", value: o.commitMessage ?? "—" },
            { label: "Região", value: o.region ?? "—" },
            { label: "Node.js", value: o.nodeVersion },
            { label: "Instância iniciada", value: `${dateTime(o.instanceStartedAt)} (há ${duration(o.instanceStartedAt, o.serverTime)})` },
            { label: "Hora do servidor", value: `${dateTime(o.serverTime)} · ${o.timezone}` },
            {
              label: "URL do deploy",
              value: o.deploymentUrl ? (
                <a className="text-[var(--adm-primary)] hover:underline" href={o.deploymentUrl} target="_blank" rel="noreferrer">{o.deploymentUrl.replace(/^https:\/\//, "")}</a>
              ) : (
                "—"
              ),
            },
          ]}
        />
        <p className="mt-3 text-xs text-muted-foreground">Na Vercel cada instância da API é uma função que liga e desliga sozinha; "instância iniciada" é desta função.</p>
      </Section>

      <Section id="dev-services" eyebrow="CONFIGURAÇÃO" title="Serviços e variáveis de ambiente">
        <ul className="divide-y divide-[#f0efed] rounded-lg border border-border">
          {o.services.map((service) => (
            <li key={service.key} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2.5" data-testid={`dev-service-${service.key}`}>
              <span className="min-w-0">
                <span className="block text-sm font-semibold text-[#24272d]">{service.label}</span>
                <span className="block text-xs text-muted-foreground">{service.detail}</span>
              </span>
              {service.configured ? <StatusPill tone="success">Configurado</StatusPill> : <StatusPill tone="warning">Não configurado</StatusPill>}
            </li>
          ))}
        </ul>
        <p className="mt-3 text-xs text-muted-foreground">Os valores das chaves nunca saem do servidor. Para mudar, edite as variáveis de ambiente do projeto na Vercel e faça um novo deploy.</p>
      </Section>

      <Section id="dev-counts" eyebrow="DADOS" title="Números do sistema">
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
          <Tile label="Entregas (total)" value={number(o.counts.deliveriesTotal)} hint={`${number(o.counts.deliveriesFromErp)} vindas do ERP`} />
          <Tile label="Entregas hoje" value={number(o.counts.deliveriesToday)} />
          <Tile label="Em andamento" value={number(o.counts.deliveriesActive)} />
          <Tile label="Motoboys" value={number(o.counts.couriersTotal)} hint={`${number(o.counts.couriersOnline)} online agora`} />
          <Tile label="Filiais ativas" value={number(o.counts.stores)} />
          <Tile label="Contas" value={number(o.counts.users)} hint={o.counts.pendingUsers ? `${o.counts.pendingUsers} aguardando aprovação` : "Nenhuma pendente"} />
          <Tile label="Aparelhos com aviso (PWA)" value={number(o.counts.pushSubscriptions)} />
          <Tile label="Apps Android com aviso" value={number(o.counts.nativeTokens)} />
          <Tile label="Credenciais ERP ativas" value={number(o.counts.erpCredentialsActive)} />
        </div>
      </Section>
    </>
  );
}

/** Barras de requisições por período (uma série; erros aparecem no detalhe de cada barra). */
function RequestsChart({ stats }: { stats: DevRequestStats }) {
  const [hover, setHover] = useState<number | null>(null);
  const daily = stats.hours > 48;
  const points = useMemo(() => {
    if (!daily) return stats.hourly.map((item) => ({ ...item, label: new Date(item.hour).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }) }));
    const byDay = new Map<string, { hour: string; requests: number; errors: number; label: string }>();
    for (const item of stats.hourly) {
      const key = new Date(item.hour).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
      const current = byDay.get(key) ?? { hour: item.hour, requests: 0, errors: 0, label: key };
      current.requests += item.requests;
      current.errors += item.errors;
      byDay.set(key, current);
    }
    return [...byDay.values()];
  }, [stats, daily]);
  const max = Math.max(1, ...points.map((point) => point.requests));
  const active = hover == null ? null : points[hover];
  const step = Math.max(1, Math.ceil(points.length / 8));
  return (
    <figure className="m-0">
      <figcaption className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
        <span className="text-sm font-semibold text-[#24272d]">Requisições por {daily ? "dia" : "hora"}</span>
        <span className="min-h-[18px] text-xs text-muted-foreground" aria-live="polite">
          {active ? `${active.label}: ${number(active.requests)} requisições · ${number(active.errors)} com erro` : `Máximo ${number(max)} por ${daily ? "dia" : "hora"}`}
        </span>
      </figcaption>
      <div className="relative h-40 border-b border-[#e7e6e3]" onMouseLeave={() => setHover(null)}>
        <div className="absolute inset-x-0 top-0 border-t border-dashed border-[#efeeec]" aria-hidden="true" />
        <div className="absolute inset-x-0 top-1/2 border-t border-dashed border-[#efeeec]" aria-hidden="true" />
        <div className="relative flex h-full items-end gap-[2px]">
          {points.map((point, index) => (
            <button
              key={point.hour}
              type="button"
              className="group relative flex h-full min-w-0 flex-1 items-end focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#1f2329]"
              onMouseEnter={() => setHover(index)}
              onFocus={() => setHover(index)}
              aria-label={`${point.label}: ${point.requests} requisições, ${point.errors} com erro`}
            >
              <span
                className={`block w-full rounded-t-[4px] transition-opacity ${hover == null || hover === index ? "opacity-100" : "opacity-45"}`}
                style={{ height: `${point.requests ? Math.max(2, (point.requests / max) * 100) : 0}%`, background: "var(--adm-primary)" }}
              />
            </button>
          ))}
        </div>
      </div>
      <div className="mt-1 flex text-[10px] text-muted-foreground" aria-hidden="true">
        {points.map((point, index) => (
          <span key={point.hour} className="min-w-0 flex-1 overflow-visible whitespace-nowrap">
            {index % step === 0 ? point.label : ""}
          </span>
        ))}
      </div>
    </figure>
  );
}

function RequestsTab() {
  const [hours, setHours] = useState(24);
  const [filter, setFilter] = useState("");
  const params = { hours };
  const stats = useGetDevRequestStats(params, { query: { queryKey: getGetDevRequestStatsQueryKey(params), ...live } });
  const s = stats.data;
  const routes = (s?.routes ?? []).filter((route) => !filter.trim() || `${route.method} ${route.route}`.toLowerCase().includes(filter.trim().toLowerCase()));
  return (
    <>
      <Section
        id="dev-requests"
        eyebrow="API"
        title="Requisições"
        aside={
          <div className="flex gap-2">
            <label className="sr-only" htmlFor="dev-hours">Período</label>
            <select id="dev-hours" className="h-9 text-sm" value={hours} onChange={(event) => setHours(Number(event.target.value))} data-testid="select-dev-hours">
              <option value={1}>Última hora</option>
              <option value={24}>Últimas 24 horas</option>
              <option value={168}>Últimos 7 dias</option>
              <option value={720}>Últimos 30 dias</option>
            </select>
            <button type="button" className="button-secondary h-9 px-3" onClick={() => void stats.refetch()} aria-label="Atualizar requisições">
              <RefreshCw size={15} />
            </button>
          </div>
        }
      >
        {stats.isLoading && <p className="text-sm text-muted-foreground">Carregando…</p>}
        {stats.isError && <p className="text-sm text-[var(--adm-primary)]">Não foi possível carregar as métricas.</p>}
        {s && (
          <>
            <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-5">
              <Tile label="Requisições" value={number(s.totals.requests)} />
              <Tile label="Erros 4xx" value={number(s.totals.errors4xx)} hint={percent(s.totals.errors4xx, s.totals.requests)} />
              <Tile label="Erros 5xx" value={number(s.totals.errors5xx)} hint={percent(s.totals.errors5xx, s.totals.requests)} tone={s.totals.errors5xx ? "danger" : "default"} />
              <Tile label="Tempo médio" value={ms(s.totals.avgMs)} />
              <Tile label="Mais lenta" value={ms(s.totals.maxMs)} />
            </div>
            <RequestsChart stats={s} />
          </>
        )}
      </Section>

      <Section id="dev-routes" eyebrow="POR ENDPOINT" title="Rotas mais chamadas">
        <div className="relative mb-3 max-w-md">
          <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
          <label className="sr-only" htmlFor="dev-route-filter">Filtrar rotas</label>
          <input id="dev-route-filter" className="w-full !pl-9" value={filter} onChange={(event) => setFilter(event.target.value)} placeholder="Filtrar por rota ou método (ex.: erp, POST)" />
        </div>
        <div className="relative overflow-x-auto">
          <table className="delivery-table w-full min-w-[820px]">
            <thead>
              <tr>
                <th>Rota</th>
                <th className="text-right">Requisições</th>
                <th className="text-right">4xx</th>
                <th className="text-right">5xx</th>
                <th className="text-right">Taxa de erro</th>
                <th className="text-right">Médio</th>
                <th className="text-right">Máximo</th>
              </tr>
            </thead>
            <tbody>
              {s && routes.length === 0 && <tr><td colSpan={7} className="text-muted-foreground">Nenhuma requisição no período.</td></tr>}
              {routes.map((route) => (
                <tr key={`${route.method} ${route.route}`} data-testid="dev-route-row">
                  <td className="whitespace-nowrap font-mono text-xs">
                    <span className="mr-2 inline-block w-14 font-bold text-[#4a4d52]">{route.method}</span>
                    {route.route}
                  </td>
                  <td className="text-right tabular-nums">{number(route.requests)}</td>
                  <td className="text-right tabular-nums">{number(route.errors4xx)}</td>
                  <td className={`text-right tabular-nums ${route.errors5xx ? "font-semibold text-[var(--adm-primary)]" : ""}`}>{number(route.errors5xx)}</td>
                  <td className="text-right tabular-nums">{percent(route.errors4xx + route.errors5xx, route.requests)}</td>
                  <td className="text-right tabular-nums">{ms(route.avgMs)}</td>
                  <td className={`text-right tabular-nums ${route.maxMs > 3000 ? "font-semibold text-[#9a5b00]" : ""}`}>{ms(route.maxMs)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-3 text-xs text-muted-foreground">
          Contagem por rota (com os parâmetros no formato <code>:id</code>), somada por hora. As métricas ficam guardadas por 30 dias. Não guardamos corpo, parâmetros nem tokens das requisições.
        </p>
      </Section>
    </>
  );
}

function ErrorsTab() {
  const [status, setStatus] = useState<ListDevApiErrorsStatus>("ALL");
  const [searchText, setSearchText] = useState("");
  const [query, setQuery] = useState("");
  const params = { status, q: query || undefined, limit: 200 };
  const errors = useListDevApiErrors(params, { query: { queryKey: getListDevApiErrorsQueryKey(params), ...live } });
  const rows = errors.data ?? [];
  return (
    <Section id="dev-errors" eyebrow="API" title="Erros recentes">
      <div className="mb-4 flex flex-col gap-2 sm:flex-row">
        <form
          className="relative flex-1"
          onSubmit={(event) => {
            event.preventDefault();
            setQuery(searchText.trim());
          }}
        >
          <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
          <label className="sr-only" htmlFor="dev-error-search">Buscar erro</label>
          <input id="dev-error-search" className="w-full !pl-9" value={searchText} onChange={(event) => setSearchText(event.target.value)} placeholder="Buscar por rota, caminho, mensagem ou ID da requisição" />
        </form>
        <label className="sr-only" htmlFor="dev-error-status">Tipo de erro</label>
        <select id="dev-error-status" className="h-10 text-sm sm:w-48" value={status} onChange={(event) => setStatus(event.target.value as ListDevApiErrorsStatus)} data-testid="select-dev-error-status">
          <option value="ALL">Todos (4xx e 5xx)</option>
          <option value="5XX">Só 5xx (falhas)</option>
          <option value="4XX">Só 4xx (recusas)</option>
        </select>
      </div>
      <div className="relative overflow-x-auto">
        <table className="delivery-table w-full min-w-[960px]">
          <thead>
            <tr>
              <th>Quando</th>
              <th>Status</th>
              <th>Rota</th>
              <th>Mensagem</th>
              <th className="text-right">Tempo</th>
              <th>Perfil</th>
              <th>Requisição</th>
            </tr>
          </thead>
          <tbody>
            {errors.isLoading && <tr><td colSpan={7} className="text-muted-foreground">Carregando…</td></tr>}
            {!errors.isLoading && rows.length === 0 && <tr><td colSpan={7} className="text-muted-foreground">Nenhum erro registrado. Ótimo sinal.</td></tr>}
            {rows.map((row) => (
              <tr key={row.id} data-testid="dev-error-row">
                <td className="whitespace-nowrap text-xs">{dateTime(row.createdAt)}</td>
                <td><StatusPill tone={statusTone(row.status)}>{row.status}</StatusPill></td>
                <td className="font-mono text-xs">
                  <span className="font-bold">{row.method}</span> {row.route}
                  {row.path !== row.route && <span className="block max-w-[260px] truncate text-muted-foreground" title={row.path}>{row.path}</span>}
                </td>
                <td className="max-w-[320px] text-xs">{row.message ?? <span className="text-muted-foreground">—</span>}</td>
                <td className="whitespace-nowrap text-right text-xs tabular-nums">{ms(row.durationMs)}</td>
                <td className="text-xs">{row.role ?? "—"}</td>
                <td className="whitespace-nowrap font-mono text-[11px]">
                  {row.requestId ? (
                    <span className="inline-flex items-center gap-1">
                      {row.requestId.slice(0, 8)}…
                      <CopyInline text={row.requestId} />
                    </span>
                  ) : (
                    "—"
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-3 text-xs text-muted-foreground">
        Guardamos 4xx (menos 401 de sessão expirada) e 5xx por 14 dias, com a mensagem devolvida. O ID da requisição aparece nos logs da Vercel e, na API do ERP, no campo <code>requestId</code>.
      </p>
    </Section>
  );
}

function DatabaseTab() {
  const info = useGetDevDatabaseInfo({ query: { queryKey: getGetDevDatabaseInfoQueryKey(), ...live } });
  const d = info.data;
  if (info.isLoading) return <p className="text-sm text-muted-foreground">Carregando…</p>;
  if (info.isError || !d) return <p className="text-sm text-[var(--adm-primary)]">Não foi possível ler o banco de dados.</p>;
  return (
    <>
      <Section id="dev-db" eyebrow="POSTGRES" title="Banco de dados">
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Tile label="Conexão" value={d.ok ? "OK" : "Falhou"} tone={d.ok ? "success" : "danger"} hint={`Latência ${ms(d.latencyMs)}`} />
          <Tile label="Versão" value={d.version ?? "—"} />
          <Tile label="Tamanho" value={bytes(d.sizeBytes)} />
          <Tile label="Conexões desta instância" value={`${d.pool.total}/${d.pool.max}`} hint={`${d.pool.idle} livres · ${d.pool.waiting} esperando`} />
        </div>
      </Section>
      <Section id="dev-tables" eyebrow="TABELAS" title="Tabelas">
        <div className="relative overflow-x-auto">
          <table className="delivery-table w-full min-w-[520px]">
            <thead>
              <tr>
                <th>Tabela</th>
                <th className="text-right">Linhas (aprox.)</th>
                <th className="text-right">Tamanho</th>
              </tr>
            </thead>
            <tbody>
              {d.tables.map((table) => (
                <tr key={table.name} data-testid="dev-table-row">
                  <td className="font-mono text-xs">{table.name}</td>
                  <td className="text-right tabular-nums">{number(table.rows)}</td>
                  <td className="text-right tabular-nums">{bytes(table.sizeBytes)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-3 text-xs text-muted-foreground">Linhas estimadas pelas estatísticas do Postgres. Migrações ficam em <code>scripts/migrations/</code> e rodam com <code>node scripts/run-sql.mjs &lt;arquivo&gt; --env .env.vercel</code>.</p>
      </Section>
    </>
  );
}

function ReferenceTab() {
  const overview = useGetDevOverview({ query: { queryKey: getGetDevOverviewQueryKey(), ...live } });
  const origin = window.location.origin;
  const repo = overview.data?.repoUrl ?? "https://github.com/minasmaissuporte-afk/minasmais_entregas";
  const endpoints = [
    { label: "Painel (web)", value: origin },
    { label: "API interna (painel e app)", value: `${origin}/api` },
    { label: "Saúde da API", value: `${origin}/api/healthz` },
    { label: "API do ERP", value: `${origin}/api/v1/erp` },
    { label: "Saúde da API do ERP", value: `${origin}/api/v1/erp/health` },
    { label: "PWA do motoboy", value: `${origin}/motoboy-pwa` },
  ];
  const links = [
    { label: "Swagger da API do ERP", href: `${origin}/api/v1/erp/docs`, icon: BookOpen },
    { label: "OpenAPI do ERP (JSON)", href: `${origin}/api/v1/erp/openapi.json`, icon: BookOpen },
    { label: "Repositório no GitHub", href: repo, icon: GitCommitHorizontal },
    { label: "Deploys e variáveis (Vercel)", href: "https://vercel.com/dashboard", icon: Server },
    { label: "Banco e login (Supabase)", href: "https://supabase.com/dashboard/projects", icon: Database },
  ];
  const commands = [
    { label: "Subir o banco local", cmd: "pnpm db:start" },
    { label: "API local (porta 8080)", cmd: "pnpm dev:api" },
    { label: "Painel local (porta 5173)", cmd: "pnpm dev:web" },
    { label: "Conferir tipos", cmd: "pnpm run typecheck" },
    { label: "Gerar cliente da API depois de mudar o openapi.yaml", cmd: "pnpm --filter @workspace/api-spec run codegen" },
    { label: "Testes E2E", cmd: "cd e2e && npx playwright test" },
    { label: "Rodar uma migração em produção", cmd: "node scripts/run-sql.mjs scripts/migrations/<arquivo>.sql --env .env.vercel" },
  ];
  return (
    <>
      <Section id="dev-endpoints" eyebrow="ENDEREÇOS" title="Endpoints">
        <ul className="divide-y divide-[#f0efed] rounded-lg border border-border">
          {endpoints.map((item) => (
            <li key={item.label} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
              <span className="text-sm font-semibold text-[#24272d]">{item.label}</span>
              <span className="flex min-w-0 items-center gap-1">
                <code className="break-all text-xs">{item.value}</code>
                <CopyInline text={item.value} />
              </span>
            </li>
          ))}
        </ul>
      </Section>
      <Section id="dev-links" eyebrow="ATALHOS" title="Documentação e serviços">
        <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
          {links.map((link) => (
            <a key={link.label} href={link.href} target="_blank" rel="noreferrer" className="flex items-center gap-2 rounded-lg border border-border bg-white px-3 py-2.5 text-sm font-semibold text-[#24272d] hover:border-[#d9b6b8]">
              <link.icon size={16} className="text-[var(--adm-primary)]" aria-hidden="true" />
              <span className="flex-1">{link.label}</span>
              <ExternalLink size={13} className="text-muted-foreground" aria-hidden="true" />
            </a>
          ))}
        </div>
      </Section>
      <Section id="dev-commands" eyebrow="DESENVOLVIMENTO" title="Comandos úteis">
        <ul className="space-y-2">
          {commands.map((item) => (
            <li key={item.cmd} className="rounded-lg border border-border bg-[#faf9f7] px-3 py-2">
              <span className="block text-xs text-muted-foreground">{item.label}</span>
              <span className="flex items-center justify-between gap-2">
                <code className="break-all text-[13px] font-semibold text-[#24272d]">{item.cmd}</code>
                <CopyInline text={item.cmd} />
              </span>
            </li>
          ))}
        </ul>
      </Section>
      <Section id="dev-notes" eyebrow="REGRAS" title="Boas práticas do projeto">
        <ul className="list-disc space-y-1.5 pl-5 text-sm text-[#2b2e33]">
          <li>Deploy automático: todo merge na <code>main</code> publica na Vercel.</li>
          <li>Migração de banco <strong>antes</strong> do deploy que usa as colunas novas. As migrações só adicionam e podem rodar mais de uma vez.</li>
          <li>Nunca commitar <code>.env</code>, <code>.env.vercel</code>, chaves ou a pasta <code>.local/</code> (assinatura do APK).</li>
          <li>Os testes E2E só rodam com banco local (o script recusa banco remoto).</li>
          <li>Tokens do ERP aparecem uma única vez; o banco guarda só o hash.</li>
        </ul>
        <p className="mt-3 flex items-center gap-1.5 text-xs text-muted-foreground">
          <TriangleAlert size={13} aria-hidden="true" />
          Esta página é só para administradores. Os dados técnicos não aparecem para a central, as filiais ou os motoboys.
        </p>
      </Section>
    </>
  );
}
