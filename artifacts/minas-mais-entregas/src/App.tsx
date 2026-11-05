import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { ClerkProvider, Show, SignIn, SignUp, useAuth, useClerk, useUser } from '@clerk/react';
import { publishableKeyFromHost } from '@clerk/react/internal';
import { shadcn } from '@clerk/themes';
import { ptBR } from '@clerk/localizations';
import { QueryClient, QueryClientProvider, useQueryClient } from '@tanstack/react-query';
import {
  getGetMyProfileQueryKey,
  getGetDashboardSummaryQueryKey,
  getGetDeliveryQueryKey,
  getGetCourierEarningsQueryKey,
  getListCourierRoutesQueryKey,
  getListCouriersQueryKey,
  getListDeliveriesQueryKey,
  getListStoresQueryKey,
  getListActiveRoutesQueryKey,
  getGetDeliveryAnalyticsQueryKey,
  setAuthTokenGetter,
  setBaseUrl,
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
  useListActiveRoutes,
  useUpdateDeliveryStatus,
  type AppUser,
} from '@workspace/api-client-react';
import {
  ArrowLeft, ArrowRight, Bike, Clock3, FilePlus2, Filter,
  History, MapPin, PackageCheck, Phone, Plus, Search, ShieldCheck,
  Truck, UserRound, X, AlertTriangle, RefreshCw, KeyRound, Trash2,
} from 'lucide-react';
import { Link, Redirect, Route, Router as WouterRouter, Switch, useLocation, useRoute } from 'wouter';
import { ErrorBoundary } from '@/components/error-boundary';
import { AutoDismissFeedback, type FeedbackMessage } from '@/components/auto-dismiss-feedback';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import NotFound from '@/pages/not-found';
import AccessManagement from '@/pages/access-management';
import CourierPortal from '@/pages/courier-portal';
import LiveMap, { type MapMarker } from '@/components/live-map';
import AddressAutocomplete from '@/components/address-autocomplete';
import CourierAccessPage from '@/pages/courier-access';
import StorePortal from '@/pages/store-portal';
import StoreManagement from '@/pages/store-management';
import Reports from '@/pages/reports';
import EvidencePhotoAction from '@/components/evidence-photo-action';
import AccountSecurityPage from '@/pages/account-security';
import CancellationAlertsPanel from '@/components/cancellation-alerts-panel';
import { Capacitor } from '@capacitor/core';
import { Network } from '@capacitor/network';
import NativeCourierSetupGate from '@/components/native-courier-setup';

const queryClient = new QueryClient();
const basePath = import.meta.env.BASE_URL.replace(/\/$/, '');
const isNativeApp = Capacitor.isNativePlatform();
const nativeApiBaseUrl = (
  import.meta.env.VITE_NATIVE_API_BASE_URL || 'https://minas-mais-entregas.replit.app'
).replace(/\/+$/, '');
if (isNativeApp) setBaseUrl(nativeApiBaseUrl);
const clerkPubKey = publishableKeyFromHost(
  window.location.hostname,
  import.meta.env.VITE_CLERK_PUBLISHABLE_KEY,
);
const clerkProxyUrl = isNativeApp
  ? `${nativeApiBaseUrl}/api/__clerk`
  : import.meta.env.VITE_CLERK_PROXY_URL;
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
const nativeClerkAppearance = {
  ...clerkAppearance,
  elements: {
    socialButtonsBlockButton: { display: 'none' },
    socialButtonsBlockButtonText: { display: 'none' },
    socialButtonsBlockDivider: { display: 'none' },
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
      <SignIn
        routing="path"
        path={`${basePath}/sign-in`}
        signUpUrl={`${basePath}/sign-up`}
        fallbackRedirectUrl={`${basePath}/user-portal`}
      />
    </div>
  );
}

function SignUpPage() {
  return (
    <div className="flex min-h-[100dvh] items-center justify-center bg-[#f4f3f1] px-4 py-8">
      <SignUp
        routing="path"
        path={`${basePath}/sign-up`}
        signInUrl={`${basePath}/sign-in`}
        fallbackRedirectUrl={`${basePath}/user-portal`}
      />
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
            <Link href="/sign-in" className="button-primary min-h-11 px-5">Entrar</Link>
            <Link href="/sign-up" className="button-secondary min-h-11 px-5">Solicitar acesso</Link>
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
      <Show when="signed-in"><UserPortalRoute /></Show>
      <Show when="signed-out"><LandingPage /></Show>
    </>
  );
}
const statusNames: Record<string, string> = {
  REQUESTED: 'Solicitada', AWAITING_COURIER: 'Aguardando entregador', OFFERED: 'Oferta enviada',
  ACCEPTED: 'Aceita', TO_STORE: 'A caminho da loja', AT_STORE: 'Na loja',
  IN_TRANSIT: 'Em entrega', COMPLETED: 'Concluída', CANCELLED: 'Cancelado pela Central',
  RETURNING_TO_STORE: 'Retornando à filial', NOT_DELIVERED: 'Não entregue',
};
const statusOptions: Record<string, string[]> = {
  REQUESTED: [],
  OFFERED: ['ACCEPTED'],
  ACCEPTED: ['TO_STORE', 'AT_STORE'],
  TO_STORE: ['AT_STORE'],
  AT_STORE: ['IN_TRANSIT'],
  IN_TRANSIT: ['COMPLETED'],
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
  const summary = useGetDashboardSummary({
    query: {
      queryKey: getGetDashboardSummaryQueryKey(),
      refetchInterval: 15000,
      refetchOnWindowFocus: true,
    },
  });
  const awaitingCount = summary.data?.awaitingCourier ?? 0;
  return <div className="ops-shell md:flex">
    <aside className="ops-sidebar flex md:min-h-[100dvh] md:w-[232px] md:flex-col">
      <div className="flex w-full items-center gap-3 border-b border-border px-5 py-5 md:border-b-0">
        <div className="brand-mark">MM</div>
        <div className="leading-tight"><div className="text-[13px] font-bold tracking-[-.02em]">MINAS MAIS</div><div className="mt-1 text-[10px] font-semibold uppercase tracking-[.16em] text-muted-foreground">Entregas</div></div>
      </div>
      <div className="hidden px-3 pt-5 md:block">
        <div className="nav-caption">OPERAÇÃO</div>
        <Link href="/" className={`nav-link ${location === '/' ? 'nav-active' : ''}`} data-testid="link-operations">
          <Truck size={17} strokeWidth={1.8} /><span>Entregas</span>{awaitingCount > 0 && <span className="nav-count-badge ml-auto">{awaitingCount}</span>}
        </Link>
        {profile.role === 'ADMIN' && <Link href="/access" className={`nav-link ${location === '/access' ? 'nav-active' : ''}`}>
          <ShieldCheck size={17} strokeWidth={1.8}/><span>Acessos</span>
        </Link>}
        {profile.role === 'ADMIN' && <Link href="/filiais" className={`nav-link ${location === '/filiais' ? 'nav-active' : ''}`}>
          <MapPin size={17} strokeWidth={1.8}/><span>Filiais</span>
        </Link>}
        {(profile.role === 'ADMIN' || profile.role === 'CENTRAL') && <Link href="/reports" className={`nav-link ${location === '/reports' ? 'nav-active' : ''}`}>
          <History size={17} strokeWidth={1.8}/><span>Relatórios</span>
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
        <div className="flex items-center gap-2 text-xs text-muted-foreground"><span className="hidden sm:inline">Rede Minas Mais</span><span className="hidden sm:inline">/</span><span className="font-semibold text-foreground">{location.startsWith('/deliveries/') ? 'Detalhe da entrega' : location === '/access' ? 'Acessos e perfis' : location === '/filiais' ? 'Filiais' : location === '/reports' ? 'Relatórios' : 'Central de entregas'}</span></div>
          <div className="ml-auto flex items-center gap-2">
            <Link href="/account" className="icon-button" aria-label="Minha conta e senha" title="Minha conta e senha"><KeyRound size={16}/></Link>
            <nav className="flex items-center gap-1 md:hidden" aria-label="Navegação principal">
              <Link href="/" className="icon-button relative" aria-label={`Entregas${awaitingCount > 0 ? `, ${awaitingCount} aguardando entregador` : ''}`}><Truck size={16}/>{awaitingCount > 0 && <span className="nav-count-badge nav-count-badge--mobile">{awaitingCount}</span>}</Link>
              {profile.role === 'ADMIN' && <>
                <Link href="/filiais" className="icon-button" aria-label="Filiais"><MapPin size={16}/></Link>
                <Link href="/access" className="icon-button" aria-label="Acessos"><ShieldCheck size={16}/></Link>
              </>}
              {(profile.role === 'ADMIN' || profile.role === 'CENTRAL') && <Link href="/reports" className="icon-button" aria-label="Relatórios"><History size={16}/></Link>}
            </nav>
            <span className="hidden text-[11px] text-muted-foreground sm:inline">Painel operacional</span>
            <button className="button-quiet" onClick={() => void signOut({ redirectUrl: basePath || '/' })}>Sair</button>
          </div>
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
  const [customerCoordinates, setCustomerCoordinates] = useState<{ latitude: number | null; longitude: number | null }>({ latitude: null, longitude: null });
  const [form, setForm] = useState({ customerName: '', customerPhone: '', destination: '', orderNumber: '', notes: '', storeId: '', priority: 'normal' });
  const selectedStore = (storesQuery.data ?? []).find(store => store.id === form.storeId);
  const update = (key: string, value: string) => setForm(prev => ({ ...prev, [key]: value, ...(key === 'destination' ? { customerLatitude: null, customerLongitude: null } : {}) }));
  const hasUnsavedChanges = Boolean(
    form.customerName.trim() ||
    form.customerPhone.trim() ||
    form.destination.trim() ||
    form.orderNumber.trim() ||
    form.notes.trim() ||
    form.storeId ||
    form.priority !== 'normal',
  );
  const requestClose = () => {
    if (create.isPending) return;
    if (hasUnsavedChanges && !window.confirm('Os dados preenchidos serão descartados. Deseja fechar o formulário?')) return;
    onClose();
  };
  useModalBehavior(requestClose);
  const submit = (e: FormEvent) => {
    e.preventDefault(); setError('');
    create.mutate({ data: { ...form, customerLatitude: customerCoordinates.latitude, customerLongitude: customerCoordinates.longitude, priority: form.priority as 'normal' | 'urgent' } }, {
      onSuccess: () => {
        void qc.invalidateQueries({ queryKey: getListDeliveriesQueryKey() });
        void qc.invalidateQueries({ queryKey: getGetDashboardSummaryQueryKey() });
        void qc.invalidateQueries({ queryKey: getGetDeliveryAnalyticsQueryKey() });
        onClose();
      },
      onError: () => setError('Não foi possível registrar. Confira os dados e tente novamente.'),
    });
  };
  return createPortal(
    <div className="modal-backdrop" role="presentation" onPointerDown={e => { if (e.target === e.currentTarget) requestClose(); }}>
    <section className="modal-card" role="dialog" aria-modal="true" aria-labelledby="new-delivery-title" data-modal-active="true">
      <div className="modal-header flex items-start justify-between gap-3 border-b border-border px-5 py-4 sm:px-6 sm:py-5"><div className="min-w-0"><div className="eyebrow">NOVO PEDIDO</div><h2 id="new-delivery-title" className="mt-1 text-xl font-bold tracking-tight">Registrar entrega</h2><p className="mt-1 text-sm text-muted-foreground">Inclua os dados recebidos da unidade.</p></div><button type="button" className="icon-button modal-close-button" onClick={requestClose} aria-label="Fechar" disabled={create.isPending}><X size={18}/></button></div>
      <form onSubmit={submit} className="modal-form">
        <div className="modal-fields space-y-4 px-5 py-4 sm:px-6 sm:py-5">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Nome do cliente"><input required minLength={2} value={form.customerName} onChange={e => update('customerName', e.target.value)} placeholder="Nome completo" data-modal-initial-focus data-testid="input-customer-name"/></Field>
          <Field label="Telefone"><input type="tel" value={form.customerPhone} onChange={e => update('customerPhone', e.target.value)} placeholder="(31) 99999-0000" data-testid="input-customer-phone"/></Field>
        </div>
        <Field label="Endereço de entrega">
          <AddressAutocomplete
            id="input-destination"
            required
            value={form.destination}
            onChange={value => update('destination', value)}
            onSelect={suggestion => setCustomerCoordinates({ latitude: suggestion.latitude, longitude: suggestion.longitude })}
            placeholder="Digite rua, número, bairro ou CEP"
            inputClassName="w-full"
            dataTestId="input-destination"
          />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Número do pedido"><input required value={form.orderNumber} onChange={e => update('orderNumber', e.target.value)} placeholder="Ex.: 48271" data-testid="input-order-number"/></Field>
          <Field label="Unidade"><select required value={form.storeId} onChange={e => update('storeId', e.target.value)} data-testid="select-store"><option value="">Selecione uma unidade</option>{(storesQuery.data ?? []).filter(s => s.active).map(s => <option key={s.id} value={s.id}>{s.name} · {s.city}</option>)}</select></Field>
        </div>
        <Field label="Tarifa da filial (R$)"><input type="text" readOnly value={selectedStore ? selectedStore.deliveryFee.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }) : 'Selecione uma filial'} aria-label="Tarifa definida pela filial" data-testid="text-delivery-fee"/></Field>
        {storesQuery.isLoading && <p className="text-xs text-muted-foreground">Carregando unidades disponíveis…</p>}
        {storesQuery.isError && <p className="text-xs text-destructive">Não foi possível carregar as unidades. Reabra o formulário para tentar novamente.</p>}
        <Field label="Observações"><textarea rows={2} value={form.notes} onChange={e => update('notes', e.target.value)} placeholder="Referências úteis para a entrega" data-testid="input-notes"/></Field>
        <Field label="Prioridade"><select value={form.priority} onChange={e => update('priority', e.target.value)} data-testid="select-priority"><option value="normal">Normal</option><option value="urgent">Urgente</option></select></Field>
        {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
        </div>
        <div className="modal-form-actions flex flex-col-reverse gap-2 border-t border-border px-5 py-4 sm:flex-row sm:justify-end sm:px-6"><button type="button" className="button-secondary" onClick={requestClose} disabled={create.isPending}>Cancelar</button><button type="submit" className="button-primary" disabled={create.isPending || storesQuery.isLoading || !storesQuery.data?.some(s => s.active)}><Plus size={16}/>{create.isPending ? 'Registrando…' : 'Registrar pedido'}</button></div>
      </form>
    </section>
    </div>,
    document.body,
  );
}

function useModalBehavior(onRequestClose: () => void) {
  const closeRef = useRef(onRequestClose);
  closeRef.current = onRequestClose;

  useEffect(() => {
    const body = document.body;
    const root = document.documentElement;
    const scrollY = window.scrollY;
    const previousBodyStyles = {
      position: body.style.position,
      top: body.style.top,
      left: body.style.left,
      right: body.style.right,
      width: body.style.width,
      overflow: body.style.overflow,
    };
    const previousRootOverflow = root.style.overflow;

    body.style.position = 'fixed';
    body.style.top = `-${scrollY}px`;
    body.style.left = '0';
    body.style.right = '0';
    body.style.width = '100%';
    body.style.overflow = 'hidden';
    root.style.overflow = 'hidden';

    const focusFrame = window.requestAnimationFrame(() => {
      const initialField = document.querySelector<HTMLElement>('[data-modal-active="true"] [data-modal-initial-focus]');
      initialField?.focus({ preventScroll: true });
    });
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        closeRef.current();
      }
    };
    document.addEventListener('keydown', handleKeyDown);

    return () => {
      window.cancelAnimationFrame(focusFrame);
      document.removeEventListener('keydown', handleKeyDown);
      body.style.position = previousBodyStyles.position;
      body.style.top = previousBodyStyles.top;
      body.style.left = previousBodyStyles.left;
      body.style.right = previousBodyStyles.right;
      body.style.width = previousBodyStyles.width;
      body.style.overflow = previousBodyStyles.overflow;
      root.style.overflow = previousRootOverflow;
      window.scrollTo(0, scrollY);
    };
  }, []);
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return <label className="block"><span className="mb-1.5 block text-[11px] font-semibold uppercase tracking-[.08em] text-muted-foreground">{label}</span>{children}</label>;
}
function DispatchModal({ deliveryId, onClose }: { deliveryId: string; onClose: () => void }) {
  const qc = useQueryClient();
  const couriersQuery = useListCouriers(undefined, { query: { queryKey: getListCouriersQueryKey() } });
  const dispatch = useDispatchDelivery();
  const [courierId, setCourierId] = useState('');
  const [error, setError] = useState('');
  const selectableCouriers = (couriersQuery.data ?? []).filter(c => c.status !== 'BUSY');
  const requestClose = () => {
    if (dispatch.isPending) return;
    if (courierId && !window.confirm('A seleção do motoboy será descartada. Deseja fechar?')) return;
    onClose();
  };
  useModalBehavior(requestClose);
  const go = () => {
    setError('');
    dispatch.mutate({ deliveryId, data: { mode: 'single', courierId } }, {
      onSuccess: () => {
        void qc.invalidateQueries({ queryKey: getListDeliveriesQueryKey() });
        void qc.invalidateQueries({ queryKey: getGetDeliveryQueryKey(deliveryId) });
        void qc.invalidateQueries({ queryKey: getGetDashboardSummaryQueryKey() });
        void qc.invalidateQueries({ queryKey: getListCouriersQueryKey() });
        void qc.invalidateQueries({ queryKey: getGetDeliveryAnalyticsQueryKey() });
        onClose();
      }, onError: () => setError('Não foi possível enviar a oferta. O motoboy pode ter iniciado outra entrega; atualize a lista e tente novamente.'),
    });
  };
  return createPortal(
    <div className="modal-backdrop" role="presentation" onPointerDown={e => { if (e.target === e.currentTarget) requestClose(); }}>
    <section className="modal-card" role="dialog" aria-modal="true" aria-labelledby="dispatch-title" data-modal-active="true">
      <div className="modal-header flex items-start justify-between gap-3 border-b border-border px-5 py-4 sm:px-6 sm:py-5"><div className="min-w-0"><div className="eyebrow">DESPACHO INDIVIDUAL</div><h2 id="dispatch-title" className="mt-1 text-xl font-bold">Escolher motoboy</h2><p className="mt-1 text-sm text-muted-foreground">Todos os cadastros aparecem. Motoboys em atendimento não podem receber outra entrega; os offline verão a oferta quando entrarem no PWA.</p></div><button type="button" className="icon-button modal-close-button" onClick={requestClose} aria-label="Fechar" disabled={dispatch.isPending}><X size={18}/></button></div>
      <div className="modal-form">
      <div className="modal-fields modal-body space-y-4 px-5 py-4 sm:px-6 sm:py-5">
        <Field label="Motoboy cadastrado"><select value={courierId} onChange={e => setCourierId(e.target.value)} data-modal-initial-focus data-testid="select-courier"><option value="">Selecione um motoboy</option>{(couriersQuery.data ?? []).map(c => <option key={c.id} value={c.id} disabled={c.status === 'BUSY'}>{c.name} · {c.status === 'AVAILABLE' ? 'Disponível' : c.status === 'OFFLINE' ? 'Offline' : 'Em atendimento'}</option>)}</select></Field>
        {couriersQuery.isLoading && <Skeleton rows={2}/>}
        {couriersQuery.isError && <p className="text-sm text-destructive">Não foi possível consultar os motoboys cadastrados.</p>}
        {!couriersQuery.isLoading && selectableCouriers.length === 0 && <div className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900">Todos os motoboys cadastrados estão em atendimento. Aguarde alguém concluir a entrega.</div>}
        {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
      </div>
      <div className="modal-form-actions flex flex-col-reverse gap-2 border-t border-border px-5 py-4 sm:flex-row sm:justify-end sm:px-6"><button type="button" className="button-secondary" onClick={requestClose} disabled={dispatch.isPending}>Cancelar</button><button type="button" className="button-primary" disabled={dispatch.isPending || couriersQuery.isLoading || !selectableCouriers.some(courier => courier.id === courierId)} onClick={go}><Truck size={16}/>{dispatch.isPending ? 'Enviando…' : 'Enviar oferta'}</button></div>
      </div>
    </section>
    </div>,
    document.body,
  );
}

function CancelDeliveryModal({
  deliveryId,
  code,
  onClose,
  onCancelled,
}: {
  deliveryId: string;
  code: string;
  onClose: () => void;
  onCancelled: () => void;
}) {
  const qc = useQueryClient();
  const updateStatus = useUpdateDeliveryStatus();
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");
  const requestClose = () => {
    if (!updateStatus.isPending) onClose();
  };
  useModalBehavior(requestClose);

  const submit = () => {
    setError("");
    const note = reason.trim();
    updateStatus.mutate(
      {
        deliveryId,
        data: { status: "CANCELLED", ...(note ? { note } : {}) },
      },
      {
        onSuccess: async () => {
          await Promise.all([
            qc.invalidateQueries({ queryKey: getListDeliveriesQueryKey() }),
            qc.invalidateQueries({ queryKey: getGetDeliveryQueryKey(deliveryId) }),
            qc.invalidateQueries({ queryKey: getGetDashboardSummaryQueryKey() }),
            qc.invalidateQueries({ queryKey: getListCouriersQueryKey() }),
            qc.invalidateQueries({ queryKey: getListCourierRoutesQueryKey() }),
            qc.invalidateQueries({ queryKey: getGetDeliveryAnalyticsQueryKey() }),
          ]);
          onCancelled();
          onClose();
        },
        onError: (mutationError) => {
          const apiError = mutationError as Error & { data?: { error?: string } };
          setError(
            apiError.data?.error ??
              (mutationError instanceof Error
                ? mutationError.message
                : "Não foi possível cancelar o pedido."),
          );
        },
      },
    );
  };

  return createPortal(
    <div
      className="modal-backdrop"
      role="presentation"
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) requestClose();
      }}
    >
      <section
        className="modal-card"
        role="dialog"
        aria-modal="true"
        aria-labelledby="cancel-delivery-title"
        data-modal-active="true"
      >
        <div className="modal-header flex items-start justify-between gap-3 border-b border-border px-5 py-4 sm:px-6 sm:py-5">
          <div className="min-w-0">
            <div className="eyebrow">CANCELAMENTO</div>
            <h2 id="cancel-delivery-title" className="mt-1 text-xl font-bold">
              Cancelar pedido {code}
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              O pedido e seu histórico permanecerão disponíveis nos relatórios.
            </p>
          </div>
          <button
            type="button"
            className="icon-button modal-close-button"
            onClick={requestClose}
            aria-label="Fechar"
            disabled={updateStatus.isPending}
          >
            <X size={18} />
          </button>
        </div>
        <div className="modal-form">
          <div className="modal-fields space-y-4 px-5 py-4 sm:px-6 sm:py-5">
            <Field label="Motivo (opcional)">
              <textarea
                rows={3}
                maxLength={500}
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                placeholder="Informe o motivo do cancelamento"
                data-modal-initial-focus
                data-testid="input-cancel-reason"
              />
            </Field>
            <p className="text-right text-[11px] text-muted-foreground">
              {reason.length}/500
            </p>
            {error && (
              <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700" role="alert">
                {error}
              </p>
            )}
          </div>
          <div className="modal-form-actions flex flex-col-reverse gap-2 border-t border-border px-5 py-4 sm:flex-row sm:justify-end sm:px-6">
            <button
              type="button"
              className="button-secondary"
              onClick={requestClose}
              disabled={updateStatus.isPending}
            >
              Voltar
            </button>
            <button
              type="button"
              className="button-primary"
              onClick={submit}
              disabled={updateStatus.isPending}
              data-testid="button-confirm-cancel"
            >
              <X size={15} />
              {updateStatus.isPending ? "Cancelando…" : "Confirmar cancelamento"}
            </button>
          </div>
        </div>
      </section>
    </div>,
    document.body,
  );
}

function DeleteDeliveryModal({
  deliveryId,
  code,
  onClose,
  onDeleted,
}: {
  deliveryId: string;
  code: string;
  onClose: () => void;
  onDeleted: () => void;
}) {
  const qc = useQueryClient();
  const deleteDelivery = useDeleteDelivery();
  const [error, setError] = useState("");
  const requestClose = () => {
    if (!deleteDelivery.isPending) onClose();
  };
  useModalBehavior(requestClose);

  const submit = () => {
    setError("");
    deleteDelivery.mutate(
      { deliveryId },
      {
        onSuccess: async () => {
          await Promise.all([
            qc.invalidateQueries({ queryKey: getListDeliveriesQueryKey() }),
            qc.invalidateQueries({ queryKey: getGetDeliveryQueryKey(deliveryId) }),
            qc.invalidateQueries({ queryKey: getGetDashboardSummaryQueryKey() }),
            qc.invalidateQueries({ queryKey: getListCouriersQueryKey() }),
            qc.invalidateQueries({ queryKey: getGetDeliveryAnalyticsQueryKey() }),
            qc.invalidateQueries({ queryKey: getGetCourierEarningsQueryKey() }),
            qc.invalidateQueries({ queryKey: getListCourierRoutesQueryKey() }),
            qc.invalidateQueries({ queryKey: getListActiveRoutesQueryKey() }),
          ]);
          onDeleted();
          onClose();
        },
        onError: (mutationError) => {
          const apiError = mutationError as Error & { data?: { error?: string } };
          setError(
            apiError.data?.error ??
              (mutationError instanceof Error
                ? mutationError.message
                : "Não foi possível excluir definitivamente a entrega."),
          );
        },
      },
    );
  };

  return createPortal(
    <div
      className="modal-backdrop"
      role="presentation"
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) requestClose();
      }}
    >
      <section
        className="modal-card"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="delete-delivery-title"
        aria-describedby="delete-delivery-confirmation"
        data-modal-active="true"
      >
        <div className="modal-header flex items-start justify-between gap-3 border-b border-border px-5 py-4 sm:px-6 sm:py-5">
          <div className="min-w-0">
            <div className="eyebrow text-red-700">EXCLUSÃO DEFINITIVA</div>
            <h2 id="delete-delivery-title" className="mt-1 text-xl font-bold">
              Excluir entrega {code}?
            </h2>
          </div>
          <button
            type="button"
            className="icon-button modal-close-button"
            onClick={requestClose}
            aria-label="Fechar"
            disabled={deleteDelivery.isPending}
          >
            <X size={18} />
          </button>
        </div>
        <div className="modal-form">
          <div className="modal-fields space-y-4 px-5 py-4 sm:px-6 sm:py-5">
            <p id="delete-delivery-confirmation" className="text-sm leading-relaxed text-foreground">
              Esta entrega será apagada para sempre e não aparecerá em nenhum relatório. Deseja continuar?
            </p>
            {error && (
              <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700" role="alert">
                {error}
              </p>
            )}
          </div>
          <div className="modal-form-actions flex flex-col-reverse gap-2 border-t border-border px-5 py-4 sm:flex-row sm:justify-end sm:px-6">
            <button
              type="button"
              className="button-secondary"
              onClick={requestClose}
              disabled={deleteDelivery.isPending}
            >
              Manter entrega
            </button>
            <button
              type="button"
              className="button-primary !bg-red-700 hover:!bg-red-800"
              onClick={submit}
              disabled={deleteDelivery.isPending}
              data-modal-initial-focus
              data-testid="button-confirm-delete-delivery"
            >
              <Trash2 size={15} />
              {deleteDelivery.isPending ? "Excluindo…" : "Excluir definitivamente"}
            </button>
          </div>
        </div>
      </section>
    </div>,
    document.body,
  );
}

function Dashboard({ canCancel, canDelete }: { canCancel: boolean; canDelete: boolean }) {
  const [showCreate, setShowCreate] = useState(false);
  const [selectedCourierId, setSelectedCourierId] = useState('');
  const [selectedRouteId, setSelectedRouteId] = useState('');
  const [dispatchId, setDispatchId] = useState<string | null>(null);
  const [selectedDeliveryIds, setSelectedDeliveryIds] = useState<string[]>([]);
  const [routeFeedback, setRouteFeedback] = useState<FeedbackMessage | null>(null);
  const [searchText, setSearchText] = useState('');
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [storeId, setStoreId] = useState('');
  const [cancelFeedback, setCancelFeedback] = useState<FeedbackMessage | null>(null);
  const [cancelTarget, setCancelTarget] = useState<{ id: string; code: string } | null>(null);
  const [deleteFeedback, setDeleteFeedback] = useState<FeedbackMessage | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; code: string } | null>(null);
  const qc = useQueryClient();
  const createDeliveryRoute = useCreateDeliveryRoute();
  const summary = useGetDashboardSummary({ query: { refetchInterval: 15000, refetchIntervalInBackground: false, refetchOnWindowFocus: true } });
  const stores = useListStores({ query: { queryKey: getListStoresQueryKey() } });
  const activeRoutes = useListActiveRoutes({ query: { queryKey: getListActiveRoutesQueryKey(), refetchInterval: 15000, refetchOnWindowFocus: true } });
  const couriers = useListCouriers(undefined, { query: { queryKey: getListCouriersQueryKey(), refetchInterval: 15000, refetchIntervalInBackground: false, refetchOnWindowFocus: true } });
  const params = useMemo(() => ({ ...(status ? { status } : {}), ...(search ? { search } : {}), ...(storeId ? { storeId } : {}) }), [status, search, storeId]);
  const deliveries = useListDeliveries(params, { query: { refetchInterval: 15000, refetchIntervalInBackground: false, refetchOnWindowFocus: true } });
  const [now, setNow] = useState(() => Date.now());
  const refreshDashboard = () => Promise.all([
    summary.refetch(),
    couriers.refetch(),
    deliveries.refetch(),
    activeRoutes.refetch(),
  ]);
  const refreshDashboardRef = useRef(refreshDashboard);
  refreshDashboardRef.current = refreshDashboard;
  useEffect(() => {
    const clock = window.setInterval(() => {
      if (document.visibilityState === "visible") setNow(Date.now());
    }, 1000);
    const refreshWhenVisible = () => {
      if (document.visibilityState === "visible") {
        setNow(Date.now());
        void refreshDashboardRef.current();
      }
    };
    document.addEventListener("visibilitychange", refreshWhenVisible);
    return () => {
      window.clearInterval(clock);
      document.removeEventListener("visibilitychange", refreshWhenVisible);
    };
  }, []);
  const runSearch = (e: FormEvent) => { e.preventDefault(); setSearch(searchText.trim()); };
  const invalidate = (id: string) => {
    void qc.invalidateQueries({ queryKey: getListDeliveriesQueryKey() });
    void qc.invalidateQueries({ queryKey: getGetDeliveryQueryKey(id) });
    void qc.invalidateQueries({ queryKey: getGetDashboardSummaryQueryKey() });
    void qc.invalidateQueries({ queryKey: getListCouriersQueryKey() });
    void qc.invalidateQueries({ queryKey: getGetDeliveryAnalyticsQueryKey() });
  };
  const toggleRouteDelivery = (id: string, checked: boolean) => {
    setRouteFeedback(null);
    setSelectedDeliveryIds(current => {
      if (!checked) return current.filter(item => item !== id);
      if (current.length >= 10) return current;
      return current.includes(id) ? current : [...current, id];
    });
  };
  const offerGroupedRoute = () => {
    setRouteFeedback(null);
    createDeliveryRoute.mutate({ data: { deliveryIds: selectedDeliveryIds } }, {
      onSuccess: result => {
        setSelectedDeliveryIds([]);
        setRouteFeedback({ kind: "success", text: `Rota ${result.id.slice(0, 8)} criada com ${result.deliveryCount} entregas. O motoboy verá e otimizará a sequência ao aceitar.` });
        void qc.invalidateQueries({ queryKey: getListDeliveriesQueryKey() });
        void qc.invalidateQueries({ queryKey: getGetDashboardSummaryQueryKey() });
      },
      onError: error => setRouteFeedback({ kind: "error", text: error instanceof Error ? error.message : 'Não foi possível criar a rota. Atualize a fila e tente novamente.' }),
    });
  };
  const counts = summary.data;
  const ageSeconds = (timestamp: string | null | undefined) => {
    if (!timestamp) return null;
    const parsed = Date.parse(timestamp);
    return Number.isFinite(parsed) ? Math.max(0, Math.floor((now - parsed) / 1000)) : null;
  };
  const formatAge = (age: number | null) =>
    age == null ? "sem horário" : age < 60 ? `${age}s` : `${Math.floor(age / 60)} min`;
  const allCouriers = couriers.data ?? [];
  const effectiveSelectedCourierId = allCouriers.some(courier => courier.id === selectedCourierId)
    ? selectedCourierId
    : '';
  const trackingCouriers = allCouriers.filter(
    courier =>
      (!effectiveSelectedCourierId || courier.id === effectiveSelectedCourierId) &&
      courier.currentLatitude != null &&
      courier.currentLongitude != null,
  );
  const latestLocationAge = trackingCouriers.reduce<number | null>((latest, courier) => {
    const age = ageSeconds(courier.lastLocationAt);
    return age != null && (latest == null || age < latest) ? age : latest;
  }, null);
  const hasLiveLocation = latestLocationAge != null && latestLocationAge <= 120;
  const hasConnectionError = [summary, couriers, deliveries].some(query => query.isError);
  const trackingMarkers: MapMarker[] = trackingCouriers.map(courier => {
    const age = ageSeconds(courier.lastLocationAt);
    const stale = age == null || age > 120;
    return {
      id: courier.id,
      latitude: courier.currentLatitude!,
      longitude: courier.currentLongitude!,
      title: courier.name,
      detail: stale
        ? `Sinal perdido — última posição há ${formatAge(age)}`
        : `${courier.currentDeliveryCode ? `Entrega ${courier.currentDeliveryCode} · ` : ''}Atualizado há ${formatAge(age)}`,
      kind: 'courier',
      label: courier.name.split(' ')[0],
      stale,
    };
  });
  const storeMarkers: MapMarker[] = (stores.data ?? [])
    .filter(store => store.latitude != null && store.longitude != null)
    .map(store => ({
      id: store.id,
      latitude: store.latitude!,
      longitude: store.longitude!,
      title: store.name,
      detail: `${store.city}${store.stateCode ? ` · ${store.stateCode}` : ''}`,
      kind: 'store',
    }));
  const activeRouteList = activeRoutes.data ?? [];
  const selectedRoute = activeRouteList.find(route => route.id === selectedRouteId) ?? activeRouteList[0];
  const mapMarkers = [...trackingMarkers, ...storeMarkers];
  return <div className="soft-enter">
    <div className="mb-6 flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
        <div><div className="eyebrow">VISÃO GERAL · REDE MINAS MAIS</div><h1 className="mt-2 text-[28px] font-bold tracking-[-.045em] sm:text-[34px]">Central de entregas</h1><p className="mt-1 text-sm text-muted-foreground">Acompanhe pedidos, disponibilidade e despacho em um só lugar.</p><p className="mt-2 text-[11px] text-muted-foreground">Atualização automática a cada 15 segundos.</p></div>
      <div className="flex flex-wrap gap-2 self-start sm:self-auto">
        {selectedDeliveryIds.length >= 2 && <button className="button-secondary h-10" onClick={offerGroupedRoute} disabled={createDeliveryRoute.isPending} data-testid="button-create-route"><Bike size={16}/>{createDeliveryRoute.isPending ? 'Criando rota…' : `Agrupar ${selectedDeliveryIds.length} entregas`}</button>}
         {selectedDeliveryIds.length > 0 && <button className="button-quiet h-10" onClick={() => { setSelectedDeliveryIds([]); setRouteFeedback(null); }}>Limpar seleção ({selectedDeliveryIds.length})</button>}
        <button className="button-secondary h-10" onClick={() => void refreshDashboard()} disabled={summary.isRefetching || couriers.isRefetching || deliveries.isRefetching} aria-label="Atualizar painel" data-testid="button-refresh-dashboard"><RefreshCw size={15} className={summary.isRefetching || couriers.isRefetching || deliveries.isRefetching ? 'animate-spin' : ''}/>Atualizar</button>
        <button className="button-primary h-10" onClick={() => setShowCreate(true)} data-testid="button-new-delivery"><FilePlus2 size={16}/>Nova entrega</button>
      </div>
    </div>
    <section className="metric-grid mb-6">
       <Metric title="Pedidos em operação" value={counts?.requested} hint="solicitações ativas agora" icon={<PackageCheck size={17}/>} loading={summary.isLoading}/>
      <Metric title="Aguardando entregador" value={counts?.awaitingCourier} hint={`${counts?.offered ?? '—'} ofertas enviadas`} icon={<Clock3 size={17}/>} accent loading={summary.isLoading}/>
      <Metric title="Em rota" value={counts?.inTransit} hint={`${counts?.delayed ?? '—'} com atraso`} icon={<Truck size={17}/>} loading={summary.isLoading}/>
      <Metric title="Entregadores" value={counts?.totalCouriers} hint={counts ? `${counts.availableCouriers} disponíveis · ${counts.busyCouriers} em atendimento · ${counts.offlineCouriers} offline` : 'cadastros no sistema'} icon={<Bike size={17}/>} loading={summary.isLoading}/>
    </section>
    {summary.isError && <div className="mb-5 flex items-center justify-between rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800"><span>Não foi possível carregar o resumo operacional.</span><button className="inline-flex items-center gap-1 font-semibold" onClick={() => void summary.refetch()}><RefreshCw size={14}/>Tentar novamente</button></div>}
    {hasConnectionError && <div className="mb-5 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900" role="status">Reconectando… os dados atuais permanecem visíveis e o painel tentará novamente automaticamente.</div>}
    <CancellationAlertsPanel />
    <section className="mb-6 grid gap-4 lg:grid-cols-[1fr_300px]">
      <div className="panel p-4 sm:p-5">
        <div className="mb-4 flex items-center justify-between"><div><div className="eyebrow">TEMPO DE ATENDIMENTO</div><h2 className="mt-1 text-sm font-bold">Ritmo da operação</h2></div><span className="rounded-md bg-[#f5f4f2] px-2 py-1 text-[10px] font-medium text-muted-foreground">média registrada</span></div>
        {summary.isLoading ? <div className="skeleton h-[76px] w-full"/> : <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
          <div className="flex-1"><div className="flex items-baseline justify-between"><span className="text-xs text-muted-foreground">Aceite da oferta</span><strong className="mono text-xl">{counts?.averageAcceptanceMinutes ?? '—'}{counts && <small className="ml-1 text-[10px] font-normal text-muted-foreground">{counts.averageAcceptanceMinutes == null ? 'sem dados ainda' : 'min'}</small>}</strong></div>{counts?.averageAcceptanceMinutes != null && <div className="meter mt-2"><span style={{ width: `${Math.min(counts.averageAcceptanceMinutes * 4, 100)}%` }}/></div>}</div>
          <div className="hidden h-10 w-px bg-border sm:block"/>
          <div className="flex-1"><div className="flex items-baseline justify-between"><span className="text-xs text-muted-foreground">Conclusão total</span><strong className="mono text-xl">{counts?.averageTotalMinutes ?? '—'}{counts && <small className="ml-1 text-[10px] font-normal text-muted-foreground">{counts.averageTotalMinutes == null ? 'sem dados ainda' : 'min'}</small>}</strong></div>{counts?.averageTotalMinutes != null && <div className="meter mt-2"><span className="meter-gray" style={{ width: `${Math.min(counts.averageTotalMinutes * 1.5, 100)}%` }}/></div>}</div>
        </div>}
      </div>
      <div className="panel flex items-center gap-4 p-4 sm:px-5"><div className="courier-pie"><Bike size={20}/></div><div className="min-w-0 flex-1"><div className="eyebrow">DISPONIBILIDADE</div><div className="mt-1 flex items-baseline gap-1"><strong className="mono text-2xl">{counts?.availableCouriers ?? '—'}</strong><span className="text-xs text-muted-foreground">disponíveis agora</span></div><div className="mt-1 text-[11px] text-muted-foreground">{counts ? `${counts.busyCouriers} em atendimento · ${counts.offlineCouriers} offline` : 'Carregando situação dos motoboys'}</div></div><ArrowRight size={16} className="text-muted-foreground"/></div>
    </section>
    <section className="mb-6 grid gap-4 lg:grid-cols-[1.45fr_1fr]">
      <div className="panel overflow-hidden">
        <div className="flex flex-col gap-3 border-b border-border px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-5">
          <div><div className="eyebrow">ACOMPANHAMENTO</div><h2 className="mt-1 text-sm font-bold">Mapa de rastreamento</h2></div>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <label className="sr-only" htmlFor="track-courier">Selecionar motoboy para acompanhar</label>
            <select
              id="track-courier"
              className="filter-select w-full sm:w-auto"
              value={effectiveSelectedCourierId}
              onChange={event => setSelectedCourierId(event.target.value)}
              aria-label="Selecionar motoboy para acompanhar"
            >
              <option value="">Todos os motoboys</option>
              {allCouriers.map(courier => <option key={courier.id} value={courier.id}>{courier.name}</option>)}
            </select>
            {activeRouteList.length > 0 && <select className="filter-select w-full sm:w-auto" value={selectedRoute?.id ?? ''} onChange={event => setSelectedRouteId(event.target.value)} aria-label="Selecionar rota ativa">
              {activeRouteList.map(route => <option key={route.id} value={route.id}>Rota · {route.courierFirstName}</option>)}
            </select>}
            <div className="flex items-center gap-2">
              <span className={`online-indicator ${hasLiveLocation ? '' : 'online-indicator--offline'}`}><i className={hasLiveLocation ? 'animate-pulse' : ''}/>{hasLiveLocation ? 'Ao vivo' : 'Nenhum motoboy online'}</span>
              <span className="text-[10px] text-muted-foreground">{latestLocationAge == null ? 'Aguardando GPS' : `GPS recebido há ${formatAge(latestLocationAge)}`}</span>
            </div>
          </div>
        </div>
        {couriers.isLoading || stores.isLoading || activeRoutes.isLoading ? <div className="skeleton m-4 h-[400px] sm:h-[460px]"/> : mapMarkers.length || selectedRoute?.routeGeometry.length ? (
          <>
            <div className="flex flex-wrap gap-4 px-4 pt-3 text-[11px] text-muted-foreground sm:px-5">
              <span className="inline-flex items-center gap-1.5"><span className="grid h-5 w-5 place-items-center rounded-full bg-[#16804a] text-[10px] font-bold text-white">F</span>Filial</span>
              <span className="inline-flex items-center gap-1.5"><span className="grid h-5 w-5 place-items-center rounded-full bg-[#1769aa] text-[10px] font-bold text-white">M</span>Motoboy</span>
              <span className="inline-flex items-center gap-1.5"><span className="grid h-5 w-5 place-items-center rounded-full bg-gray-500 text-[10px] font-bold text-white">M</span>Sinal perdido</span>
            </div>
            {!trackingMarkers.length && !selectedRoute && <p className="mx-4 mt-3 rounded-lg border border-dashed border-[#dedbd7] bg-[#faf9f7] px-3 py-2 text-xs text-muted-foreground sm:mx-5">Sem GPS ou rota ativa no momento. O mapa está exibindo somente as filiais cadastradas.</p>}
            {selectedRoute && !selectedRoute.routeGeometry.length && <p className="mx-4 mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900 sm:mx-5">Rota ativa de {selectedRoute.courierFirstName}, mas a geometria ainda não está disponível.</p>}
            {selectedRoute && <p className="px-4 pt-3 text-xs font-semibold text-[#a91d2a]">Rota ativa de {selectedRoute.courierFirstName} · {selectedRoute.routeGeometry.length} pontos</p>}
            <LiveMap markers={mapMarkers} routeGeometry={selectedRoute?.routeGeometry} ariaLabel="Localização das filiais, motoboys e rota ativa" showCenterControls centerOnStoresOnly showCenterOnMe={false} controlsAboveAttribution/>
          </>
        ) : (
          <div className="grid min-h-[210px] place-items-center bg-[#f3f2ef] p-6 text-center">
            <div className="max-w-md">
              <span className="mx-auto grid h-11 w-11 place-items-center rounded-full bg-white text-primary shadow-sm"><MapPin size={20}/></span>
              <h3 className="mt-3 text-sm font-semibold">{effectiveSelectedCourierId ? `Aguardando GPS de ${allCouriers.find(courier => courier.id === effectiveSelectedCourierId)?.name ?? 'motoboy selecionado'}` : 'Sem GPS ou rota ativa'}</h3>
              <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{activeRoutes.isError ? 'Não foi possível consultar as rotas ativas.' : 'Não há posições GPS com coordenadas nem geometria de rota disponíveis neste momento.'}</p>
            </div>
          </div>
        )}
      </div>
      <div className="panel overflow-hidden">
        <div className="border-b border-border px-4 py-4 sm:px-5"><div className="eyebrow">SINAL DE LOCALIZAÇÃO</div><h2 className="mt-1 text-sm font-bold">Último registro recebido</h2></div>
        {couriers.isLoading ? <Skeleton rows={3}/> : couriers.isError ? <p className="p-5 text-sm text-muted-foreground">Não foi possível consultar os registros de localização.</p> : !couriers.data?.length ? <EmptyState title="Sem entregadores cadastrados" detail="Os registros aparecerão aqui quando houver entregadores."/> :
          <ul className="divide-y divide-border">{couriers.data.map(c => {
            const age = ageSeconds(c.lastLocationAt);
            const lostSignal = age == null || age > 120;
            const hasCoordinates = c.currentLatitude != null && c.currentLongitude != null;
            const statusLabel = lostSignal ? 'Sem sinal' : c.status === 'BUSY' ? 'Em atendimento' : 'Disponível';
            return <li key={c.id} className="flex items-center gap-3 px-4 py-3 sm:px-5"><span className={`avatar ${lostSignal ? 'bg-gray-100 text-gray-500' : ''}`}>{c.initials}</span><div className="min-w-0 flex-1"><div className="truncate text-xs font-semibold">{c.name}</div><div className="mt-1 text-[10px] text-muted-foreground">{lostSignal && hasCoordinates ? `Sinal perdido — última posição há ${formatAge(age)}` : hasCoordinates ? `GPS recebido há ${formatAge(age)}` : 'Aguardando primeira posição GPS'}{c.currentDeliveryCode ? ` · ${c.currentDeliveryCode}` : ''}</div></div><Badge tone={lostSignal ? 'muted' : c.status === 'BUSY' ? 'blue' : 'green'}>{statusLabel}</Badge></li>;
          })}</ul>}
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
      {routeFeedback && <AutoDismissFeedback feedback={routeFeedback} onDismiss={() => setRouteFeedback(null)} className="mx-4 mb-3"/>}
      {cancelFeedback && <AutoDismissFeedback feedback={cancelFeedback} onDismiss={() => setCancelFeedback(null)} className="mx-4 mb-3"/>}
      {deleteFeedback && <AutoDismissFeedback feedback={deleteFeedback} onDismiss={() => setDeleteFeedback(null)} className="mx-4 mb-3"/>}
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
              <td className="text-right"><div className="flex justify-end gap-1.5">{['REQUESTED','AWAITING_COURIER'].includes(d.status) && <button className="button-small button-red-outline" onClick={() => setDispatchId(d.id)} data-testid={`button-dispatch-${d.id}`}>Despachar</button>}{canCancel && !['COMPLETED','CANCELLED'].includes(d.status) && <button className="button-small button-red-outline" type="button" onClick={() => { setCancelFeedback(null); setCancelTarget({ id: d.id, code: d.code }); }} aria-label={`Cancelar pedido ${d.code}`} title="Cancelar pedido" data-testid={`button-cancel-${d.id}`}><X size={14}/>Cancelar pedido</button>}{canDelete && <button className="button-small button-red-outline" type="button" onClick={() => { setDeleteFeedback(null); setDeleteTarget({ id: d.id, code: d.code }); }} aria-label={`Excluir definitivamente ${d.code}`} title="Excluir definitivamente" data-testid={`button-delete-delivery-${d.id}`}><Trash2 size={14}/>Excluir definitivamente</button>}<Link href={`/deliveries/${d.id}`} className="icon-button-sm" aria-label={`Abrir ${d.code}`}><ArrowRight size={15}/></Link></div></td>
            </tr>)}</tbody>
          </table></div>}
    </section>
     <div className="mt-4 flex items-center justify-between text-[11px] text-muted-foreground"><span>Atualizações refletem os registros disponíveis no sistema.</span><span className="inline-flex items-center gap-1"><Clock3 size={12}/>GPS atualizado a cada 15 segundos enquanto o PWA está aberto</span></div>
    {showCreate && <DeliveryModal onClose={() => setShowCreate(false)}/>}
    {dispatchId && <DispatchModal deliveryId={dispatchId} onClose={() => setDispatchId(null)}/>}
    {cancelTarget && <CancelDeliveryModal
      deliveryId={cancelTarget.id}
      code={cancelTarget.code}
      onClose={() => setCancelTarget(null)}
      onCancelled={() => {
        setSelectedDeliveryIds((current) => current.filter((id) => id !== cancelTarget.id));
        setCancelFeedback({
          kind: "success",
          text: `Pedido ${cancelTarget.code} cancelado pela Central. O histórico foi preservado.`,
        });
      }}
    />}
    {deleteTarget && <DeleteDeliveryModal
      deliveryId={deleteTarget.id}
      code={deleteTarget.code}
      onClose={() => setDeleteTarget(null)}
      onDeleted={() => {
        setSelectedDeliveryIds((current) =>
          current.filter((id) => id !== deleteTarget.id),
        );
        setDeleteFeedback({
          kind: "success",
          text: `Entrega ${deleteTarget.code} excluída definitivamente.`,
        });
      }}
    />}
  </div>;
}
function Metric({ title, value, hint, icon, accent, loading }: { title: string; value?: number | string; hint: string; icon: ReactNode; accent?: boolean; loading?: boolean }) {
  return <div className={`metric-card panel p-4 sm:p-5 ${accent ? 'metric-accent' : ''}`}><div className="flex items-start justify-between"><span className="text-xs font-semibold text-muted-foreground">{title}</span><span className={`metric-icon ${accent ? 'metric-icon-red' : ''}`}>{icon}</span></div>{loading ? <div className="skeleton mt-3 h-8 w-20"/> : <div className="mono mt-2 text-[30px] font-semibold leading-none tracking-[-.08em]">{value ?? '—'}</div>}<div className="mt-2 text-[11px] text-muted-foreground">{hint}</div></div>;
}

function DeliveryDetail() {
  const [, params] = useRoute('/deliveries/:deliveryId');
  const id = params?.deliveryId ?? '';
  const { data, isLoading, isError, refetch } = useGetDelivery(id, { query: { enabled: !!id, queryKey: getGetDeliveryQueryKey(id), refetchInterval: 15000 } });
  const couriers = useListCouriers(undefined, { query: { queryKey: getListCouriersQueryKey(), refetchInterval: 15000 } });
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
    void qc.invalidateQueries({ queryKey: getGetDeliveryAnalyticsQueryKey() });
  };
  const applyStatus = () => {
    if (!nextStatus || !data) return;
    if (nextStatus === "COMPLETED") return;
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
            {nextStatus !== "COMPLETED" && <button className="button-secondary" disabled={!nextStatus || updateStatus.isPending} onClick={applyStatus}>{updateStatus.isPending ? 'Salvando…' : 'Aplicar'}</button>}
          </div>
        </div>
        {nextStatus === "COMPLETED" && <div className="mt-4 max-w-md"><EvidencePhotoAction deliveryId={id} label="Enviar foto e concluir entrega" onComplete={async (evidencePath) => {
          await updateStatus.mutateAsync({ deliveryId: id, data: { status: "COMPLETED", evidencePath } });
          refresh();
          setNextStatus("");
        }} /></div>}
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
              <div className="mt-5 grid gap-3 rounded-lg bg-[#f7f6f4] p-3 sm:grid-cols-3">
                <Info label="Chegada à loja" value={fmtTime(data.events.find(event => /arriv|chegad|at_store/i.test(`${event.kind} ${event.label}`))?.timestamp)} />
                <Info label="Saída da loja" value={fmtTime(data.events.find(event => /depart|sa[ií]d|in_transit/i.test(`${event.kind} ${event.label}`))?.timestamp)} />
                <Info label="Entrega concluída" value={fmtTime(data.events.find(event => /complet|conclu[ií]d/i.test(`${event.kind} ${event.label}`))?.timestamp)} />
              </div>
              {data.evidenceAvailable && <a className="button-secondary mt-4 min-h-10" href={`${basePath}/api/deliveries/${data.id}/evidence`} target="_blank" rel="noreferrer" data-testid={`link-evidence-${data.id}`}><PackageCheck size={15}/>Abrir foto de comprovação</a>}
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
              {['REQUESTED','AWAITING_COURIER'].includes(data.status) && <div className="mt-4"><label className="eyebrow" htmlFor="quick-courier">OFERTA INDIVIDUAL</label><div className="mt-2 flex gap-2"><select id="quick-courier" className="filter-select min-w-0 flex-1" defaultValue=""><option value="">Escolher motoboy</option>{(couriers.data ?? []).map(c => <option key={c.id} value={c.id} disabled={c.status === 'BUSY'}>{c.name} · {c.status === 'AVAILABLE' ? 'Disponível' : c.status === 'OFFLINE' ? 'Offline' : 'Em atendimento'}</option>)}</select><button className="button-secondary" onClick={e => { const select = e.currentTarget.previousElementSibling as HTMLSelectElement; if (select.value) singleDispatch(select.value); else setActionError('Selecione um motoboy que não esteja em atendimento.'); }} disabled={dispatch.isPending}>Enviar</button></div></div>}
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
      <Link className="button-secondary mt-5" href="/account"><KeyRound size={15}/> Configurar senha</Link>
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

function AccountRoute() {
  const auth = useUser();
  if (!auth.isLoaded) return <ProfileLoading />;
  if (!auth.isSignedIn) return <Redirect to="/" />;
  return <AccountSecurityPage />;
}

function UserPortalRoute() {
  const { auth, profile } = useSignedInProfile();
  if (!auth.isLoaded || (auth.isSignedIn && profile.isLoading)) return <ProfileLoading />;
  if (!auth.isSignedIn) return <Redirect to="/" />;
  if (profile.isError || !profile.data) return <ProfileError retry={() => void profile.refetch()} />;
  if (profile.data.role === 'PENDING') return <PendingApproval profile={profile.data} />;
  if (profile.data.role === 'COURIER') {
    return (
      <NativeCourierSetupGate userId={profile.data.id}>
        <CourierPortal profile={profile.data} />
      </NativeCourierSetupGate>
    );
  }
  if (profile.data.role === 'STORE_MANAGER' || profile.data.role === 'STORE_STAFF') {
    return <StorePortal profile={profile.data} />;
  }
  return <RoutedErrorBoundary><AppShell profile={profile.data}><Dashboard canCancel={profile.data.role === 'ADMIN' || profile.data.role === 'CENTRAL'} canDelete={profile.data.role === 'ADMIN'} /></AppShell></RoutedErrorBoundary>;
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
    appearance={isNativeApp ? nativeClerkAppearance : clerkAppearance}
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
      <NativeApiAuthBridge />
      <NativeConnectivityGuard />
      <ClerkQueryClientCacheInvalidator />
      <TooltipProvider>
        <Switch>
          <Route path="/" component={HomeRedirect}/>
          <Route path="/user-portal" component={UserPortalRoute}/>
          <Route path="/account" component={AccountRoute}/>
          <Route path="/motoboy-pwa" component={CourierAccessPage}/>
          <Route path="/deliveries/:deliveryId" component={() => <CentralRoute><DeliveryDetail/></CentralRoute>}/>
          <Route path="/access" component={() => <CentralRoute adminOnly><AccessManagement/></CentralRoute>}/>
          <Route path="/filiais" component={() => <CentralRoute adminOnly><StoreManagement/></CentralRoute>}/>
          <Route path="/reports" component={() => <CentralRoute><Reports/></CentralRoute>}/>
          <Route path="/sign-in/*?" component={SignInPage}/>
          <Route path="/sign-up/*?" component={SignUpPage}/>
          <Route component={NotFound}/>
        </Switch>
        <Toaster/>
      </TooltipProvider>
    </QueryClientProvider>
  </ClerkProvider>;
}

function NativeApiAuthBridge() {
  const { getToken } = useAuth();
  const queryClient = useQueryClient();
  const getTokenRef = useRef(getToken);
  getTokenRef.current = getToken;

  useEffect(() => {
    if (!isNativeApp) return;
    setAuthTokenGetter(() => getTokenRef.current());
    void queryClient.invalidateQueries();
    return () => setAuthTokenGetter(null);
  }, [queryClient]);

  return null;
}

function NativeConnectivityGuard() {
  const [offline, setOffline] = useState(false);

  useEffect(() => {
    if (!isNativeApp) return;
    let mounted = true;
    let listener: { remove: () => Promise<void> } | undefined;
    void Network.getStatus()
      .then((status) => {
        if (mounted) setOffline(!status.connected);
      })
      .catch(() => undefined);
    void Network.addListener('networkStatusChange', (status) => {
      if (mounted) setOffline(!status.connected);
    }).then((nextListener) => {
      if (mounted) listener = nextListener;
      else void nextListener.remove();
    });
    return () => {
      mounted = false;
      void listener?.remove();
    };
  }, []);

  if (!offline) return null;
  return (
    <div className="fixed inset-0 z-[100] grid place-items-center bg-[#f4f3f1] p-5">
      <section className="panel w-full max-w-sm p-6 text-center" role="alert" aria-live="assertive">
        <div className="mx-auto grid h-12 w-12 place-items-center rounded-2xl bg-[#a91d2a] text-sm font-bold text-white">MM</div>
        <h1 className="mt-4 text-lg font-bold">Sem conexão</h1>
        <p className="mt-2 text-sm text-muted-foreground">Sem conexão — tentando novamente. Confira a internet do aparelho.</p>
        <button className="button-primary mt-5 min-h-10" type="button" onClick={() => window.location.reload()}>
          Tentar novamente
        </button>
      </section>
    </div>
  );
}

function App() {
  return <WouterRouter base={basePath}><ClerkRoutes/></WouterRouter>;
}
export default App;
