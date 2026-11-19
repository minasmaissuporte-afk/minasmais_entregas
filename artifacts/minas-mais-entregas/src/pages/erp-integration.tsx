import { Fragment, useEffect, useState, type FormEvent } from "react";
import { Link } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import {
  getGetErpIntegrationSummaryQueryKey,
  getListErpCredentialsQueryKey,
  getListErpIntegrationEventsQueryKey,
  getListErpStoreMappingsQueryKey,
  useCreateErpCredential,
  useGetErpIntegrationSummary,
  useListErpCredentials,
  useListErpIntegrationEvents,
  useListErpStoreMappings,
  useReprocessErpIntegrationEvent,
  useRevokeErpCredential,
  useUpdateErpStoreMapping,
  type ErpIntegrationEvent,
  type ErpStoreMapping,
  type ListErpIntegrationEventsOutcome,
} from "@workspace/api-client-react";
import {
  ArrowDown,
  BookOpen,
  Box,
  Check,
  Copy,
  ExternalLink,
  KeyRound,
  CloudUpload,
  RefreshCw,
  RotateCcw,
  Search,
  ShoppingCart,
  Bike,
  TriangleAlert,
} from "lucide-react";
import { AutoDismissFeedback } from "@/components/auto-dismiss-feedback";
import { StatusPill, type PillTone } from "@/components/admin/admin-ui";

type Feedback = { kind: "success" | "error"; text: string } | null;

function errorMessage(error: unknown, fallback: string) {
  const apiError = error as Error & { data?: { error?: string } };
  return apiError.data?.error ?? (error instanceof Error ? error.message : fallback);
}

const dateTime = (value: string | null | undefined) =>
  value
    ? new Date(value).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" })
    : "—";

const brl = (value: number) => value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

const operationLabel: Record<string, string> = {
  CREATE: "Nova venda",
  UPDATE: "Atualização",
  CANCEL: "Cancelamento",
  QUERY: "Consulta",
  AUTH: "Acesso negado",
};

const outcomeView: Record<string, { tone: PillTone; label: string }> = {
  CREATED: { tone: "success", label: "Cadastrada" },
  DUPLICATE: { tone: "neutral", label: "Duplicada" },
  UPDATED: { tone: "info", label: "Atualizada" },
  CANCELLED: { tone: "warning", label: "Cancelada" },
  OK: { tone: "neutral", label: "OK" },
  FAILED: { tone: "danger", label: "Erro" },
};

async function copyText(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

function CopyButton({ text, label }: { text: string; label: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className="button-secondary h-9 shrink-0 px-3"
      onClick={async () => {
        if (await copyText(text)) {
          setCopied(true);
          window.setTimeout(() => setCopied(false), 2000);
        }
      }}
      aria-label={label}
    >
      {copied ? <Check size={15} /> : <Copy size={15} />}
      {copied ? "Copiado" : "Copiar"}
    </button>
  );
}

const steps = [
  { icon: ShoppingCart, title: "Venda realizada no ERP", detail: "Marcada como pedido para entrega" },
  { icon: CloudUpload, title: "ERP envia os dados pela API", detail: "Autenticação e validação automáticas" },
  { icon: Box, title: "Entrega cadastrada automaticamente", detail: "Na filial do código informado pelo ERP" },
  { icon: Bike, title: "Central encaminha ao motoboy", detail: "Segue o fluxo normal do aplicativo" },
];

export default function ErpIntegration() {
  const qc = useQueryClient();
  const [feedback, setFeedback] = useState<Feedback>(null);
  const live = { refetchInterval: 15_000, refetchOnWindowFocus: true };
  const summary = useGetErpIntegrationSummary({ query: { queryKey: getGetErpIntegrationSummaryQueryKey(), ...live } });
  const s = summary.data;

  const refreshAll = () =>
    Promise.all([
      qc.invalidateQueries({ queryKey: getGetErpIntegrationSummaryQueryKey() }),
      qc.invalidateQueries({ queryKey: getListErpCredentialsQueryKey() }),
      qc.invalidateQueries({ queryKey: getListErpStoreMappingsQueryKey() }),
      qc.invalidateQueries({ queryKey: getListErpIntegrationEventsQueryKey().slice(0, 1) }),
    ]);

  const [outcome, setOutcome] = useState<ListErpIntegrationEventsOutcome>("ALL");

  return (
    <div className="soft-enter" data-testid="erp-integration-page">
      <div className="mb-6 flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
        <div>
          <div className="eyebrow">ADMINISTRAÇÃO</div>
          <h1 className="mt-2 text-[28px] font-bold tracking-[-.045em] sm:text-[34px]">Integração ERP</h1>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            As vendas marcadas para entrega no ERP chegam sozinhas na central da filial, sem digitar nada.
          </p>
        </div>
        {s && (
          <a className="button-secondary h-10" href={s.docsUrl} target="_blank" rel="noreferrer" data-testid="link-erp-docs">
            <BookOpen size={16} />
            Documentação da API
            <ExternalLink size={13} aria-hidden="true" />
          </a>
        )}
      </div>

      {feedback && <AutoDismissFeedback feedback={feedback} onDismiss={() => setFeedback(null)} className="mb-4" />}

      {/* Situação da integração */}
      <section className="panel mb-6 p-4 sm:p-6" aria-labelledby="erp-status-title">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-3">
            <h2 id="erp-status-title" className="text-lg font-bold">Situação</h2>
            {summary.isLoading ? (
              <StatusPill tone="neutral">Verificando…</StatusPill>
            ) : summary.isError || !s?.operational ? (
              <StatusPill tone="danger">Indisponível</StatusPill>
            ) : (
              <span data-testid="erp-status-operational"><StatusPill tone="success">API operacional</StatusPill></span>
            )}
            {s && s.activeCredentials === 0 && <StatusPill tone="warning">Sem credencial ativa</StatusPill>}
            {s && s.storesMapped < s.storesActive && (
              <StatusPill tone="warning">{s.storesActive - s.storesMapped} filial(is) sem código do ERP</StatusPill>
            )}
          </div>
          <button type="button" className="button-secondary h-9 px-3" onClick={() => void refreshAll()}>
            <RefreshCw size={15} />
            Atualizar
          </button>
        </div>

        {s && (
          <div className="mt-4 flex flex-col gap-2 rounded-lg border border-border bg-[#faf9f7] p-3 sm:flex-row sm:items-center">
            <div className="min-w-0 flex-1">
              <span className="block text-[11px] font-semibold uppercase tracking-[.08em] text-muted-foreground">Endereço da API (URL base)</span>
              <code className="block break-all text-sm font-semibold text-[#24272d]" data-testid="text-erp-base-url">{s.baseUrl}</code>
            </div>
            <CopyButton text={s.baseUrl} label="Copiar endereço da API" />
          </div>
        )}

        <div className="mt-4 grid grid-cols-2 gap-3 lg:grid-cols-5">
          {[
            { label: "Recebidas (24h)", value: s?.last24h.received, filter: "ALL" as const },
            { label: "Cadastradas", value: s?.last24h.created, filter: "CREATED" as const },
            { label: "Duplicadas", value: s?.last24h.duplicates, filter: "DUPLICATE" as const },
            { label: "Canceladas", value: s?.last24h.cancelled, filter: "CANCELLED" as const },
            { label: "Com erro", value: s?.last24h.failed, filter: "FAILED" as const, danger: true },
          ].map((item) => (
            <button
              key={item.label}
              type="button"
              onClick={() => {
                setOutcome(item.filter);
                document.getElementById("erp-historico")?.scrollIntoView({ behavior: "smooth", block: "start" });
              }}
              className={`rounded-lg border bg-white px-3 py-2.5 text-left transition-colors hover:border-[#d9b6b8] ${item.danger && (item.value ?? 0) > 0 ? "border-[#f0ccd1]" : "border-border"}`}
              title={`Ver no histórico: ${item.label.toLowerCase()}`}
            >
              <span className="block text-[12px] font-medium text-muted-foreground">{item.label}</span>
              <strong className={`mt-0.5 block text-2xl font-semibold tabular-nums ${item.danger && (item.value ?? 0) > 0 ? "text-[var(--adm-primary)]" : "text-[#24272d]"}`}>
                {summary.isLoading ? "…" : item.value ?? 0}
              </strong>
            </button>
          ))}
        </div>
        {s && (
          <p className="mt-3 text-xs text-muted-foreground">
            Última venda recebida: {dateTime(s.lastReceivedAt)} · Último erro: {dateTime(s.lastFailureAt)} · Filiais vinculadas: {s.storesMapped} de {s.storesActive}
          </p>
        )}

        <ol className="mt-5 grid gap-2 sm:grid-cols-2 xl:grid-cols-4" aria-label="Como a venda chega na central">
          {steps.map((step, index) => (
            <li key={step.title} className="relative flex items-start gap-3 rounded-lg border border-border bg-white p-3">
              <step.icon size={18} className="mt-0.5 shrink-0 text-[var(--adm-primary)]" aria-hidden="true" />
              <span className="min-w-0">
                <span className="block text-sm font-semibold text-[#24272d]">{index + 1}. {step.title}</span>
                <span className="block text-xs text-muted-foreground">{step.detail}</span>
              </span>
              {index < steps.length - 1 && <ArrowDown size={14} className="absolute -bottom-[11px] left-5 text-muted-foreground sm:hidden" aria-hidden="true" />}
            </li>
          ))}
        </ol>
      </section>

      <CredentialsSection onFeedback={setFeedback} onChanged={refreshAll} />
      <StoreCodesSection onFeedback={setFeedback} onChanged={refreshAll} />
      <EventsSection outcome={outcome} setOutcome={setOutcome} onFeedback={setFeedback} onChanged={refreshAll} />
    </div>
  );
}

function CredentialsSection({ onFeedback, onChanged }: { onFeedback: (f: Feedback) => void; onChanged: () => Promise<unknown> }) {
  const credentials = useListErpCredentials();
  const create = useCreateErpCredential();
  const revoke = useRevokeErpCredential();
  const [name, setName] = useState("ERP produção");
  const [newToken, setNewToken] = useState<{ name: string; token: string } | null>(null);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    onFeedback(null);
    create.mutate(
      { data: { name: name.trim() } },
      {
        onSuccess: async (result) => {
          setNewToken({ name: result.credential.name, token: result.token });
          await onChanged();
        },
        onError: (error) => onFeedback({ kind: "error", text: errorMessage(error, "Não foi possível gerar a credencial.") }),
      },
    );
  };

  const revokeCredential = (id: string, credentialName: string) => {
    if (!window.confirm(`Revogar a credencial “${credentialName}”? O ERP que usa este token para de conseguir enviar vendas na hora.`)) return;
    onFeedback(null);
    revoke.mutate(
      { credentialId: id },
      {
        onSuccess: async () => {
          onFeedback({ kind: "success", text: `Credencial “${credentialName}” revogada.` });
          await onChanged();
        },
        onError: (error) => onFeedback({ kind: "error", text: errorMessage(error, "Não foi possível revogar a credencial.") }),
      },
    );
  };

  const rows = credentials.data ?? [];
  return (
    <section className="panel mb-6 p-4 sm:p-6" aria-labelledby="erp-credentials-title">
      <div className="eyebrow">ACESSO DO ERP</div>
      <h2 id="erp-credentials-title" className="mt-1 text-lg font-bold">Credenciais</h2>
      <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
        O token é a senha do ERP para enviar vendas. Ele aparece uma única vez: copie e entregue ao suporte do ERP por um canal seguro.
        Para trocar, gere um novo, configure no ERP e depois revogue o antigo.
      </p>

      <form onSubmit={submit} className="mt-4 flex flex-col gap-2 sm:flex-row sm:items-end">
        <label className="field-label flex-1">
          Nome da credencial
          <input value={name} onChange={(event) => setName(event.target.value)} minLength={2} maxLength={80} required placeholder="Ex.: ERP produção" data-testid="input-erp-credential-name" />
        </label>
        <button className="button-primary h-10" type="submit" disabled={create.isPending} data-testid="button-erp-create-credential">
          <KeyRound size={16} />
          {create.isPending ? "Gerando…" : "Gerar credencial"}
        </button>
      </form>

      {newToken && (
        <div className="mt-4 rounded-lg border border-[#e7c58a] bg-[#fff8eb] p-3" role="alert" data-testid="erp-new-token">
          <p className="flex items-center gap-2 text-sm font-semibold text-[#7a4b00]">
            <TriangleAlert size={16} aria-hidden="true" />
            Copie o token de “{newToken.name}” agora. Ele não será mostrado de novo.
          </p>
          <div className="mt-2 flex flex-col gap-2 sm:flex-row sm:items-center">
            <code className="min-w-0 flex-1 break-all rounded-md bg-white px-3 py-2 text-[13px] font-semibold text-[#24272d]" data-testid="text-erp-token">{newToken.token}</code>
            <CopyButton text={newToken.token} label="Copiar token" />
            <button type="button" className="button-secondary h-9 px-3" onClick={() => setNewToken(null)}>Já copiei</button>
          </div>
        </div>
      )}

      <div className="relative mt-4 overflow-x-auto">
        <table className="delivery-table w-full min-w-[720px]">
          <thead>
            <tr>
              <th>Nome</th>
              <th>Identificação</th>
              <th>Criada</th>
              <th>Último uso</th>
              <th>Situação</th>
              <th><span className="sr-only">Ação</span></th>
            </tr>
          </thead>
          <tbody>
            {credentials.isLoading && (
              <tr><td colSpan={6} className="text-muted-foreground">Carregando…</td></tr>
            )}
            {!credentials.isLoading && rows.length === 0 && (
              <tr><td colSpan={6} className="text-muted-foreground">Nenhuma credencial ainda. Gere a primeira para o ERP.</td></tr>
            )}
            {rows.map((credential) => (
              <tr key={credential.id} data-testid={`erp-credential-${credential.id}`}>
                <td className="font-semibold">{credential.name}</td>
                <td><code className="text-xs">{credential.keyPrefix}</code></td>
                <td className="text-sm">{dateTime(credential.createdAt)}<span className="block text-xs text-muted-foreground">{credential.createdBy ?? ""}</span></td>
                <td className="text-sm">{dateTime(credential.lastUsedAt)}</td>
                <td>
                  {credential.revokedAt ? (
                    <span title={`Revogada por ${credential.revokedBy ?? "—"} em ${dateTime(credential.revokedAt)}`}><StatusPill tone="neutral">Revogada</StatusPill></span>
                  ) : (
                    <StatusPill tone="success">Ativa</StatusPill>
                  )}
                </td>
                <td className="text-right">
                  {!credential.revokedAt && (
                    <button type="button" className="button-secondary h-8 px-3 text-[var(--adm-primary)]" onClick={() => revokeCredential(credential.id, credential.name)} disabled={revoke.isPending}>
                      Revogar
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function StoreCodeRow({ store, onFeedback, onChanged }: { store: ErpStoreMapping; onFeedback: (f: Feedback) => void; onChanged: () => Promise<unknown> }) {
  const update = useUpdateErpStoreMapping();
  const [value, setValue] = useState(store.erpCode ?? "");
  useEffect(() => setValue(store.erpCode ?? ""), [store.erpCode]);
  const dirty = value.trim().toUpperCase() !== (store.erpCode ?? "");
  const save = (event: FormEvent) => {
    event.preventDefault();
    onFeedback(null);
    update.mutate(
      { storeId: store.storeId, data: { erpCode: value.trim() || null } },
      {
        onSuccess: async (result) => {
          onFeedback({ kind: "success", text: result.erpCode ? `${store.name}: código do ERP ${result.erpCode} salvo.` : `${store.name}: código do ERP removido.` });
          await onChanged();
        },
        onError: (error) => onFeedback({ kind: "error", text: errorMessage(error, "Não foi possível salvar o código.") }),
      },
    );
  };
  return (
    <tr data-testid={`erp-store-${store.storeId}`}>
      <td>
        <span className="font-semibold">{store.name}</span>
        {!store.active && <span className="ml-2"><StatusPill tone="neutral">Inativa</StatusPill></span>}
        <span className="block text-xs text-muted-foreground">{store.city} · {store.code}</span>
      </td>
      <td className="text-sm">
        {store.deliveryFee > 0 ? brl(store.deliveryFee) : <span className="text-[var(--adm-primary)]">Sem taxa: configure em Filiais</span>}
      </td>
      <td>
        <form onSubmit={save} className="flex items-center gap-2">
          <label className="sr-only" htmlFor={`erp-code-${store.storeId}`}>Código no ERP de {store.name}</label>
          <input
            id={`erp-code-${store.storeId}`}
            className="!h-9 w-32"
            value={value}
            maxLength={32}
            onChange={(event) => setValue(event.target.value)}
            placeholder="Ex.: 001"
            data-testid={`input-erp-code-${store.storeId}`}
          />
          <button type="submit" className="button-secondary h-9 px-3" disabled={!dirty || update.isPending} data-testid={`button-erp-code-${store.storeId}`}>
            {update.isPending ? "Salvando…" : "Salvar"}
          </button>
        </form>
      </td>
    </tr>
  );
}

function StoreCodesSection({ onFeedback, onChanged }: { onFeedback: (f: Feedback) => void; onChanged: () => Promise<unknown> }) {
  const stores = useListErpStoreMappings();
  return (
    <section className="panel mb-6 p-4 sm:p-6" aria-labelledby="erp-stores-title">
      <div className="eyebrow">FILIAIS</div>
      <h2 id="erp-stores-title" className="mt-1 text-lg font-bold">Códigos das filiais no ERP</h2>
      <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
        A venda chega com o código da filial do ERP (campo <code>codigoFilial</code>). Informe aqui o mesmo código para cada filial.
        Venda com código desconhecido aparece como erro no histórico e pode ser reprocessada depois de cadastrar o código.
      </p>
      <div className="relative mt-4 overflow-x-auto">
        <table className="delivery-table w-full min-w-[620px]">
          <thead>
            <tr>
              <th>Filial</th>
              <th>Taxa de entrega</th>
              <th>Código no ERP</th>
            </tr>
          </thead>
          <tbody>
            {stores.isLoading && <tr><td colSpan={3} className="text-muted-foreground">Carregando…</td></tr>}
            {!stores.isLoading && (stores.data ?? []).length === 0 && (
              <tr><td colSpan={3} className="text-muted-foreground">Nenhuma filial cadastrada.</td></tr>
            )}
            {(stores.data ?? []).map((store) => (
              <StoreCodeRow key={store.storeId} store={store} onFeedback={onFeedback} onChanged={onChanged} />
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function EventsSection({
  outcome,
  setOutcome,
  onFeedback,
  onChanged,
}: {
  outcome: ListErpIntegrationEventsOutcome;
  setOutcome: (value: ListErpIntegrationEventsOutcome) => void;
  onFeedback: (f: Feedback) => void;
  onChanged: () => Promise<unknown>;
}) {
  const [searchText, setSearchText] = useState("");
  const [query, setQuery] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);
  const params = { outcome, q: query || undefined, limit: 100 };
  const events = useListErpIntegrationEvents(params, {
    query: { queryKey: getListErpIntegrationEventsQueryKey(params), refetchInterval: 15_000, refetchOnWindowFocus: true },
  });
  const reprocess = useReprocessErpIntegrationEvent();

  const runReprocess = (event: ErpIntegrationEvent) => {
    if (!window.confirm(`Reprocessar ${operationLabel[event.operation]?.toLowerCase() ?? "o envio"} da venda ${event.saleId ?? ""}? Se a venda já tiver entrega, nada é duplicado.`)) return;
    onFeedback(null);
    reprocess.mutate(
      { eventId: event.id },
      {
        onSuccess: async (result) => {
          onFeedback(
            result && result.outcome !== "FAILED"
              ? { kind: "success", text: `Venda ${result.saleId ?? ""} reprocessada: ${outcomeView[result.outcome]?.label.toLowerCase() ?? result.outcome}${result.deliveryCode ? ` (${result.deliveryCode})` : ""}.` }
              : { kind: "error", text: `Ainda com erro: ${result?.errorMessage ?? "veja o histórico."}` },
          );
          await onChanged();
        },
        onError: (error) => onFeedback({ kind: "error", text: errorMessage(error, "Não foi possível reprocessar.") }),
      },
    );
  };

  const rows = events.data ?? [];
  return (
    <section id="erp-historico" className="panel mb-6 scroll-mt-24 p-4 sm:p-6" aria-labelledby="erp-events-title">
      <div className="eyebrow">AUDITORIA</div>
      <h2 id="erp-events-title" className="mt-1 text-lg font-bold">Histórico de vendas recebidas</h2>
      <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
        Tudo que o ERP enviou, com o resultado. Nos erros, veja o motivo, corrija (por exemplo, o código da filial) e clique em Reprocessar.
      </p>

      <div className="mt-4 flex flex-col gap-2 sm:flex-row">
        <form
          className="relative flex-1"
          onSubmit={(event) => {
            event.preventDefault();
            setQuery(searchText.trim());
          }}
        >
          <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
          <label className="sr-only" htmlFor="erp-search">Buscar venda, filial, entrega ou erro</label>
          <input id="erp-search" className="w-full !pl-9" value={searchText} onChange={(event) => setSearchText(event.target.value)} placeholder="Buscar venda, filial, entrega (MM-…) ou código do erro" />
        </form>
        <label className="sr-only" htmlFor="erp-outcome">Resultado</label>
        <select id="erp-outcome" className="h-10 text-sm sm:w-52" value={outcome} onChange={(event) => setOutcome(event.target.value as ListErpIntegrationEventsOutcome)} data-testid="select-erp-outcome">
          <option value="ALL">Todos os resultados</option>
          <option value="FAILED">Com erro</option>
          <option value="CREATED">Cadastradas</option>
          <option value="DUPLICATE">Duplicadas</option>
          <option value="UPDATED">Atualizadas</option>
          <option value="CANCELLED">Canceladas</option>
        </select>
      </div>

      <div className="relative mt-4 overflow-x-auto">
        <table className="delivery-table w-full min-w-[900px]">
          <thead>
            <tr>
              <th>Quando</th>
              <th>Operação</th>
              <th>Venda</th>
              <th>Filial</th>
              <th>Resultado</th>
              <th>Entrega</th>
              <th>Motivo</th>
              <th><span className="sr-only">Ação</span></th>
            </tr>
          </thead>
          <tbody>
            {events.isLoading && <tr><td colSpan={8} className="text-muted-foreground">Carregando…</td></tr>}
            {events.isError && <tr><td colSpan={8} className="text-[var(--adm-primary)]">Não foi possível carregar o histórico.</td></tr>}
            {!events.isLoading && !events.isError && rows.length === 0 && (
              <tr><td colSpan={8} className="text-muted-foreground">Nada por aqui ainda. Quando o ERP enviar vendas, elas aparecem nesta lista.</td></tr>
            )}
            {rows.map((event) => {
              const view = outcomeView[event.outcome] ?? { tone: "neutral" as const, label: event.outcome };
              const open = openId === event.id;
              return (
                <Fragment key={event.id}>
                  <tr data-testid={`erp-event-${event.id}`}>
                    <td className="whitespace-nowrap text-sm">{dateTime(event.createdAt)}</td>
                    <td className="text-sm">
                      {operationLabel[event.operation] ?? event.operation}
                      {event.reprocessOf && <span className="block text-xs text-muted-foreground">Reprocessamento</span>}
                    </td>
                    <td className="whitespace-nowrap font-mono text-xs">{event.saleId ?? "—"}</td>
                    <td className="whitespace-nowrap font-mono text-xs">{event.storeCode ?? "—"}</td>
                    <td><StatusPill tone={view.tone}>{view.label}</StatusPill></td>
                    <td>
                      {event.deliveryId && event.deliveryCode ? (
                        <Link href={`/deliveries/${event.deliveryId}`} className="whitespace-nowrap font-mono text-xs font-semibold text-[var(--adm-primary)] underline-offset-2 hover:underline">
                          {event.deliveryCode}
                        </Link>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className="max-w-[280px] text-xs">
                      {event.errorCode ? (
                        <>
                          <span className="font-semibold">{event.errorCode}</span>
                          <span className="block text-muted-foreground">{event.errorMessage}</span>
                        </>
                      ) : (
                        <span className="text-muted-foreground">{event.reprocessOf ? event.errorMessage : "—"}</span>
                      )}
                      {event.reprocessedAt && (
                        <span className="block text-muted-foreground">Reprocessado por {event.reprocessedBy} em {dateTime(event.reprocessedAt)}</span>
                      )}
                    </td>
                    <td className="whitespace-nowrap text-right">
                      <div className="flex justify-end gap-1.5">
                        {event.payload != null && (
                          <button type="button" className="button-secondary h-8 px-2.5 text-xs" aria-expanded={open} onClick={() => setOpenId(open ? null : event.id)}>
                            {open ? "Ocultar dados" : "Ver dados"}
                          </button>
                        )}
                        {event.canReprocess && (
                          <button type="button" className="button-primary h-8 px-2.5 text-xs" onClick={() => runReprocess(event)} disabled={reprocess.isPending} data-testid={`button-erp-reprocess-${event.id}`}>
                            <RotateCcw size={13} />
                            Reprocessar
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                  {open && (
                    <tr>
                      <td colSpan={8} className="bg-[#faf9f7]">
                        <pre className="max-h-72 overflow-auto whitespace-pre-wrap break-all text-[12px] leading-5 text-[#2b2e33]">{JSON.stringify(event.payload, null, 2)}</pre>
                        <span className="text-[11px] text-muted-foreground">Requisição {event.requestId ?? "—"} · IP {event.clientIp ?? "—"} · {event.credentialName ?? "credencial removida"}</span>
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
