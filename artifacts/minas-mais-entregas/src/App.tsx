import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { ClerkProvider, Show, SignIn, SignUp, useClerk, useUser } from '@clerk/react';
import { publishableKeyFromHost } from '@clerk/react/internal';
import { shadcn } from '@clerk/themes';
import { ptBR } from '@clerk/localizations';
import { QueryClient, QueryClientProvider, useQueryClient } from '@tanstack/react-query';
import {
  getGetMyProfileQueryKey,
  getGetDashboardSummaryQueryKey,
  getGetDeliveryQueryKey,
  getListCourierRoutesQueryKey,
  getListCouriersQueryKey,
  getListDeliveriesQueryKey,
  getListStoresQueryKey,
  useCreateDelivery,
  useCreateDeliveryRoute,
  useDeleteDelivery,
  useDispatchDelivery,
  useGetDashboardSummary,
  useGetDelivery,
  useGetMyProfile,
  useListCouriers,
  useListDeliveries,
  useListStores,
  useUpdateDeliveryStatus,
  type AppUser,
} from '@workspace/api-client-react';
import {
  ArrowLeft, ArrowRight, Bike, Clock3, FilePlus2, Filter,
  History, MapPin, PackageCheck, Phone, Plus, Search, ShieldCheck,
  Truck, UserRound, X, AlertTriangle, RefreshCw,
  Trash2,
} from 'lucide-react';
import { Link, Redirect, Route, Router as WouterRouter, Switch, useLocation, useRoute } from 'wouter';
import { ErrorBoundary } from '@/components/error-boundary';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import NotFound from '@/pages/not-found';
import AccessManagement from '@/pages/access-management';
import CourierPortal from '@/pages/courier-portal';
import CourierAccessPage from '@/pages/courier-access';
import StorePortal from '@/pages/store-portal';

const queryClient = new QueryClient();
const basePath = import.meta.env.BASE_URL.replace(/\/$/, '');
const clerkPubKey = publishableKeyFromHost(
  window.location.hostname,
  import.meta.env.VITE_CLERK_PUBLISHABLE_KEY,
);
const clerkProxyUrl = import.meta.env.VITE_CLERK_PROXY_URL;
if (!clerkPubKey) throw new Error('Missing VITE_CLERK_PUBLISHABLE_KEY');

const clerkAppearance = {
  theme: shadcn,
  cssLayerName: 'clerk',
  options: {
    logoPlacement: 'inside' as const,
    logoLinkUrl: basePath || '/',
    logoImageUrl: `${window.location.origin}${basePath}/logo.svg`,
  },
  variables: {
    colorPrimary: '#b91e2c',
    colorForeground: '#24272d',
    colorMutedForeground: '#777a80',
    colorDanger: '#b42318',
    colorBackground: '#ffffff',
    colorInput: '#ffffff',
    colorInputForeground: '#24272d',
    colorNeutral: '#e7e6e3',
    fontFamily: 'DM Sans, sans-serif',
    borderRadius: '0.75rem',
  },
  elements: {
    rootBox: 'w-full flex justify-center',
    cardBox: 'bg-white rounded-2xl w-[440px] max-w-full overflow-hidden',
    card: '!shadow-none !border-0 !bg-transparent !rounded-none',
    footer: '!shadow-none !border-0 !bg-transparent !rounded-none',
    headerTitle: 'text-[#24272d] font-bold',
    headerSubtitle: 'text-[#777a80]',
    socialButtonsBlockButtonText: 'text-[#24272d] font-semibold',
    formFieldLabel: 'text-[#55595f] font-semibold',
    footerActionLink: 'text-[#a91d2a] font-semibold',
    footerActionText: 'text-[#777a80]',
    dividerText: 'text-[#777a80]',
    identityPreviewEditButton: 'text-[#a91d2a]',
    formFieldSuccessText: 'text-green-700',
    alertText: 'text-red-700',
    logoBox: 'mx-auto',
    logoImage: 'max-h-10',
    socialButtonsBlockButton: 'border-[#e7e6e3] rounded-lg',
    formButtonPrimary: 'bg-[#b91e2c] hover:bg-[#a41926] text-white rounded-lg',
    formFieldInput: 'border-[#e2e0dd] rounded-lg text-[#24272d]',
    footerAction: 'text-[#777a80]',
    dividerLine: 'bg-[#e7e6e3]',
    alert: 'rounded-lg',
    otpCodeFieldInput: 'border-[#e2e0dd] text-[#24272d]',
    formFieldRow: 'gap-1',
    main: 'text-[#24272d]',
  },
};

function ClerkQueryClientCacheInvalidator() {
  const { addListener } = useClerk();
  const client = useQueryClient();
  const previousUserId = useRef<string | null | undefined>(undefined);
  useEffect(() => {
    const unsubscribe = addListener(({ user }) => {
      const userId = user?.id ?? null;
      if (previousUserId.current !== undefined && previousUserId.current !== userId) {
        client.clear();
      }
      previousUserId.current = userId;
    });
    return unsubscribe;
  }, [addListener, client]);
  return null;
}

function SignInPage() {
  return (
    <div className="flex min-h-[100dvh] items-center justify-center bg-[#f4f3f1] px-4 py-8">
      <SignIn routing="path" path={`${basePath}/sign-in`} signUpUrl={`${basePath}/sign-up`} />
    </div>
  );
}

function SignUpPage() {
  return (
    <div className="flex min-h-[100dvh] items-center justify-center bg-[#f4f3f1] px-4 py-8">
      <SignUp routing="path" path={`${basePath}/sign-up`} signInUrl={`${basePath}/sign-in`} />
    </div>
  );
}

function LandingPage() {
  return (
    <main className="min-h-[100dvh] bg-[#f4f3f1] px-5 py-6 text-[#24272d] sm:px-8">
      <div className="mx-auto flex max-w-6xl items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="brand-mark">MM</div>
          <div className="leading-tight">
            <div className="text-[13px] font-bold">MINAS MAIS</div>
            <div className="mt-1 text-[10px] font-semibold uppercase tracking-[.16em] text-muted-foreground">Entregas</div>
          </div>
        </div>
        <div className="flex gap-2">
          <Link href="/motoboy-pwa" className="button-quiet hidden sm:inline-flex">Área do motoboy</Link>
          <Link href="/sign-in" className="button-secondary">Entrar</Link>
          <Link href="/sign-up" className="button-primary">Solicitar acesso</Link>
        </div>
      </div>
      <section className="mx-auto grid max-w-6xl gap-10 py-20 md:grid-cols-[1.1fr_.9fr] md:items-center md:py-28">
        <div>
          <div className="eyebrow">REDE MINAS MAIS</div>
          <h1 className="mt-4 max-w-2xl text-4xl font-bold leading-[1.08] tracking-[-.05em] sm:text-6xl">
            Entregas organizadas. Acompanhamento em cada etapa.
          </h1>
          <p className="mt-5 max-w-xl text-base leading-relaxed text-muted-foreground">
            Um espaço para a central, as unidades e os motoboys acompanharem os pedidos com informações atualizadas.
          </p>
          <div className="mt-7 flex flex-wrap gap-3">
            <Link href="/sign-in" className="button-primary min-h-11 px-5">Acessar o painel</Link>
            <Link href="/motoboy-pwa" className="button-secondary min-h-11 px-5">Área do motoboy</Link>
            <Link href="/sign-up" className="button-secondary min-h-11 px-5">Criar uma conta</Link>
          </div>
          <p className="mt-4 text-xs text-muted-foreground">
            Novas contas precisam ser aprovadas por um administrador antes de acessar os dados.
          </p>
        </div>
        <div className="panel p-5 sm:p-7">
          <div className="eyebrow">ACOMPANHAMENTO</div>
          <div className="mt-5 space-y-4">
            {[
              ['01', 'Pedido registrado', 'A unidade informa o valor e o destino.'],
              ['02', 'Motoboy atribuído', 'A central organiza o despacho.'],
              ['03', 'Entrega concluída', 'O valor concluído entra no resumo a receber.'],
            ].map(([number, title, description]) => (
              <div key={number} className="flex gap-3 rounded-lg bg-[#faf9f7] p-4">
                <span className="font-mono text-xs font-semibold text-[#a91d2a]">{number}</span>
                <div><div className="text-sm font-bold">{title}</div><p className="mt-1 text-xs text-muted-foreground">{description}</p></div>
              </div>
            ))}
          </div>
        </div>
      </section>
    </main>
  );
}

function HomeRedirect() {
  return (
    <>
      <Show when="signed-in"><Redirect to="/user-portal" /></Show>
      <Show when="signed-out"><LandingPage /></Show>
    </>
  );
}
const statusNames: Record<string, string> = {
  REQUESTED: 'Solicitada', AWAITING_COURIER: 'Aguardando entregador', OFFERED: 'Oferta enviada',
  ACCEPTED: 'Aceita', TO_STORE: 'A caminho da loja', AT_STORE: 'Na loja',
  IN_TRANSIT: 'Em entrega', COMPLETED: 'Concluída', CANCELLED: 'Cancelada',
};
const statusOptions: Record<string, string[]> = {
  REQUESTED: ['CANCELLED'],
  OFFERED: ['ACCEPTED', 'CANCELLED'],
  ACCEPTED: ['TO_STORE', 'AT_STORE', 'CANCELLED'],
  TO_STORE: ['AT_STORE', 'CANCELLED'],
  AT_STORE: ['IN_TRANSIT', 'CANCELLED'],
  IN_TRANSIT: ['COMPLETED', 'CANCELLED'],
};
const fmtTime = (value?: string | null) => value ? new Date(value).toLocaleString('pt-BR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—';
const timeAgo = (value?: string | null) => {
  if (!value) return 'Localização indisponível';
  const mins = Math.max(0, Math.round((Date.now() - new Date(value).getTime()) / 60000));
  return mins < 1 ? 'agora' : `há ${mins} min`;
};

function Badge({ children, tone = 'neutral' }: { children: ReactNode; tone?: string }) {
  return <span className={`inline-flex items-center rounded-full px-2.5 py-1 text-[11px] font-semibold tracking-[.01em] badge-${tone}`}>{children}</span>;
}
function StatusBadge({ status }: { status: string }) {
  const tone = ['COMPLETED'].includes(status) ? 'green' : ['CANCELLED'].includes(status) ? 'muted' :
    ['IN_TRANSIT', 'TO_STORE', 'AT_STORE'].includes(status) ? 'red' :
    ['OFFERED', 'AWAITING_COURIER', 'REQUESTED'].includes(status) ? 'amber' : 'blue';
  return <Badge tone={tone}>{statusNames[status] ?? status.replaceAll('_', ' ')}</Badge>;
}
function Skeleton({ rows = 4 }: { rows?: number }) {
  return <div className="space-y-3 p-5" aria-label="Carregando"><div className="skeleton h-5 w-40" />{Array.from({ length: rows }, (_, i) => <div key={i} className="skeleton h-12 w-full" />)}</div>;
}
function EmptyState({ title, detail, action }: { title: string; detail: string; action?: ReactNode }) {
  return <div className="flex min-h-56 flex-col items-center justify-center px-5 text-center">
    <span className="mb-3 grid h-11 w-11 place-items-center rounded-xl bg-[#f7eeee] text-primary"><PackageCheck size={20} /></span>
    <h3 className="font-semibold text-[15px]">{title}</h3><p className="mt-1 max-w-sm text-sm text-muted-foreground">{detail}</p>{action && <div className="mt-4">{action}</div>}
  </div>;
}
function AppShell({ children, profile }: { children: ReactNode; profile: AppUser }) {
  const [location] = useLocation();
  const { signOut } = useClerk();
  return <div className="ops-shell md:flex">
    <aside className="ops-sidebar flex md:min-h-[100dvh] md:w-[232px] md:flex-col">
      <div className="flex w-full items-center gap-3 border-b border-border px-5 py-5 md:border-b-0">
        <div className="brand-mark">MM</div>
        <div className="leading-tight"><div className="text-[13px] font-bold tracking-[-.02em]">MINAS MAIS</div><div className="mt-1 text-[10px] font-semibold uppercase tracking-[.16em] text-muted-foreground">Entregas</div></div>
      </div>
      <div className="hidden px-3 pt-5 md:block">
        <div className="nav-caption">OPERAÇÃO</div>
        <Link href="/" className={`nav-link ${location === '/' ? 'nav-active' : ''}`} data-testid="link-operations">
          <Truck size={17} strokeWidth={1.8} /><span>Entregas</span><span className="ml-auto nav-live-dot" />
        </Link>
        {profile.role === 'ADMIN' && <Link href="/access" className={`nav-link ${location === '/access' ? 'nav-active' : ''}`}>
          <ShieldCheck size={17} strokeWidth={1.8}/><span>Acessos</span>
        </Link>}
      </div>
      <div className="mt-auto hidden border-t border-border p-4 md:block">
        <div className="flex items-center gap-3 rounded-lg bg-[#f7f6f4] p-3">
          <div className="avatar avatar-red">{profile.name.slice(0, 2).toUpperCase()}</div>
          <div className="min-w-0"><div className="truncate text-xs font-semibold">{profile.name}</div><div className="mt-0.5 truncate text-[10px] text-muted-foreground">{profile.email}</div></div>
        </div>
      </div>
    </aside>
    <main className="min-w-0 flex-1">
      <header className="topbar">
        <div className="flex items-center gap-2 text-xs text-muted-foreground"><span className="hidden sm:inline">Rede Minas Mais</span><span className="hidden sm:inline">/</span><span className="font-semibold text-foreground">{location.startsWith('/deliveries/') ? 'Detalhe da entrega' : 'Central de entregas'}</span></div>
          <div className="ml-auto flex items-center gap-2"><span className="hidden text-[11px] text-muted-foreground sm:inline">Painel operacional</span><button className="button-quiet" onClick={() => void signOut({ redirectUrl: basePath || '/' })}>Sair</button></div>
      </header>
      <div className="ops-content mx-auto w-full px-4 pb-10 pt-7 sm:px-6 lg:px-9">{children}</div>
    </main>
  </div>;
}

function DeliveryModal({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const storesQuery = useListStores({ query: { queryKey: getListStoresQueryKey() } });
  const create = useCreateDelivery();
  const [error, setError] = useState('');
  const [form, setForm] = useState({ customerName: '', customerPhone: '', destination: '', orderNumber: '', notes: '', storeId: '', priority: 'normal', deliveryAmount: '' });
  const update = (key: string, value: string) => setForm(prev => ({ ...prev, [key]: value }));
  const submit = (e: FormEvent) => {
    e.preventDefault(); setError('');
    create.mutate({ data: { ...form, deliveryAmount: Number(form.deliveryAmount), priority: form.priority as 'normal' | 'urgent' } }, {
      onSuccess: () => {
        void qc.invalidateQueries({ queryKey: getListDeliveriesQueryKey() });
        void qc.invalidateQueries({ queryKey: getGetDashboardSummaryQueryKey() });
        onClose();
      },
      onError: () => setError('Não foi possível registrar. Confira os dados e tente novamente.'),
    });
  };
  return <div className="modal-backdrop" role="presentation" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
    <section className="modal-card soft-enter" role="dialog" aria-modal="true" aria-labelledby="new-delivery-title">
      <div className="flex items-start justify-between border-b border-border px-6 py-5"><div><div className="eyebrow">NOVO PEDIDO</div><h2 id="new-delivery-title" className="mt-1 text-xl font-bold tracking-tight">Registrar entrega</h2><p className="mt-1 text-sm text-muted-foreground">Inclua os dados recebidos da unidade.</p></div><button className="icon-button" onClick={onClose} aria-label="Fechar"><X size={18}/></button></div>
      <form onSubmit={submit} className="space-y-4 px-6 py-5">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Nome do cliente"><input required minLength={2} value={form.customerName} onChange={e => update('customerName', e.target.value)} placeholder="Nome completo" data-testid="input-customer-name"/></Field>
          <Field label="Telefone"><input type="tel" value={form.customerPhone} onChange={e => update('customerPhone', e.target.value)} placeholder="(31) 99999-0000" data-testid="input-customer-phone"/></Field>
        </div>
        <Field label="Endereço de entrega"><input required minLength={5} value={form.destination} onChange={e => update('destination', e.target.value)} placeholder="Rua, número, bairro e complemento" data-testid="input-destination"/></Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Número do pedido"><input required value={form.orderNumber} onChange={e => update('orderNumber', e.target.value)} placeholder="Ex.: 48271" data-testid="input-order-number"/></Field>
          <Field label="Unidade"><select required value={form.storeId} onChange={e => update('storeId', e.target.value)} data-testid="select-store"><option value="">Selecione uma unidade</option>{(storesQuery.data ?? []).filter(s => s.active).map(s => <option key={s.id} value={s.id}>{s.name} · {s.city}</option>)}</select></Field>
        </div>
        <Field label="Valor do motoboy (R$)"><input required type="number" min="0.01" step="0.01" value={form.deliveryAmount} onChange={e => update('deliveryAmount', e.target.value)} placeholder="Ex.: 12,50" data-testid="input-delivery-amount"/></Field>
        {storesQuery.isLoading && <p className="text-xs text-muted-foreground">Carregando unidades disponíveis…</p>}
        {storesQuery.isError && <p className="text-xs text-destructive">Não foi possível carregar as unidades. Reabra o formulário para tentar novamente.</p>}
        <Field label="Observações"><textarea rows={2} value={form.notes} onChange={e => update('notes', e.target.value)} placeholder="Referências úteis para a entrega" data-testid="input-notes"/></Field>
        <Field label="Prioridade"><select value={form.priority} onChange={e => update('priority', e.target.value)} data-testid="select-priority"><option value="normal">Normal</option><option value="urgent">Urgente</option></select></Field>
        {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
        <div className="flex justify-end gap-2 border-t border-border pt-4"><button type="button" className="button-secondary" onClick={onClose}>Cancelar</button><button type="submit" className="button-primary" disabled={create.isPending || storesQuery.isLoading || !storesQuery.data?.some(s => s.active)}><Plus size={16}/>{create.isPending ? 'Registrando…' : 'Registrar pedido'}</button></div>
      </form>
    </section>
  </div>;
}
function Field({ label, children }: { label: string; children: ReactNode }) {
  return <label className="block"><span className="mb-1.5 block text-[11px] font-semibold uppercase tracking-[.08em] text-muted-foreground">{label}</span>{children}</label>;
}
function DispatchModal({ deliveryId, onClose }: { deliveryId: string; onClose: () => void }) {
  const qc = useQueryClient();
  const couriersQuery = useListCouriers({ query: { queryKey: getListCouriersQueryKey() } });
  const dispatch = useDispatchDelivery();
  const [courierId, setCourierId] = useState('');
  const [error, setError] = useState('');
  const available = (couriersQuery.data ?? []).filter(c => c.status === 'AVAILABLE');
  const go = () => {
    setError('');
    dispatch.mutate({ deliveryId, data: { mode: 'single', courierId } }, {
      onSuccess: () => {
        void qc.invalidateQueries({ queryKey: getListDeliveriesQueryKey() });
        void qc.invalidateQueries({ queryKey: getGetDeliveryQueryKey(deliveryId) });
        void qc.invalidateQueries({ queryKey: getGetDashboardSummaryQueryKey() });
        void qc.invalidateQueries({ queryKey: getListCouriersQueryKey() });
        onClose();
      }, onError: () => setError('O despacho não foi concluído. Verifique a disponibilidade e tente novamente.'),
    });
  };
  return <div className="modal-backdrop" role="presentation" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
    <section className="modal-card soft-enter" role="dialog" aria-modal="true" aria-labelledby="dispatch-title">
      <div className="flex items-start justify-between border-b border-border px-6 py-5"><div><div className="eyebrow">DESPACHO INDIVIDUAL</div><h2 id="dispatch-title" className="mt-1 text-xl font-bold">Escolher motoboy</h2><p className="mt-1 text-sm text-muted-foreground">Somente motoboys disponíveis aparecem aqui. Para agrupar entregas, selecione-as na fila.</p></div><button className="icon-button" onClick={onClose} aria-label="Fechar"><X size={18}/></button></div>
      <div className="space-y-4 px-6 py-5">
        <Field label="Motoboy disponível"><select value={courierId} onChange={e => setCourierId(e.target.value)} data-testid="select-courier"><option value="">Selecione um motoboy</option>{available.map(c => <option key={c.id} value={c.id}>{c.name} · localização {timeAgo(c.lastLocationAt)}</option>)}</select></Field>
        {couriersQuery.isLoading && <Skeleton rows={2}/>}
        {couriersQuery.isError && <p className="text-sm text-destructive">Não foi possível consultar os entregadores disponíveis.</p>}
        {!couriersQuery.isLoading && available.length === 0 && <div className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900">Nenhum motoboy disponível no momento.</div>}
        {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
        <div className="flex justify-end gap-2 border-t border-border pt-4"><button className="button-secondary" onClick={onClose}>Cancelar</button><button className="button-primary" disabled={dispatch.isPending || couriersQuery.isLoading || !courierId || !available.length} onClick={go}><Truck size={16}/>{dispatch.isPending ? 'Enviando…' : 'Enviar oferta'}</button></div>
      </div>
    </section>
  </div>;
}

function Dashboard({ isAdmin }: { isAdmin: boolean }) {
  const [showCreate, setShowCreate] = useState(false);
  const [dispatchId, setDispatchId] = useState<string | null>(null);
  const [selectedDeliveryIds, setSelectedDeliveryIds] = useState<string[]>([]);
  const [routeFeedback, setRouteFeedback] = useState('');
  const [searchText, setSearchText] = useState('');
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [storeId, setStoreId] = useState('');
  const [deleteFeedback, setDeleteFeedback] = useState<{ kind: 'success' | 'error'; text: string } | null>(null);
  const qc = useQueryClient();
  const createDeliveryRoute = useCreateDeliveryRoute();
  const deleteDelivery = useDeleteDelivery();
  const summary = useGetDashboardSummary({ query: { refetchInterval: 15000, refetchOnWindowFocus: true } });
  const stores = useListStores({ query: { queryKey: getListStoresQueryKey() } });
  const couriers = useListCouriers({ query: { queryKey: getListCouriersQueryKey(), refetchInterval: 15000 } });
  const params = useMemo(() => ({ ...(status ? { status } : {}), ...(search ? { search } : {}), ...(storeId ? { storeId } : {}) }), [status, search, storeId]);
  const deliveries = useListDeliveries(params, { query: { refetchInterval: 15000, refetchOnWindowFocus: true } });
  const runSearch = (e: FormEvent) => { e.preventDefault(); setSearch(searchText.trim()); };
  const invalidate = (id: string) => {
    void qc.invalidateQueries({ queryKey: getListDeliveriesQueryKey() });
    void qc.invalidateQueries({ queryKey: getGetDeliveryQueryKey(id) });
    void qc.invalidateQueries({ queryKey: getGetDashboardSummaryQueryKey() });
    void qc.invalidateQueries({ queryKey: getListCouriersQueryKey() });
  };
  const toggleRouteDelivery = (id: string, checked: boolean) => {
    setRouteFeedback('');
    setSelectedDeliveryIds(current => {
      if (!checked) return current.filter(item => item !== id);
      if (current.length >= 10) return current;
      return current.includes(id) ? current : [...current, id];
    });
  };
  const offerGroupedRoute = () => {
    setRouteFeedback('');
    createDeliveryRoute.mutate({ data: { deliveryIds: selectedDeliveryIds } }, {
      onSuccess: result => {
        setSelectedDeliveryIds([]);
        setRouteFeedback(`Rota ${result.id.slice(0, 8)} criada com ${result.deliveryCount} entregas. O motoboy verá e otimizará a sequência ao aceitar.`);
        void qc.invalidateQueries({ queryKey: getListDeliveriesQueryKey() });
        void qc.invalidateQueries({ queryKey: getGetDashboardSummaryQueryKey() });
      },
      onError: error => setRouteFeedback(error instanceof Error ? error.message : 'Não foi possível criar a rota. Atualize a fila e tente novamente.'),
    });
  };
  const removeDelivery = (deliveryId: string, code: string) => {
    if (!isAdmin) return;
    const confirmed = window.confirm(
      `Excluir permanentemente a entrega ${code} e seu histórico de eventos? Esta ação não pode ser desfeita.`,
    );
    if (!confirmed) return;
    setDeleteFeedback(null);
    deleteDelivery.mutate(
      { deliveryId },
      {
        onSuccess: async () => {
          setSelectedDeliveryIds((current) => current.filter((id) => id !== deliveryId));
          setDeleteFeedback({ kind: 'success', text: `Entrega ${code} excluída.` });
          await Promise.all([
            qc.invalidateQueries({ queryKey: getListDeliveriesQueryKey() }),
            qc.invalidateQueries({ queryKey: getGetDashboardSummaryQueryKey() }),
            qc.invalidateQueries({ queryKey: getListCourierRoutesQueryKey() }),
          ]);
          qc.removeQueries({ queryKey: getGetDeliveryQueryKey(deliveryId) });
        },
        onError: (error) => {
          const apiError = error as Error & { data?: { error?: string } };
          setDeleteFeedback({
            kind: 'error',
            text: apiError.data?.error ?? (error instanceof Error ? error.message : 'Não foi possível excluir a entrega.'),
          });
        },
      },
    );
  };
  const counts = summary.data;
  return <div className="soft-enter">
    <div className="mb-6 flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
        <div><div className="eyebrow">VISÃO GERAL · REDE MINAS MAIS</div><h1 className="mt-2 text-[28px] font-bold tracking-[-.045em] sm:text-[34px]">Central de entregas</h1><p className="mt-1 text-sm text-muted-foreground">Acompanhe pedidos, disponibilidade e despacho em um só lugar.</p><p className="mt-2 text-[11px] text-muted-foreground">Atualização automática a cada 15 segundos.</p></div>
      <div className="flex flex-wrap gap-2 self-start sm:self-auto">
        {selectedDeliveryIds.length >= 2 && <button className="button-secondary h-10" onClick={offerGroupedRoute} disabled={createDeliveryRoute.isPending} data-testid="button-create-route"><Bike size={16}/>{createDeliveryRoute.isPending ? 'Criando rota…' : `Agrupar ${selectedDeliveryIds.length} entregas`}</button>}
        {selectedDeliveryIds.length > 0 && <button className="button-quiet h-10" onClick={() => { setSelectedDeliveryIds([]); setRouteFeedback(''); }}>Limpar seleção ({selectedDeliveryIds.length})</button>}
        <button className="button-primary h-10" onClick={() => setShowCreate(true)} data-testid="button-new-delivery"><FilePlus2 size={16}/>Nova entrega</button>
      </div>
    </div>
    <section className="metric-grid mb-6">
       <Metric title="Pedidos em operação" value={counts?.requested} hint="solicitações ativas agora" icon={<PackageCheck size={17}/>} loading={summary.isLoading}/>
      <Metric title="Aguardando entregador" value={counts?.awaitingCourier} hint={`${counts?.offered ?? '—'} ofertas enviadas`} icon={<Clock3 size={17}/>} accent loading={summary.isLoading}/>
      <Metric title="Em rota" value={counts?.inTransit} hint={`${counts?.delayed ?? '—'} com atraso`} icon={<Truck size={17}/>} loading={summary.isLoading}/>
      <Metric title="Entregadores" value={counts ? `${counts.availableCouriers} / ${counts.busyCouriers}` : undefined} hint="disponíveis / ocupados" icon={<Bike size={17}/>} loading={summary.isLoading}/>
    </section>
    {summary.isError && <div className="mb-5 flex items-center justify-between rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800"><span>Não foi possível carregar o resumo operacional.</span><button className="inline-flex items-center gap-1 font-semibold" onClick={() => void summary.refetch()}><RefreshCw size={14}/>Tentar novamente</button></div>}
    <section className="mb-6 grid gap-4 lg:grid-cols-[1fr_300px]">
      <div className="panel p-4 sm:p-5">
        <div className="mb-4 flex items-center justify-between"><div><div className="eyebrow">TEMPO DE ATENDIMENTO</div><h2 className="mt-1 text-sm font-bold">Ritmo da operação</h2></div><span className="rounded-md bg-[#f5f4f2] px-2 py-1 text-[10px] font-medium text-muted-foreground">média registrada</span></div>
        {summary.isLoading ? <div className="skeleton h-[76px] w-full"/> : <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
          <div className="flex-1"><div className="flex items-baseline justify-between"><span className="text-xs text-muted-foreground">Aceite da oferta</span><strong className="mono text-xl">{counts?.averageAcceptanceMinutes ?? '—'}<small className="ml-1 text-xs font-normal text-muted-foreground">min</small></strong></div><div className="meter mt-2"><span style={{ width: `${Math.min((counts?.averageAcceptanceMinutes ?? 0) * 4, 100)}%` }}/></div></div>
          <div className="hidden h-10 w-px bg-border sm:block"/>
          <div className="flex-1"><div className="flex items-baseline justify-between"><span className="text-xs text-muted-foreground">Conclusão total</span><strong className="mono text-xl">{counts?.averageTotalMinutes ?? '—'}<small className="ml-1 text-xs font-normal text-muted-foreground">min</small></strong></div><div className="meter mt-2"><span className="meter-gray" style={{ width: `${Math.min((counts?.averageTotalMinutes ?? 0) * 1.5, 100)}%` }}/></div></div>
        </div>}
      </div>
      <div className="panel flex items-center gap-4 p-4 sm:px-5"><div className="courier-pie"><Bike size={20}/></div><div className="min-w-0 flex-1"><div className="eyebrow">DISPONIBILIDADE</div><div className="mt-1 flex items-baseline gap-1"><strong className="mono text-2xl">{counts?.availableCouriers ?? '—'}</strong><span className="text-xs text-muted-foreground">disponíveis agora</span></div><div className="mt-1 text-[11px] text-muted-foreground">{couriers.data?.filter(c => c.status === 'OFFLINE').length ?? '—'} offline</div></div><ArrowRight size={16} className="text-muted-foreground"/></div>
    </section>
    <section className="mb-6 grid gap-4 lg:grid-cols-[1.45fr_1fr]">
      <div className="panel overflow-hidden">
        <div className="flex items-center justify-between border-b border-border px-4 py-4 sm:px-5">
          <div><div className="eyebrow">ACOMPANHAMENTO</div><h2 className="mt-1 text-sm font-bold">Mapa de rastreamento</h2></div>
          <Badge tone="amber">Integração pendente</Badge>
        </div>
        <div className="relative grid min-h-[210px] place-items-center overflow-hidden bg-[#f3f2ef] p-6 text-center" style={{ backgroundImage: 'linear-gradient(rgba(90, 91, 87, .055) 1px, transparent 1px), linear-gradient(90deg, rgba(90, 91, 87, .055) 1px, transparent 1px)', backgroundSize: '28px 28px' }}>
          <div className="relative max-w-md">
            <span className="mx-auto grid h-11 w-11 place-items-center rounded-full bg-white text-primary shadow-sm"><MapPin size={20}/></span>
            <h3 className="mt-3 text-sm font-semibold">Coordenadas GPS não disponíveis</h3>
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">A integração com mapas e o envio de latitude/longitude ainda não estão configurados. Nenhuma posição está sendo exibida como atual.</p>
          </div>
        </div>
      </div>
      <div className="panel overflow-hidden">
        <div className="border-b border-border px-4 py-4 sm:px-5"><div className="eyebrow">SINAL DE LOCALIZAÇÃO</div><h2 className="mt-1 text-sm font-bold">Último registro recebido</h2></div>
        {couriers.isLoading ? <Skeleton rows={3}/> : couriers.isError ? <p className="p-5 text-sm text-muted-foreground">Não foi possível consultar os registros de localização.</p> : !couriers.data?.length ? <EmptyState title="Sem entregadores cadastrados" detail="Os registros aparecerão aqui quando houver entregadores."/> :
          <ul className="divide-y divide-border">{couriers.data.map(c => <li key={c.id} className="flex items-center gap-3 px-4 py-3 sm:px-5"><span className="avatar">{c.initials}</span><div className="min-w-0 flex-1"><div className="truncate text-xs font-semibold">{c.name}</div><div className="mt-1 text-[10px] text-muted-foreground">Posição não disponível · {timeAgo(c.lastLocationAt)}</div></div><Badge tone={c.status === 'AVAILABLE' ? 'green' : c.status === 'BUSY' ? 'blue' : 'muted'}>{c.status === 'AVAILABLE' ? 'Disponível' : c.status === 'BUSY' ? 'Ocupado' : 'Offline'}</Badge></li>)}</ul>}
      </div>
    </section>
    <section className="panel overflow-hidden">
      <div className="flex flex-col gap-3 border-b border-border px-4 py-4 sm:px-5">
         <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center"><div><div className="eyebrow">FILA DE ENTREGAS</div><h2 className="mt-1 text-lg font-bold tracking-tight">Solicitações de entrega <span className="ml-1 rounded-md bg-[#f3f1ef] px-2 py-0.5 align-middle text-xs font-semibold text-muted-foreground">{deliveries.data?.length ?? '—'}</span></h2></div><div className="flex gap-2"><button className="button-quiet" onClick={() => { setStatus(''); setStoreId(''); setSearch(''); setSearchText(''); }}><Filter size={14}/>Limpar filtros</button><button className="button-secondary" onClick={() => void deliveries.refetch()} aria-label="Atualizar lista"><RefreshCw size={14}/></button></div></div>
        <div className="flex flex-col gap-2 sm:flex-row">
          <form onSubmit={runSearch} className="search-box flex-1"><Search size={15}/><input placeholder="Buscar código, cliente ou pedido" value={searchText} onChange={e => setSearchText(e.target.value)} aria-label="Buscar entregas" data-testid="input-search-deliveries"/><button type="submit" className="search-submit">Buscar</button></form>
          <select value={status} onChange={e => setStatus(e.target.value)} className="filter-select" aria-label="Filtrar por status" data-testid="filter-status"><option value="">Todos os status</option>{Object.entries(statusNames).map(([value, name]) => <option key={value} value={value}>{name}</option>)}</select>
          <select value={storeId} onChange={e => setStoreId(e.target.value)} className="filter-select" aria-label="Filtrar por unidade" data-testid="filter-store"><option value="">Todas as unidades</option>{(stores.data ?? []).map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select>
        </div>
      </div>
      {routeFeedback && <p className={`mx-4 mb-3 rounded-lg px-3 py-2 text-sm ${routeFeedback.startsWith('Rota ') ? 'bg-green-50 text-green-800' : 'bg-red-50 text-red-700'}`} role="status">{routeFeedback}</p>}
      {deleteFeedback && <p className={`mx-4 mb-3 rounded-lg px-3 py-2 text-sm ${deleteFeedback.kind === 'success' ? 'bg-green-50 text-green-800' : 'bg-red-50 text-red-700'}`} role="status">{deleteFeedback.text}</p>}
      {selectedDeliveryIds.length > 0 && <p className="mx-4 mb-3 text-xs text-muted-foreground">Selecione de 2 a 10 solicitações novas. A melhor sequência será calculada quando o motoboy aceitar a rota.</p>}
      {deliveries.isLoading ? <Skeleton rows={5}/> : deliveries.isError ? <div className="p-8 text-center"><AlertTriangle className="mx-auto mb-2 text-amber-600"/><p className="font-semibold">Falha ao carregar solicitações</p><p className="mb-3 mt-1 text-sm text-muted-foreground">A fila permanece disponível para nova tentativa.</p><button className="button-secondary mx-auto" onClick={() => void deliveries.refetch()}><RefreshCw size={14}/>Tentar novamente</button></div> :
        !deliveries.data?.length ? <EmptyState title="Nenhuma solicitação nesta fila" detail={search || status || storeId ? 'Ajuste os filtros ou registre uma nova entrega.' : 'Quando uma solicitação chegar, ela aparecerá aqui para análise e despacho.'} action={<button className="button-primary" onClick={() => setShowCreate(true)}><Plus size={15}/>Registrar entrega</button>}/> :
          <div className="overflow-x-auto"><table className="delivery-table w-full min-w-[980px]">
            <thead><tr><th>Rota</th><th>Solicitação</th><th>Cliente / destino</th><th>Unidade</th><th>Status</th><th>Entregador</th><th>Atualizada</th><th className="text-right">Ação</th></tr></thead>
            <tbody>{deliveries.data.map(d => <tr className="row-hover" key={d.id} data-testid={`row-delivery-${d.id}`}>
              <td>{d.status === 'REQUESTED' ? <input type="checkbox" aria-label={`Selecionar ${d.code} para uma rota`} checked={selectedDeliveryIds.includes(d.id)} disabled={!selectedDeliveryIds.includes(d.id) && selectedDeliveryIds.length >= 10} onChange={e => toggleRouteDelivery(d.id, e.target.checked)} className="h-4 w-4 accent-[#b91e2c]"/> : <span className="text-xs text-muted-foreground">—</span>}</td>
              <td><Link href={`/deliveries/${d.id}`} className="table-code" data-testid={`link-delivery-${d.id}`}>{d.code}<span>Pedido {d.orderNumber || '—'}</span></Link>{d.priority === 'urgent' && <span className="priority-tag">URGENTE</span>}</td>
              <td><div className="font-semibold">{d.customerName}</div><div className="mt-1 flex max-w-[235px] items-center gap-1 truncate text-xs text-muted-foreground"><MapPin size={12}/>{d.destination}</div></td>
               <td><div className="text-sm font-medium">{d.storeName}</div><div className="mt-1 text-[11px] text-muted-foreground">Filial de origem</div></td>
              <td><StatusBadge status={d.status}/></td>
              <td>{d.courierName ? <div className="flex items-center gap-2"><span className="avatar">{d.courierInitials || d.courierName.slice(0,2).toUpperCase()}</span><div><div className="text-xs font-semibold">{d.courierName}</div><div className="text-[10px] text-muted-foreground">{timeAgo(d.lastLocationAt)}</div></div></div> : <span className="text-xs text-muted-foreground">Não atribuído</span>}</td>
              <td className="text-xs text-muted-foreground">{fmtTime(d.updatedAt || d.createdAt)}</td>
              <td className="text-right"><div className="flex justify-end gap-1.5">{['REQUESTED','AWAITING_COURIER'].includes(d.status) && <button className="button-small button-red-outline" onClick={() => setDispatchId(d.id)} data-testid={`button-dispatch-${d.id}`}>Despachar</button>}{isAdmin && <button className="icon-button-sm text-red-700" type="button" disabled={deleteDelivery.isPending} onClick={() => removeDelivery(d.id, d.code)} aria-label={`Excluir ${d.code}`} title="Excluir registro"><Trash2 size={15}/></button>}<Link href={`/deliveries/${d.id}`} className="icon-button-sm" aria-label={`Abrir ${d.code}`}><ArrowRight size={15}/></Link></div></td>
            </tr>)}</tbody>
          </table></div>}
    </section>
    <div className="mt-4 flex items-center justify-between text-[11px] text-muted-foreground"><span>Atualizações refletem os registros disponíveis no sistema.</span><span className="inline-flex items-center gap-1"><Clock3 size={12}/>Sem rastreamento GPS em tempo real</span></div>
    {showCreate && <DeliveryModal onClose={() => setShowCreate(false)}/>}
    {dispatchId && <DispatchModal deliveryId={dispatchId} onClose={() => setDispatchId(null)}/>}
  </div>;
}
function Metric({ title, value, hint, icon, accent, loading }: { title: string; value?: number | string; hint: string; icon: ReactNode; accent?: boolean; loading?: boolean }) {
  return <div className={`metric-card panel p-4 sm:p-5 ${accent ? 'metric-accent' : ''}`}><div className="flex items-start justify-between"><span className="text-xs font-semibold text-muted-foreground">{title}</span><span className={`metric-icon ${accent ? 'metric-icon-red' : ''}`}>{icon}</span></div>{loading ? <div className="skeleton mt-3 h-8 w-20"/> : <div className="mono mt-2 text-[30px] font-semibold leading-none tracking-[-.08em]">{value ?? '—'}</div>}<div className="mt-2 text-[11px] text-muted-foreground">{hint}</div></div>;
}

function DeliveryDetail() {
  const [, params] = useRoute('/deliveries/:deliveryId');
  const id = params?.deliveryId ?? '';
  const { data, isLoading, isError, refetch } = useGetDelivery(id, { query: { enabled: !!id, queryKey: getGetDeliveryQueryKey(id), refetchInterval: 15000 } });
  const couriers = useListCouriers({ query: { queryKey: getListCouriersQueryKey(), refetchInterval: 15000 } });
  const qc = useQueryClient();
  const updateStatus = useUpdateDeliveryStatus();
  const dispatch = useDispatchDelivery();
  const [dispatchOpen, setDispatchOpen] = useState(false);
  const [nextStatus, setNextStatus] = useState('');
  const [actionError, setActionError] = useState('');
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: getGetDeliveryQueryKey(id) });
    void qc.invalidateQueries({ queryKey: getListDeliveriesQueryKey() });
    void qc.invalidateQueries({ queryKey: getGetDashboardSummaryQueryKey() });
    void qc.invalidateQueries({ queryKey: getListCouriersQueryKey() });
  };
  const applyStatus = () => {
    if (!nextStatus || !data) return;
    setActionError('');
    updateStatus.mutate({ deliveryId: id, data: { status: nextStatus as 'ACCEPTED' | 'TO_STORE' | 'AT_STORE' | 'IN_TRANSIT' | 'COMPLETED' | 'CANCELLED' } }, {
      onSuccess: () => { refresh(); setNextStatus(''); },
      onError: () => setActionError('Não foi possível atualizar o status. Tente novamente.'),
    });
  };
  const singleDispatch = (courierId: string) => {
    if (!data) return;
    dispatch.mutate({ deliveryId: id, data: { mode: 'single', courierId } }, { onSuccess: refresh, onError: () => setActionError('Não foi possível enviar a oferta.') });
  };
  return <div className="soft-enter">
    <Link href="/" className="back-link"><ArrowLeft size={15}/>Voltar para a fila</Link>
    {isLoading ? <div className="mt-5 panel"><Skeleton rows={7}/></div> : isError || !data ? <div className="mt-5 panel"><EmptyState title="Entrega não encontrada" detail="O registro pode ter sido removido ou estar temporariamente indisponível." action={<button className="button-secondary" onClick={() => void refetch()}><RefreshCw size={14}/>Tentar novamente</button>}/></div> :
      <>
        <div className="mt-5 flex flex-col justify-between gap-4 md:flex-row md:items-start">
          <div><div className="eyebrow">DETALHE DA SOLICITAÇÃO</div><div className="mt-1 flex flex-wrap items-center gap-3"><h1 className="text-[30px] font-bold tracking-[-.05em]">{data.code}</h1><StatusBadge status={data.status}/>{data.priority === 'urgent' && <span className="priority-tag">URGENTE</span>}</div><p className="mt-1 text-sm text-muted-foreground">Pedido {data.orderNumber || '—'} <span className="mx-1.5">·</span> Criado {fmtTime(data.createdAt)}</p></div>
          <div className="flex flex-wrap gap-2">{['REQUESTED','AWAITING_COURIER'].includes(data.status) && <button className="button-primary" onClick={() => setDispatchOpen(true)}><Truck size={16}/>Despachar</button>}
            <select className="filter-select" value={nextStatus} onChange={e => setNextStatus(e.target.value)} aria-label="Novo status"><option value="">Atualizar status</option>{(statusOptions[data.status] ?? []).map(s => <option key={s} value={s}>{statusNames[s]}</option>)}</select>
            <button className="button-secondary" disabled={!nextStatus || updateStatus.isPending} onClick={applyStatus}>{updateStatus.isPending ? 'Salvando…' : 'Aplicar'}</button>
          </div>
        </div>
        {actionError && <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{actionError}</p>}
        <div className="detail-grid mt-6">
          <div className="space-y-4">
            <section className="panel p-5">
              <div className="mb-4 flex items-center justify-between"><div><div className="eyebrow">PEDIDO E DESTINO</div><h2 className="mt-1 font-bold">Informações da entrega</h2></div><span className="rounded-md bg-[#f6f4f1] p-2 text-primary"><PackageCheck size={18}/></span></div>
              <div className="info-grid">
                <Info label="Cliente" value={data.customerName}/><Info label="Telefone" value={data.customerPhone || 'Não informado'} icon={data.customerPhone ? <Phone size={13}/> : undefined}/>
                <Info label="Valor do motoboy" value={data.deliveryAmount.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}/>
                <Info label="Endereço de entrega" value={data.destination} wide icon={<MapPin size={14}/>}/><Info label="Unidade de origem" value={data.storeName}/><Info label="Número do pedido" value={data.orderNumber || '—'}/>
                <Info label="Distância informada" value={data.distanceKm != null ? `${data.distanceKm} km` : 'Não disponível'}/><Info label="Previsão" value={data.estimatedMinutes != null ? `${data.estimatedMinutes} min` : 'Não informada'}/>
              </div>
              {data.notes && <div className="mt-4 rounded-lg bg-[#f7f6f4] p-3"><div className="eyebrow">OBSERVAÇÕES</div><p className="mt-1 text-sm leading-relaxed">{data.notes}</p></div>}
            </section>
            <section className="panel p-5">
              <div className="mb-4"><div className="eyebrow">LOCALIZAÇÃO DO ENTREGADOR</div><h2 className="mt-1 font-bold">Último registro disponível</h2></div>
              <div className="location-panel"><div className="location-symbol"><MapPin size={19}/></div><div><div className="font-semibold">{data.courierName || 'Entregador ainda não atribuído'}</div><p className="mt-1 text-xs text-muted-foreground">{data.lastLocationAt ? `Registro informado ${timeAgo(data.lastLocationAt)} · ${fmtTime(data.lastLocationAt)}` : 'Localização indisponível no momento.'}</p></div><div className="location-stamp">GPS<br/>N/D</div></div>
              <p className="mt-3 text-[11px] text-muted-foreground">O painel não dispõe de mapa ou coordenadas GPS. A informação acima é somente o horário do último registro recebido.</p>
            </section>
          </div>
          <aside className="space-y-4">
            <section className="panel p-5">
              <div className="mb-4"><div className="eyebrow">ENTREGADOR</div><h2 className="mt-1 font-bold">Atribuição atual</h2></div>
              {data.courierName ? <div className="flex items-center gap-3 rounded-lg bg-[#f7f6f4] p-3"><span className="avatar avatar-large">{data.courierInitials || data.courierName.slice(0,2).toUpperCase()}</span><div className="min-w-0 flex-1"><div className="font-semibold">{data.courierName}</div><div className="mt-1 text-xs text-muted-foreground">Última localização: {timeAgo(data.lastLocationAt)}</div></div><Badge tone="blue">Atribuído</Badge></div> : <div className="rounded-lg border border-dashed border-border px-4 py-5 text-center"><Bike size={22} className="mx-auto text-muted-foreground"/><p className="mt-2 text-sm font-semibold">Aguardando entregador</p><p className="mt-1 text-xs text-muted-foreground">Despache para iniciar o atendimento.</p></div>}
              {['REQUESTED','AWAITING_COURIER'].includes(data.status) && <div className="mt-4"><label className="eyebrow" htmlFor="quick-courier">OFERTA INDIVIDUAL</label><div className="mt-2 flex gap-2"><select id="quick-courier" className="filter-select min-w-0 flex-1" defaultValue=""><option value="">Escolher disponível</option>{(couriers.data ?? []).filter(c => c.status === 'AVAILABLE').map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select><button className="button-secondary" onClick={e => { const select = e.currentTarget.previousElementSibling as HTMLSelectElement; if (select.value) singleDispatch(select.value); else setActionError('Selecione um entregador disponível.'); }} disabled={dispatch.isPending}>Enviar</button></div></div>}
            </section>
            <section className="panel p-5">
              <div className="mb-5 flex items-center gap-2"><History size={16} className="text-primary"/><div><div className="eyebrow">AUDITORIA</div><h2 className="mt-0.5 font-bold">Histórico de eventos</h2></div></div>
              {data.events?.length ? <div className="timeline">{[...data.events].sort((a,b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()).map((event, i) => <div className="timeline-item" key={event.id}><span className={`timeline-pin ${i === data.events.length - 1 ? 'timeline-current' : ''}`}/><div className="flex items-start justify-between gap-3"><div><div className="text-sm font-semibold">{event.label}</div><div className="mt-1 text-xs text-muted-foreground">{event.actor || 'Sistema'}{event.kind ? ` · ${event.kind}` : ''}</div></div><time className="shrink-0 text-[10px] text-muted-foreground">{fmtTime(event.timestamp)}</time></div></div>)}</div> : <div className="rounded-lg bg-[#f7f6f4] p-4 text-sm text-muted-foreground">Ainda não há eventos registrados para esta entrega.</div>}
            </section>
          </aside>
        </div>
      </>}
    {dispatchOpen && <DispatchModal deliveryId={id} onClose={() => setDispatchOpen(false)}/>}
  </div>;
}
function Info({ label, value, icon, wide }: { label: string; value: string; icon?: ReactNode; wide?: boolean }) {
  return <div className={wide ? 'info-wide' : ''}><div className="eyebrow">{label}</div><div className="mt-1 flex items-start gap-1.5 text-sm font-medium leading-relaxed">{icon && <span className="mt-0.5 text-muted-foreground">{icon}</span>}{value}</div></div>;
}
function RoutedErrorBoundary({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  return <ErrorBoundary resetKey={location}>{children}</ErrorBoundary>;
}

function ProfileLoading() {
  return <main className="grid min-h-[100dvh] place-items-center bg-[#f4f3f1] p-5"><div className="panel w-full max-w-sm p-6"><div className="skeleton h-5 w-40"/><div className="skeleton mt-4 h-12 w-full"/></div></main>;
}

function PendingApproval({ profile }: { profile: AppUser }) {
  const { signOut } = useClerk();
  return <main className="grid min-h-[100dvh] place-items-center bg-[#f4f3f1] p-5">
    <section className="panel w-full max-w-md p-7 text-center">
      <div className="brand-mark mx-auto">MM</div>
      <h1 className="mt-5 text-xl font-bold">Acesso aguardando aprovação</h1>
      <p className="mt-2 text-sm leading-relaxed text-muted-foreground">Sua conta foi criada, mas ainda não recebeu um perfil de acesso. Um administrador precisa aprovar e vincular sua conta.</p>
      <p className="mt-4 rounded-lg bg-[#f7f6f4] px-3 py-2 text-xs text-muted-foreground">{profile.email}</p>
      <button className="button-secondary mt-5" onClick={() => void signOut({ redirectUrl: basePath || '/' })}>Sair da conta</button>
    </section>
  </main>;
}

function ProfileError({ retry }: { retry: () => void }) {
  return <main className="grid min-h-[100dvh] place-items-center bg-[#f4f3f1] p-5">
    <section className="panel w-full max-w-md p-6 text-center">
      <h1 className="text-lg font-bold">Não foi possível validar sua conta</h1>
      <p className="mt-2 text-sm text-muted-foreground">Verifique sua conexão e tente novamente.</p>
      <button className="button-primary mt-5" onClick={retry}>Tentar novamente</button>
    </section>
  </main>;
}

function useSignedInProfile() {
  const auth = useUser();
  const profile = useGetMyProfile({
    query: {
      queryKey: getGetMyProfileQueryKey(),
      enabled: auth.isLoaded && Boolean(auth.isSignedIn),
      retry: false,
    },
  });
  return { auth, profile };
}

function UserPortalRoute() {
  const { auth, profile } = useSignedInProfile();
  if (!auth.isLoaded || (auth.isSignedIn && profile.isLoading)) return <ProfileLoading />;
  if (!auth.isSignedIn) return <Redirect to="/" />;
  if (profile.isError || !profile.data) return <ProfileError retry={() => void profile.refetch()} />;
  if (profile.data.role === 'PENDING') return <PendingApproval profile={profile.data} />;
  if (profile.data.role === 'COURIER') return <CourierPortal profile={profile.data} />;
  if (profile.data.role === 'STORE_MANAGER' || profile.data.role === 'STORE_STAFF') {
    return <StorePortal profile={profile.data} />;
  }
  return <RoutedErrorBoundary><AppShell profile={profile.data}><Dashboard isAdmin={profile.data.role === 'ADMIN'} /></AppShell></RoutedErrorBoundary>;
}

function CentralRoute({ children, adminOnly = false }: { children: ReactNode; adminOnly?: boolean }) {
  const { auth, profile } = useSignedInProfile();
  if (!auth.isLoaded || (auth.isSignedIn && profile.isLoading)) return <ProfileLoading />;
  if (!auth.isSignedIn) return <Redirect to="/" />;
  if (profile.isError || !profile.data) return <ProfileError retry={() => void profile.refetch()} />;
  if (profile.data.role === 'PENDING') return <PendingApproval profile={profile.data} />;
  if (profile.data.role !== 'ADMIN' && profile.data.role !== 'CENTRAL') return <Redirect to="/user-portal" />;
  if (adminOnly && profile.data.role !== 'ADMIN') {
    return <main className="grid min-h-[100dvh] place-items-center bg-[#f4f3f1] p-5"><section className="panel p-6 text-center"><h1 className="font-bold">Acesso restrito</h1><p className="mt-2 text-sm text-muted-foreground">Somente administradores podem gerenciar perfis.</p><Link className="button-primary mt-4" href="/">Voltar ao painel</Link></section></main>;
  }
  return <RoutedErrorBoundary><AppShell profile={profile.data}>{children}</AppShell></RoutedErrorBoundary>;
}

function HomeRoute() {
  return <Show when="signed-in"><Redirect to="/user-portal" /></Show>;
}

function ClerkRoutes() {
  const [, setLocation] = useLocation();
  const stripBase = (path: string) =>
    basePath && path.startsWith(basePath) ? path.slice(basePath.length) || '/' : path;

  return <ClerkProvider
    publishableKey={clerkPubKey}
    proxyUrl={clerkProxyUrl}
    appearance={clerkAppearance}
    signInUrl={`${basePath}/sign-in`}
    signUpUrl={`${basePath}/sign-up`}
    localization={{
      ...ptBR,
      signIn: {
        ...ptBR.signIn,
        start: { ...ptBR.signIn?.start, title: 'Bem-vindo de volta', subtitle: 'Entre para acompanhar as entregas.' },
      },
      signUp: {
        ...ptBR.signUp,
        start: { ...ptBR.signUp?.start, title: 'Solicite seu acesso', subtitle: 'Sua conta será liberada por um administrador.' },
      },
    }}
    routerPush={(to) => setLocation(stripBase(to))}
    routerReplace={(to) => setLocation(stripBase(to), { replace: true })}
  >
    <QueryClientProvider client={queryClient}>
      <ClerkQueryClientCacheInvalidator />
      <TooltipProvider>
        <Switch>
          <Route path="/" component={HomeRedirect}/>
          <Route path="/user-portal" component={UserPortalRoute}/>
          <Route path="/motoboy-pwa" component={CourierAccessPage}/>
          <Route path="/deliveries/:deliveryId" component={() => <CentralRoute><DeliveryDetail/></CentralRoute>}/>
          <Route path="/access" component={() => <CentralRoute adminOnly><AccessManagement/></CentralRoute>}/>
          <Route path="/sign-in/*?" component={SignInPage}/>
          <Route path="/sign-up/*?" component={SignUpPage}/>
          <Route component={NotFound}/>
        </Switch>
        <Toaster/>
      </TooltipProvider>
    </QueryClientProvider>
  </ClerkProvider>;
}

function App() {
  return <WouterRouter base={basePath}><ClerkRoutes/></WouterRouter>;
}
export default App;
