import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
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
  useUpdateDelivery,
  useRemoveDeliveryFromRoute,
  useUngroupDeliveryRoute,
  useUpdateDeliveryStatus,
  type AppUser,
  type Delivery,
} from '@workspace/api-client-react';
import {
  ArrowLeft, ArrowRight, Bike, Clock3, FilePlus2, Filter,
  History, MapPin, PackageCheck, Phone, Plus, Search, ShieldCheck,
  Truck, UserRound, X, AlertTriangle, RefreshCw, KeyRound, Trash2, Pencil,
} from 'lucide-react';
import { Link, Redirect, Route, Router as WouterRouter, Switch, useLocation, useRoute } from 'wouter';
import { ErrorBoundary } from '@/components/error-boundary';
import { AutoDismissFeedback, type FeedbackMessage } from '@/components/auto-dismiss-feedback';
import { Badge, StatusBadge, statusNames } from '@/components/delivery-status';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import NotFound from '@/pages/not-found';
import AccessManagement from '@/pages/access-management';
import CourierPortal from '@/pages/courier-portal';
import LiveMap, { type MapMarker } from '@/components/live-map';
import DeliveryAddressFields from '@/components/delivery-address-fields';
import PaymentFields, { emptyPayment, paymentPayload, type PaymentFormValue } from '@/components/payment-fields';
import { paymentLabel } from '@/lib/payment';
import DeliveryProgress from '@/components/delivery-progress';
import RequeueButton, { REQUEUE_STATUSES } from '@/components/requeue-button';
import CourierAccessPage from '@/pages/courier-access';
import StorePortal from '@/pages/store-portal';
import StoreManagement from '@/pages/store-management';
import DevPanel from '@/pages/dev-panel';
import Reports from '@/pages/reports';
import EvidencePhotoAction from '@/components/evidence-photo-action';
import EvidencePhotoViewer from '@/components/evidence-photo-viewer';
import AccountSecurityPage from '@/pages/account-security';
import CancellationAlertsPanel from '@/components/cancellation-alerts-panel';
import { ActiveCouriers, LiveChip, OperationAlerts, OperationMap, useOperationsData } from '@/components/admin/overview';
import { Indicator } from '@/components/admin/admin-ui';
import { courierMetrics, deliveryMetrics } from '@/lib/operations';
import { Capacitor } from '@capacitor/core';
import { Network } from '@capacitor/network';
import NativeCourierSetupGate from '@/components/native-courier-setup';
import { AuthProvider, useAuth } from '@/lib/auth';
import { AcceptInvitePage, ForgotPasswordPage, InviteLinkRedirect, PasswordRecoveryRedirect, ResetPasswordPage, SignInPage, SignUpPage } from '@/pages/auth-pages';
import AdminShell from '@/components/admin/admin-shell';
import { PublicSupportButton } from '@/components/support-button';
import StoreAccountingPage from '@/pages/store-accounting';
import { CouriersPage } from '@/components/admin/admin-pages';

const queryClient = new QueryClient();
const basePath = import.meta.env.BASE_URL.replace(/\/$/, '');
const isNativeApp = Capacitor.isNativePlatform();
const nativeApiBaseUrl = (
  import.meta.env.VITE_NATIVE_API_BASE_URL || 'https://minas-mais-entregas.vercel.app'
).replace(/\/+$/, '');
if (isNativeApp) setBaseUrl(nativeApiBaseUrl);
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
  const { isLoaded, isSignedIn } = useAuth();
  if (!isLoaded) return <ProfileLoading />;
  return isSignedIn ? <UserPortalRoute /> : <LandingPage />;
}
// Aceitar é sempre do motoboy (quem aceitar primeiro leva). Chegada e retirada são um passo só.
const statusOptions: Record<string, string[]> = {
  REQUESTED: [],
  OFFERED: [],
  ACCEPTED: ['IN_TRANSIT'],
  TO_STORE: ['IN_TRANSIT'],
  AT_STORE: ['IN_TRANSIT'],
  IN_TRANSIT: ['COMPLETED'],
};
/** Entrega esperando um motoboy aceitar (pode entrar numa rota agrupada). */
const waitingForCourier = (d: { status: string; courierId?: string | null; routeId?: string | null }) =>
  !d.routeId && (d.status === 'REQUESTED' || d.status === 'AWAITING_COURIER' || (d.status === 'OFFERED' && !d.courierId));
const fmtTime = (value?: string | null) => value ? new Date(value).toLocaleString('pt-BR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—';
const timeAgo = (value?: string | null) => {
  if (!value) return 'Localização indisponível';
  const mins = Math.max(0, Math.round((Date.now() - new Date(value).getTime()) / 60000));
  return mins < 1 ? 'GPS agora' : `GPS há ${mins} min`;
};
/** Última posição conhecida: a da entrega ou, se ela não tiver, a do motoboy atribuído (atualizada a cada 15 s). */
const lastKnownLocationAt = (
  delivery: { lastLocationAt?: string | null; courierId?: string | null },
  couriers?: { id: string; lastLocationAt?: string | null }[],
) => delivery.lastLocationAt ?? couriers?.find(c => c.id === delivery.courierId)?.lastLocationAt ?? null;

function Skeleton({ rows = 4 }: { rows?: number }) {
  return <div className="space-y-3 p-5" aria-label="Carregando"><div className="skeleton h-5 w-40" />{Array.from({ length: rows }, (_, i) => <div key={i} className="skeleton h-12 w-full" />)}</div>;
}
function EmptyState({ title, detail, action }: { title: string; detail: string; action?: ReactNode }) {
  return <div className="flex min-h-56 flex-col items-center justify-center px-5 text-center">
    <span className="mb-3 grid h-11 w-11 place-items-center rounded-xl bg-[#f7eeee] text-primary"><PackageCheck size={20} /></span>
    <h3 className="font-semibold text-[15px]">{title}</h3><p className="mt-1 max-w-sm text-sm text-muted-foreground">{detail}</p>{action && <div className="mt-4">{action}</div>}
  </div>;
}
function DeliveryModal({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const storesQuery = useListStores({ query: { queryKey: getListStoresQueryKey() } });
  const create = useCreateDelivery();
  const [error, setError] = useState('');
  const [customerCoordinates, setCustomerCoordinates] = useState<{ latitude: number | null; longitude: number | null }>({ latitude: null, longitude: null });
  const [form, setForm] = useState({ customerName: '', customerPhone: '', destination: '', orderNumber: '', notes: '', storeId: '', priority: 'normal' });
  const [requiresPrescription, setRequiresPrescription] = useState(false);
  const [payment, setPayment] = useState<PaymentFormValue>(emptyPayment);
  const selectedStore = (storesQuery.data ?? []).find(store => store.id === form.storeId);
  // Gerente (ou operação com uma filial só): a unidade já vem escolhida.
  const activeStores = (storesQuery.data ?? []).filter(store => store.active);
  const onlyStoreId = activeStores.length === 1 ? activeStores[0]!.id : '';
  useEffect(() => {
    if (onlyStoreId && !form.storeId) setForm(prev => ({ ...prev, storeId: onlyStoreId }));
  }, [onlyStoreId, form.storeId]);
  const update = (key: string, value: string) => {
    setForm(prev => ({ ...prev, [key]: value }));
  };
  const hasUnsavedChanges = Boolean(
    form.customerName.trim() ||
    form.customerPhone.trim() ||
    form.destination.trim() ||
    form.orderNumber.trim() ||
    form.notes.trim() ||
    (form.storeId && form.storeId !== onlyStoreId) ||
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
    if (!payment.prepaid && !payment.paymentMethod) { setError('Escolha a forma de pagamento: cartão, Pix ou dinheiro (ou marque "Já está pago").'); return; }
    create.mutate({ data: { ...form, ...paymentPayload(payment), requiresPrescription, customerLatitude: customerCoordinates.latitude, customerLongitude: customerCoordinates.longitude, priority: form.priority as 'normal' | 'urgent' } }, {
      onSuccess: () => {
        void qc.invalidateQueries({ queryKey: getListDeliveriesQueryKey() });
        void qc.invalidateQueries({ queryKey: getGetDashboardSummaryQueryKey() });
        void qc.invalidateQueries({ queryKey: getGetDeliveryAnalyticsQueryKey() });
        onClose();
      },
      onError: (mutationError) => {
        const apiError = mutationError as Error & { data?: { error?: string } };
        setError(apiError.data?.error ?? 'Não foi possível registrar. Confira os dados e tente novamente.');
      },
    });
  };
  return createPortal(
    <div className="modal-backdrop" role="presentation" onPointerDown={e => { if (e.target === e.currentTarget) requestClose(); }}>
    <section className="modal-card" role="dialog" aria-modal="true" aria-labelledby="new-delivery-title" data-modal-active="true">
      <div className="modal-header flex items-start justify-between gap-3 border-b border-border px-5 py-4 sm:px-6 sm:py-5"><div className="min-w-0"><div className="eyebrow">NOVO PEDIDO</div><h2 id="new-delivery-title" className="mt-1 text-xl font-bold tracking-tight">Registrar entrega</h2><p className="mt-1 text-sm text-muted-foreground">Ao registrar, a entrega vai direto para os motoboys da cidade. Quem aceitar primeiro leva.</p></div><button type="button" className="icon-button modal-close-button" onClick={requestClose} aria-label="Fechar" disabled={create.isPending}><X size={18}/></button></div>
      <form onSubmit={submit} className="modal-form">
        <div className="modal-fields space-y-4 px-5 py-4 sm:px-6 sm:py-5">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Nome do cliente"><input required minLength={2} value={form.customerName} onChange={e => update('customerName', e.target.value)} placeholder="Nome completo" data-modal-initial-focus data-testid="input-customer-name"/></Field>
          <Field label="Telefone"><input type="tel" value={form.customerPhone} onChange={e => update('customerPhone', e.target.value)} placeholder="(31) 99999-0000" data-testid="input-customer-phone"/></Field>
        </div>
        <DeliveryAddressFields
          idPrefix="new-delivery"
          destinationTestId="input-destination"
          onChange={value => {
            setForm(prev => ({ ...prev, destination: value.destination }));
            setCustomerCoordinates({ latitude: value.latitude, longitude: value.longitude });
          }}
        />
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Número do pedido"><input required value={form.orderNumber} onChange={e => update('orderNumber', e.target.value)} placeholder="Ex.: 48271" data-testid="input-order-number"/></Field>
          <Field label="Unidade">{onlyStoreId && selectedStore
            ? <input readOnly aria-readonly="true" className="bg-[#f7f6f4]" value={`${selectedStore.name} · ${selectedStore.city}`} data-testid="text-store-fixed"/>
            : <select required value={form.storeId} onChange={e => update('storeId', e.target.value)} data-testid="select-store"><option value="">Selecione uma unidade</option>{(storesQuery.data ?? []).filter(s => s.active).map(s => <option key={s.id} value={s.id}>{s.name} · {s.city}</option>)}</select>}</Field>
        </div>
        <Field label="Tarifa da filial (R$)"><input type="text" readOnly value={selectedStore ? selectedStore.deliveryFee.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }) : 'Selecione uma filial'} aria-label="Tarifa definida pela filial" data-testid="text-delivery-fee"/></Field>
        {storesQuery.isLoading && <p className="text-xs text-muted-foreground">Carregando unidades disponíveis…</p>}
        {storesQuery.isError && <p className="text-xs text-destructive">Não foi possível carregar as unidades. Reabra o formulário para tentar novamente.</p>}
        <PaymentFields idPrefix="new-delivery" value={payment} onChange={setPayment} deliveryFee={selectedStore?.deliveryFee} />
        <Field label="Observações"><textarea rows={2} value={form.notes} onChange={e => update('notes', e.target.value)} placeholder="Referências úteis para a entrega" data-testid="input-notes"/></Field>
        <label className="flex min-h-12 cursor-pointer items-start gap-3 rounded-lg border border-border bg-[#faf9f7] px-3 py-3"><input type="checkbox" className="mt-0.5 !h-5 !min-h-0 !w-5 shrink-0 !p-0 accent-[#b91e2c]" checked={requiresPrescription} onChange={e => setRequiresPrescription(e.target.checked)} data-testid="checkbox-requires-prescription"/><span className="min-w-0 flex-1"><span className="block text-sm font-semibold text-[#2b2e33]">Medicamento com receita</span><span className="mt-0.5 block text-xs text-muted-foreground">O motoboy precisa pegar a receita com o cliente e confirmar no app antes de concluir.</span></span></label>
        {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
        </div>
        <div className="modal-form-actions flex flex-col-reverse gap-2 border-t border-border px-5 py-4 sm:flex-row sm:justify-end sm:px-6"><button type="button" className="button-secondary" onClick={requestClose} disabled={create.isPending}>Cancelar</button><button type="submit" className="button-primary" disabled={create.isPending || storesQuery.isLoading || !storesQuery.data?.some(s => s.active)}><Plus size={16}/>{create.isPending ? 'Registrando…' : 'Registrar pedido'}</button></div>
      </form>
    </section>
    </div>,
    document.body,
  );
}

/** Situações em que a entrega já terminou: não aparece mais a opção de editar. */
const CLOSED_DELIVERY_STATUSES = ['COMPLETED', 'CANCELLED', 'NOT_DELIVERED', 'PRODUCT_RETURNED'];

function EditDeliveryModal({ delivery, onClose, onSaved }: { delivery: Delivery; onClose: () => void; onSaved: () => void }) {
  const save = useUpdateDelivery();
  const [error, setError] = useState('');
  // O endereço entra no cálculo da rota: só muda enquanto nenhum motoboy pegou a entrega.
  const addressEditable = ['REQUESTED', 'OFFERED', 'AWAITING_COURIER'].includes(delivery.status) && !delivery.courierId && !delivery.routeId;
  const initial = {
    customerName: delivery.customerName,
    customerPhone: delivery.customerPhone ?? '',
    destination: delivery.destination,
    orderNumber: delivery.orderNumber ?? '',
    notes: delivery.notes ?? '',
    priority: delivery.priority,
  };
  const [form, setForm] = useState(initial);
  const [coordinates, setCoordinates] = useState<{ latitude: number | null; longitude: number | null }>({ latitude: delivery.customerLatitude, longitude: delivery.customerLongitude });
  const destinationChanged = form.destination.trim() !== delivery.destination;
  const [requiresPrescription, setRequiresPrescription] = useState(delivery.requiresPrescription === true);
  const initialPayment: PaymentFormValue = {
    paymentMethod: (delivery.paymentMethod as PaymentFormValue['paymentMethod']) ?? '',
    changeFor: delivery.changeFor ? String(delivery.changeFor).replace('.', ',') : '',
    bringCardMachine: delivery.bringCardMachine !== false,
    productsAmount: delivery.productsAmount ? String(delivery.productsAmount).replace('.', ',') : '',
    prepaid: delivery.prepaid === true,
  };
  const [payment, setPayment] = useState<PaymentFormValue>(initialPayment);
  const paymentChanged = JSON.stringify(paymentPayload(payment)) !== JSON.stringify(paymentPayload(initialPayment));
  const hasChanges = (Object.keys(initial) as (keyof typeof initial)[]).some(key => form[key].trim() !== String(initial[key]).trim())
    || requiresPrescription !== (delivery.requiresPrescription === true)
    || paymentChanged;
  const update = (key: keyof typeof initial, value: string) => {
    setForm(prev => ({ ...prev, [key]: value }));
  };
  const requestClose = () => {
    if (save.isPending) return;
    if (hasChanges && !window.confirm('As alterações serão descartadas. Deseja fechar?')) return;
    onClose();
  };
  useModalBehavior(requestClose);
  const submit = (event: FormEvent) => {
    event.preventDefault();
    setError('');
    if (!hasChanges) return onClose();
    save.mutate({
      deliveryId: delivery.id,
      data: {
        customerName: form.customerName,
        customerPhone: form.customerPhone.trim() || null,
        orderNumber: form.orderNumber,
        notes: form.notes.trim() || null,
        priority: form.priority as 'normal' | 'urgent',
        requiresPrescription,
        ...(paymentChanged ? paymentPayload(payment) : {}),
        ...(addressEditable && destinationChanged
          ? { destination: form.destination, customerLatitude: coordinates.latitude, customerLongitude: coordinates.longitude }
          : {}),
      },
    }, {
      onSuccess: () => { onSaved(); onClose(); },
      onError: (mutationError) => {
        const apiError = mutationError as Error & { data?: { error?: string } };
        setError(apiError.data?.error ?? 'Não foi possível salvar. Confira os dados e tente novamente.');
      },
    });
  };
  return createPortal(
    <div className="modal-backdrop" role="presentation" onPointerDown={e => { if (e.target === e.currentTarget) requestClose(); }}>
    <section className="modal-card" role="dialog" aria-modal="true" aria-labelledby="edit-delivery-title" data-modal-active="true">
      <div className="modal-header flex items-start justify-between gap-3 border-b border-border px-5 py-4 sm:px-6 sm:py-5"><div className="min-w-0"><div className="eyebrow">{delivery.code}</div><h2 id="edit-delivery-title" className="mt-1 text-xl font-bold tracking-tight">Editar entrega</h2><p className="mt-1 text-sm text-muted-foreground">As alterações ficam registradas no histórico.</p></div><button type="button" className="icon-button modal-close-button" onClick={requestClose} aria-label="Fechar" disabled={save.isPending}><X size={18}/></button></div>
      <form onSubmit={submit} className="modal-form">
        <div className="modal-fields space-y-4 px-5 py-4 sm:px-6 sm:py-5">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Nome do cliente"><input required minLength={2} value={form.customerName} onChange={e => update('customerName', e.target.value)} data-modal-initial-focus data-testid="input-edit-customer-name"/></Field>
          <Field label="Telefone"><input type="tel" value={form.customerPhone} onChange={e => update('customerPhone', e.target.value)} placeholder="(31) 99999-0000" data-testid="input-edit-customer-phone"/></Field>
        </div>
        {addressEditable ? (
          <DeliveryAddressFields
            idPrefix="edit-delivery"
            initialDestination={delivery.destination}
            onChange={value => {
              setForm(prev => ({ ...prev, destination: value.destination }));
              setCoordinates({ latitude: value.latitude, longitude: value.longitude });
            }}
          />
        ) : (
          <Field label="Endereço de entrega">
            <input value={form.destination} readOnly aria-readonly="true" className="w-full bg-[#f7f6f4]" data-testid="input-edit-destination-locked"/>
            <span className="mt-1.5 block text-xs text-muted-foreground">A entrega já foi para um motoboy: o endereço não pode mais mudar. Se estiver errado, cancele e registre de novo.</span>
          </Field>
        )}
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Número do pedido"><input required value={form.orderNumber} onChange={e => update('orderNumber', e.target.value)} data-testid="input-edit-order-number"/></Field>
        </div>
        <div>
          <label className="flex min-h-12 cursor-pointer items-start gap-3 rounded-lg border border-border bg-[#faf9f7] px-3 py-3"><input type="checkbox" className="mt-0.5 !h-5 !min-h-0 !w-5 shrink-0 !p-0 accent-[#b91e2c]" checked={requiresPrescription} onChange={e => setRequiresPrescription(e.target.checked)} data-testid="checkbox-edit-requires-prescription"/><span className="min-w-0 flex-1"><span className="block text-sm font-semibold text-[#2b2e33]">Medicamento com receita</span><span className="mt-0.5 block text-xs text-muted-foreground">O motoboy precisa pegar a receita com o cliente e confirmar no app antes de concluir.</span></span></label>
        </div>
        <PaymentFields idPrefix="edit-delivery" value={payment} onChange={setPayment} deliveryFee={delivery.deliveryAmount} />
        <Field label="Observações"><textarea rows={2} value={form.notes} onChange={e => update('notes', e.target.value)} placeholder="Referências úteis para a entrega" data-testid="input-edit-notes"/></Field>
        {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700" role="alert">{error}</p>}
        </div>
        <div className="modal-form-actions flex flex-col-reverse gap-2 border-t border-border px-5 py-4 sm:flex-row sm:justify-end sm:px-6"><button type="button" className="button-secondary" onClick={requestClose} disabled={save.isPending}>Cancelar</button><button type="submit" className="button-primary" disabled={save.isPending || !hasChanges} data-testid="button-save-delivery">{save.isPending ? 'Salvando…' : 'Salvar alterações'}</button></div>
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

/**
 * Montar rota com várias entregas (admin e gerente). Com motoboy escolhido, só ele
 * recebe a oferta; sem escolha, vai para todos os disponíveis. O Google organiza a
 * ordem das paradas quando o motoboy aceita.
 */
function GroupRouteModal({ deliveryIds, onClose, onCreated }: { deliveryIds: string[]; onClose: () => void; onCreated: (message: string) => void }) {
  const qc = useQueryClient();
  const couriersQuery = useListCouriers(undefined, { query: { queryKey: getListCouriersQueryKey() } });
  const createRoute = useCreateDeliveryRoute();
  const [courierId, setCourierId] = useState('');
  const [error, setError] = useState('');
  const couriers = couriersQuery.data ?? [];
  const available = couriers.filter(courier => courier.status === 'AVAILABLE');
  const requestClose = () => {
    if (createRoute.isPending) return;
    onClose();
  };
  useModalBehavior(requestClose);
  const go = () => {
    setError('');
    createRoute.mutate({ data: { deliveryIds, courierId: courierId || null } }, {
      onSuccess: () => {
        void qc.invalidateQueries({ queryKey: getListDeliveriesQueryKey() });
        void qc.invalidateQueries({ queryKey: getGetDashboardSummaryQueryKey() });
        void qc.invalidateQueries({ queryKey: getListCouriersQueryKey() });
        const name = couriers.find(courier => courier.id === courierId)?.name;
        onCreated(name
          ? `Rota com ${deliveryIds.length} entregas enviada para ${name}. Ao aceitar, o Google organiza a melhor ordem.`
          : `Rota com ${deliveryIds.length} entregas oferecida a todos os motoboys disponíveis.`);
        onClose();
      },
      onError: (mutationError) => {
        const apiError = mutationError as Error & { data?: { error?: string } };
        setError(apiError.data?.error ?? 'Não foi possível montar a rota. Atualize a lista e tente de novo.');
      },
    });
  };
  return createPortal(
    <div className="modal-backdrop" role="presentation" onPointerDown={e => { if (e.target === e.currentTarget) requestClose(); }}>
    <section className="modal-card" role="dialog" aria-modal="true" aria-labelledby="group-route-title" data-modal-active="true">
      <div className="modal-header flex items-start justify-between gap-3 border-b border-border px-5 py-4 sm:px-6 sm:py-5"><div className="min-w-0"><div className="eyebrow">ROTA COM VÁRIAS ENTREGAS</div><h2 id="group-route-title" className="mt-1 text-xl font-bold">Montar rota com {deliveryIds.length} entregas</h2><p className="mt-1 text-sm text-muted-foreground">Um motoboy leva todas. Quando ele aceitar, o Google organiza a melhor ordem das paradas a partir de onde ele estiver.</p></div><button type="button" className="icon-button modal-close-button" onClick={requestClose} aria-label="Fechar" disabled={createRoute.isPending}><X size={18}/></button></div>
      <div className="modal-form">
      <div className="modal-fields modal-body space-y-4 px-5 py-4 sm:px-6 sm:py-5">
        <Field label="Quem vai levar">
          <select value={courierId} onChange={e => setCourierId(e.target.value)} data-modal-initial-focus data-testid="select-route-courier">
            <option value="">Qualquer motoboy disponível (o primeiro que aceitar)</option>
            {couriers.map(courier => <option key={courier.id} value={courier.id} disabled={courier.status !== 'AVAILABLE'}>{courier.name} · {courier.status === 'AVAILABLE' ? 'Disponível' : courier.status === 'OFFLINE' ? 'Offline' : 'Em entrega'}</option>)}
          </select>
        </Field>
        {couriersQuery.isLoading && <Skeleton rows={2}/>}
        {!couriersQuery.isLoading && available.length === 0 && <div className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900">Nenhum motoboy disponível agora. A rota pode ser oferecida a todos e fica esperando alguém ficar online.</div>}
        <p className="rounded-lg bg-[#f7f6f4] p-3 text-xs leading-relaxed text-muted-foreground">
          {courierId
            ? 'Só este motoboy recebe a oferta. Se ele dispensar, as entregas voltam para a fila dos motoboys da cidade e você é avisado.'
            : 'Todos os motoboys disponíveis recebem a oferta; o primeiro que aceitar leva a rota.'}
        </p>
        {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700" role="alert">{error}</p>}
      </div>
      <div className="modal-form-actions flex flex-col-reverse gap-2 border-t border-border sm:flex-row sm:justify-end"><button type="button" className="button-secondary" onClick={requestClose} disabled={createRoute.isPending}>Cancelar</button><button type="button" className="button-primary" disabled={createRoute.isPending} onClick={go} data-testid="button-confirm-route"><Bike size={16}/>{createRoute.isPending ? 'Enviando…' : courierId ? 'Enviar para o motoboy' : 'Oferecer a todos'}</button></div>
      </div>
    </section>
    </div>,
    document.body,
  );
}

/**
 * Tirar uma entrega da rota agrupada: volta para a fila ou é cancelada (cliente
 * desistiu). Se nenhum motoboy aceitou ainda, dá para desfazer a rota inteira.
 */
function RemoveFromRouteModal({ delivery, onClose, onDone }: { delivery: { id: string; code: string; routeId: string; status: string }; onClose: () => void; onDone: (message: string) => void }) {
  const qc = useQueryClient();
  const removeDelivery = useRemoveDeliveryFromRoute();
  const ungroup = useUngroupDeliveryRoute();
  const notAcceptedYet = delivery.status === 'OFFERED';
  const [choice, setChoice] = useState<'queue' | 'cancel' | 'ungroup'>('queue');
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');
  const pending = removeDelivery.isPending || ungroup.isPending;
  const requestClose = () => { if (!pending) onClose(); };
  useModalBehavior(requestClose);
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: getListDeliveriesQueryKey() });
    void qc.invalidateQueries({ queryKey: getGetDeliveryQueryKey(delivery.id) });
    void qc.invalidateQueries({ queryKey: getGetDashboardSummaryQueryKey() });
    void qc.invalidateQueries({ queryKey: getListCouriersQueryKey() });
    void qc.invalidateQueries({ queryKey: getListActiveRoutesQueryKey() });
  };
  const fail = (mutationError: unknown) => {
    const apiError = mutationError as Error & { data?: { error?: string } };
    setError(apiError.data?.error ?? 'Não foi possível alterar a rota. Atualize a lista e tente de novo.');
  };
  const go = () => {
    setError('');
    if (choice === 'ungroup') {
      ungroup.mutate({ routeId: delivery.routeId }, {
        onSuccess: () => { refresh(); onDone('Rota desfeita. As entregas voltaram para a fila.'); onClose(); },
        onError: fail,
      });
      return;
    }
    removeDelivery.mutate({ routeId: delivery.routeId, data: { deliveryId: delivery.id, cancel: choice === 'cancel', ...(reason.trim() ? { reason: reason.trim() } : {}) } }, {
      onSuccess: (result) => {
        refresh();
        const rest = result.remainingDeliveries
          ? ` A rota segue com ${result.remainingDeliveries} entrega${result.remainingDeliveries > 1 ? 's' : ''}.`
          : ' A rota ficou vazia e foi encerrada.';
        onDone(choice === 'cancel' ? `${delivery.code} saiu da rota e foi cancelada.${rest}` : `${delivery.code} saiu da rota e voltou para a fila.${rest}`);
        onClose();
      },
      onError: fail,
    });
  };
  const option = (value: typeof choice, title: string, detail: string) => (
    <label className={`flex cursor-pointer items-start gap-3 rounded-lg border px-3 py-3 ${choice === value ? 'border-[#cb7c82] bg-[#fcf4f4]' : 'border-border'}`}>
      <input type="radio" name="remove-route-choice" className="mt-1 h-4 w-4 accent-[#b91e2c]" checked={choice === value} onChange={() => setChoice(value)} />
      <span><span className="block text-sm font-semibold text-[#2b2e33]">{title}</span><span className="mt-0.5 block text-xs text-muted-foreground">{detail}</span></span>
    </label>
  );
  return createPortal(
    <div className="modal-backdrop" role="presentation" onPointerDown={e => { if (e.target === e.currentTarget) requestClose(); }}>
    <section className="modal-card" role="dialog" aria-modal="true" aria-labelledby="remove-route-title" data-modal-active="true">
      <div className="modal-header flex items-start justify-between gap-3 border-b border-border px-5 py-4 sm:px-6 sm:py-5"><div className="min-w-0"><div className="eyebrow">{delivery.code}</div><h2 id="remove-route-title" className="mt-1 text-xl font-bold">Tirar da rota</h2><p className="mt-1 text-sm text-muted-foreground">{notAcceptedYet ? 'Nenhum motoboy aceitou esta rota ainda.' : 'O motoboy já está com esta rota: o caminho das outras paradas é refeito e ele recebe um aviso.'}</p></div><button type="button" className="icon-button modal-close-button" onClick={requestClose} aria-label="Fechar" disabled={pending}><X size={18}/></button></div>
      <div className="modal-form">
      <div className="modal-fields modal-body space-y-3 px-5 py-4 sm:px-6 sm:py-5" role="radiogroup" aria-label="O que fazer com a entrega">
        {option('queue', 'Voltar para a fila', 'A entrega sai da rota e fica esperando um novo despacho.')}
        {option('cancel', 'Cancelar a entrega', 'Use quando o cliente desistiu. O histórico fica guardado.')}
        {choice === 'cancel' && <Field label="Motivo (opcional)"><input value={reason} onChange={e => setReason(e.target.value)} maxLength={300} placeholder="Ex.: cliente desistiu pelo telefone" /></Field>}
        {notAcceptedYet && option('ungroup', 'Desfazer a rota inteira', 'Todas as entregas desta rota voltam para a fila.')}
        {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700" role="alert">{error}</p>}
      </div>
      <div className="modal-form-actions flex flex-col-reverse gap-2 border-t border-border sm:flex-row sm:justify-end"><button type="button" className="button-secondary" onClick={requestClose} disabled={pending}>Voltar</button><button type="button" className="button-primary" onClick={go} disabled={pending} data-testid="button-confirm-remove-route">{pending ? 'Salvando…' : choice === 'cancel' ? 'Tirar e cancelar' : choice === 'ungroup' ? 'Desfazer rota' : 'Tirar da rota'}</button></div>
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
  const [dispatchId, setDispatchId] = useState<string | null>(null);
  const [selectedDeliveryIds, setSelectedDeliveryIds] = useState<string[]>([]);
  const [routeFeedback, setRouteFeedback] = useState<FeedbackMessage | null>(null);
  // The header search sends the term as ?busca=… to this page.
  const initialSearch = new URLSearchParams(window.location.search).get('busca')?.trim() ?? '';
  const [searchText, setSearchText] = useState(initialSearch);
  const [search, setSearch] = useState(initialSearch);
  const [status, setStatus] = useState('');
  const [storeId, setStoreId] = useState('');
  const [cancelFeedback, setCancelFeedback] = useState<FeedbackMessage | null>(null);
  const [cancelTarget, setCancelTarget] = useState<{ id: string; code: string } | null>(null);
  const [deleteFeedback, setDeleteFeedback] = useState<FeedbackMessage | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; code: string } | null>(null);
  const qc = useQueryClient();
  const createDeliveryRoute = useCreateDeliveryRoute();
  const stores = useListStores({ query: { queryKey: getListStoresQueryKey() } });
  const params = useMemo(() => ({ ...(status ? { status } : {}), ...(search ? { search } : {}), ...(storeId ? { storeId } : {}) }), [status, search, storeId]);
  const deliveries = useListDeliveries(params, { query: { refetchInterval: 15000, refetchIntervalInBackground: false, refetchOnWindowFocus: true } });
  const [now, setNow] = useState(() => Date.now());
  const refreshDashboard = () => Promise.all([
    deliveries.refetch(),
    opsRef.current?.refetchAll(),
  ]);
  const opsRef = useRef<ReturnType<typeof useOperationsData> | null>(null);
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
  const [groupOpen, setGroupOpen] = useState(false);
  const [removeTarget, setRemoveTarget] = useState<{ id: string; code: string; routeId: string; status: string } | null>(null);
  const offerGroupedRoute = () => {
    setRouteFeedback(null);
    setGroupOpen(true);
  };
  // Visão do dia inteiro (sem os filtros da fila): números, mapa, alertas e motoboys.
  const ops = useOperationsData();
  opsRef.current = ops;
  const allDeliveries = ops.deliveries.data ?? [];
  const allCouriers = ops.couriers.data ?? [];
  const today = useMemo(() => deliveryMetrics(allDeliveries, 'today', now), [allDeliveries, now]);
  const courierStats = useMemo(() => courierMetrics(allCouriers, now), [allCouriers, now]);
  // Cards do topo levam para a parte da página com os detalhes.
  const [couriersFocus, setCouriersFocus] = useState<{ tab: 'busy' | 'available'; nonce: number } | null>(null);
  const scrollToSection = (id: string) => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  const showCouriers = (tab: 'busy' | 'available') => {
    setCouriersFocus({ tab, nonce: Date.now() });
    scrollToSection('motoboys-ativos');
  };
  const refreshing = deliveries.isRefetching || ops.isFetching;
  const completedContext = today.completedChange == null
    ? 'Sem base de comparação'
    : `${today.completedChange >= 0 ? '↑' : '↓'} ${Math.abs(today.completedChange).toLocaleString('pt-BR', { maximumFractionDigits: 0 })}% vs. ontem`;
  const hasQueueFilters = Boolean(search || status || storeId);
  const metricsLoading = ops.deliveries.isLoading;
  return <div className="soft-enter flex flex-col gap-6">
    {/* 1. Cabeçalho: o que é a tela e a ação principal */}
    <section aria-labelledby="operation-title" className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
      <div>
        <p className="text-[10px] font-medium tracking-[0.7px] text-[var(--adm-muted)]">OPERAÇÃO</p>
        <h1 id="operation-title" className="mt-3 text-[24px] font-semibold leading-tight tracking-[-0.01em] text-[var(--adm-ink)] sm:text-[28px]">Entregas</h1>
        <p className="mt-2 max-w-xl text-[13px] text-[var(--adm-muted)]">O que precisa de ação, a fila completa e onde estão os motoboys, numa tela só.</p>
        <div className="mt-3"><LiveChip hasError={ops.hasError || deliveries.isError} lastUpdatedAt={ops.lastUpdatedAt}/></div>
      </div>
      <div className="flex flex-wrap gap-2">
        <button className="button-secondary min-h-11" onClick={() => void refreshDashboard()} disabled={refreshing} aria-label="Atualizar painel" data-testid="button-refresh-dashboard"><RefreshCw size={15} className={refreshing ? 'animate-spin' : ''}/>Atualizar</button>
        <button className="button-primary min-h-11 px-5 text-sm" onClick={() => setShowCreate(true)} data-testid="button-new-delivery"><FilePlus2 size={17}/>Nova entrega</button>
      </div>
    </section>

    {/* 2. Números do dia */}
    <section aria-label="Resumo de hoje" className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5 [&>*:last-child]:col-span-2 sm:[&>*:last-child]:col-span-1">
      <Indicator label="Aguardando motoboy" onClick={() => scrollToSection('fila-entregas')} actionLabel="ver a fila" value={today.pending} context={today.pending ? 'Na fila dos motoboys' : 'Nenhuma parada'} highlight={today.pending > 0} loading={metricsLoading}/>
      <Indicator label="Em rota" onClick={() => showCouriers('busy')} actionLabel="ver motoboys em rota" value={today.inTransit} context={today.urgentAtRisk ? `${today.urgentAtRisk} urgente${today.urgentAtRisk > 1 ? 's' : ''} com risco de atraso` : 'A caminho do cliente'} contextTone={today.urgentAtRisk ? 'danger' : 'muted'} loading={metricsLoading}/>
      <Indicator label="Concluídas hoje" onClick={() => scrollToSection('fila-entregas')} actionLabel="ver a fila" value={today.completed} context={completedContext} contextTone={today.completedChange != null && today.completedChange >= 0 ? 'success' : 'muted'} loading={metricsLoading}/>
      <Indicator label="Motoboys disponíveis" onClick={() => showCouriers('available')} actionLabel="ver motoboys disponíveis" value={courierStats.available.length} context={`de ${courierStats.connected} conectados`} loading={ops.couriers.isLoading}/>
      <Indicator label="Tempo médio" value={today.averageMinutes == null ? '—' : `${Math.round(today.averageMinutes)} min`} context={today.averageMinutes == null ? 'Sem entregas concluídas' : 'Do pedido à entrega'} loading={metricsLoading}/>
    </section>

    {ops.hasError && !ops.isLoading && (
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-[10px] border border-[#f3d9a4] bg-[var(--adm-warning-bg)] px-4 py-3 text-[12px] text-[#6b4a00]" role="status">
        <span>Não foi possível atualizar agora. Os últimos dados continuam na tela.</span>
        <button type="button" className="inline-flex items-center gap-1.5 font-semibold" onClick={() => void refreshDashboard()}><RefreshCw size={13}/> Tentar novamente</button>
      </div>
    )}

    {/* 3. Mapa ao vivo em destaque */}
    <div className="min-w-0"><OperationMap data={ops} now={now} hero/></div>

    {/* 4. Fila de entregas, logo abaixo do mapa: acompanha as duas coisas juntas */}
    <section className="panel scroll-mt-24 overflow-hidden" aria-labelledby="queue-title" id="fila-entregas">
      <div className="flex flex-col gap-3 border-b border-border px-4 py-4 sm:px-5">
        <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
          <div>
            <div className="eyebrow">FILA DE ENTREGAS</div>
            <h2 id="queue-title" className="mt-1 text-lg font-bold tracking-tight">Todas as entregas <span className="ml-1 rounded-md bg-[#f3f1ef] px-2 py-0.5 align-middle text-xs font-semibold text-muted-foreground">{deliveries.data?.length ?? '—'}</span></h2>
            <p className="mt-1 text-xs text-muted-foreground">Toda entrega nova já vai para os motoboys. Marque de 2 a 10 que ainda não foram aceitas para mandar como uma rota só.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            {selectedDeliveryIds.length >= 2 && <button className="button-primary" onClick={offerGroupedRoute} data-testid="button-create-route"><Bike size={16}/>{`Montar rota com ${selectedDeliveryIds.length}`}</button>}
            {selectedDeliveryIds.length > 0 && <button className="button-quiet" onClick={() => { setSelectedDeliveryIds([]); setRouteFeedback(null); }}>Limpar seleção ({selectedDeliveryIds.length})</button>}
            {hasQueueFilters && <button className="button-quiet" onClick={() => { setStatus(''); setStoreId(''); setSearch(''); setSearchText(''); }}><Filter size={14}/>Limpar filtros</button>}
          </div>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row">
          <form onSubmit={runSearch} className="search-box flex-1"><Search size={15}/><input placeholder="Buscar código, cliente ou pedido" value={searchText} onChange={e => setSearchText(e.target.value)} aria-label="Buscar entregas" data-testid="input-search-deliveries"/><button type="submit" className="search-submit">Buscar</button></form>
          <select value={status} onChange={e => setStatus(e.target.value)} className="filter-select" aria-label="Filtrar por status" data-testid="filter-status"><option value="">Todos os status</option>{Object.entries(statusNames).map(([value, name]) => <option key={value} value={value}>{name}</option>)}</select>
          <select value={storeId} onChange={e => setStoreId(e.target.value)} className="filter-select" aria-label="Filtrar por filial" data-testid="filter-store"><option value="">Todas as filiais</option>{(stores.data ?? []).map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select>
        </div>
      </div>
      {routeFeedback && <AutoDismissFeedback feedback={routeFeedback} onDismiss={() => setRouteFeedback(null)} className="mx-4 mt-3"/>}
      {cancelFeedback && <AutoDismissFeedback feedback={cancelFeedback} onDismiss={() => setCancelFeedback(null)} className="mx-4 mt-3"/>}
      {deleteFeedback && <AutoDismissFeedback feedback={deleteFeedback} onDismiss={() => setDeleteFeedback(null)} className="mx-4 mt-3"/>}
      {deliveries.isLoading ? <Skeleton rows={5}/> : deliveries.isError ? <div className="p-8 text-center"><AlertTriangle className="mx-auto mb-2 text-amber-600"/><p className="font-semibold">Falha ao carregar as entregas</p><p className="mb-3 mt-1 text-sm text-muted-foreground">Tente de novo em instantes.</p><button className="button-secondary mx-auto" onClick={() => void deliveries.refetch()}><RefreshCw size={14}/>Tentar novamente</button></div> :
        !deliveries.data?.length ? <EmptyState title={hasQueueFilters ? 'Nenhuma entrega com esses filtros' : 'Nenhuma entrega ainda'} detail={hasQueueFilters ? 'Ajuste a busca ou limpe os filtros.' : 'Quando uma entrega for registrada, ela aparece aqui para despacho.'} action={<button className="button-primary" onClick={() => setShowCreate(true)}><Plus size={15}/>Nova entrega</button>}/> :
          <div className="overflow-x-auto"><table className="delivery-table delivery-table--queue w-full min-w-[860px]">
            <thead><tr><th><span className="sr-only">Selecionar para rota</span>Rota</th><th>Entrega</th><th>Cliente / destino</th><th>Filial</th><th>Status</th><th>Motoboy</th><th>Atualizada</th><th className="text-right">Ação</th></tr></thead>
            <tbody>{deliveries.data.map(d => <tr className="row-hover" key={d.id} data-testid={`row-delivery-${d.id}`}>
              <td>{waitingForCourier(d) ? <input type="checkbox" aria-label={`Selecionar ${d.code} para uma rota`} checked={selectedDeliveryIds.includes(d.id)} disabled={!selectedDeliveryIds.includes(d.id) && selectedDeliveryIds.length >= 10} onChange={e => toggleRouteDelivery(d.id, e.target.checked)} className="h-4 w-4 accent-[#b91e2c]"/> : <span className="text-xs text-muted-foreground">—</span>}</td>
              <td><Link href={`/deliveries/${d.id}`} className="table-code" data-testid={`link-delivery-${d.id}`}>{d.code}<span>Pedido {d.orderNumber || '—'}</span></Link>{d.priority === 'urgent' && <span className="priority-tag">URGENTE</span>}{d.requiresPrescription && <span className="priority-tag !bg-[#eef4ff] !text-[#1d4f91]">RECEITA</span>}{d.routeId && <span className="priority-tag !bg-[#f3f1ef] !text-[#4b4f56]">EM ROTA</span>}</td>
              <td><div className="font-semibold">{d.customerName}</div><div className="mt-1 flex max-w-[235px] items-center gap-1 text-xs text-muted-foreground" title={d.destination}><MapPin size={12} className="shrink-0"/><span className="min-w-0 truncate">{d.destination}</span></div></td>
              <td><div className="max-w-[140px] truncate text-sm font-medium" title={d.storeName}>{d.storeName}</div></td>
              <td><StatusBadge status={d.status}/></td>
              <td>{d.courierName ? <div className="flex items-center gap-2"><span className="avatar">{d.courierInitials || d.courierName.slice(0,2).toUpperCase()}</span><div><div className="text-xs font-semibold">{d.courierName}</div><div className="text-[10px] text-muted-foreground">{timeAgo(lastKnownLocationAt(d, allCouriers))}</div></div></div> : <span className="text-xs text-muted-foreground">Sem motoboy</span>}</td>
              <td className="text-xs text-muted-foreground">{fmtTime(d.updatedAt || d.createdAt)}</td>
              <td className="text-right"><div className="flex justify-end gap-1.5">{d.routeId && <button className="button-small button-red-outline" type="button" onClick={() => setRemoveTarget({ id: d.id, code: d.code, routeId: d.routeId!, status: d.status })} data-testid={`button-remove-route-${d.id}`}>Tirar da rota</button>}{!d.routeId && REQUEUE_STATUSES.includes(d.status) && <RequeueButton deliveryId={d.id} code={d.code} className="button-small button-red-outline" shortLabel onDone={text => setRouteFeedback({ kind: 'success', text })}/>}{canCancel && !d.routeId && !['COMPLETED','CANCELLED'].includes(d.status) && <button className="button-small button-red-outline" type="button" onClick={() => { setCancelFeedback(null); setCancelTarget({ id: d.id, code: d.code }); }} aria-label={`Cancelar pedido ${d.code}`} title="Cancelar pedido" data-testid={`button-cancel-${d.id}`}><X size={14}/><span className="queue-action-text">Cancelar</span></button>}{canDelete && <button className="button-small button-red-outline" type="button" onClick={() => { setDeleteFeedback(null); setDeleteTarget({ id: d.id, code: d.code }); }} aria-label={`Excluir definitivamente ${d.code}`} title="Excluir definitivamente" data-testid={`button-delete-delivery-${d.id}`}><Trash2 size={14}/><span className="queue-action-text">Excluir</span></button>}<Link href={`/deliveries/${d.id}`} className="icon-button-sm" aria-label={`Abrir ${d.code}`}><ArrowRight size={15}/></Link></div></td>
            </tr>)}</tbody>
          </table></div>}
    </section>

    {/* 5. Motoboys (rotas e entregas) e alertas */}
    <ActiveCouriers couriers={allCouriers} deliveries={allDeliveries} now={now} isLoading={ops.couriers.isLoading} isError={ops.couriers.isError && !ops.couriers.data} onRetry={() => void ops.couriers.refetch()} bar focus={couriersFocus}/>
    <div id="alertas" className="scroll-mt-24"><OperationAlerts deliveries={allDeliveries} couriers={allCouriers} occurrences={ops.cancellations.data?.length ?? 0} now={now} isLoading={ops.isLoading}/></div>

    {/* 6. Ocorrências dos motoboys: só para administradores */}
    {canDelete && <div id="ocorrencias" className="scroll-mt-24"><CancellationAlertsPanel /></div>}

    {showCreate && <DeliveryModal onClose={() => setShowCreate(false)}/>}
    {dispatchId && <DispatchModal deliveryId={dispatchId} onClose={() => setDispatchId(null)}/>}
    {removeTarget && <RemoveFromRouteModal delivery={removeTarget} onClose={() => setRemoveTarget(null)} onDone={text => { setSelectedDeliveryIds(current => current.filter(id => id !== removeTarget.id)); setRouteFeedback({ kind: 'success', text }); }}/>}
    {groupOpen && <GroupRouteModal deliveryIds={selectedDeliveryIds} onClose={() => setGroupOpen(false)} onCreated={text => { setSelectedDeliveryIds([]); setRouteFeedback({ kind: 'success', text }); }}/>}
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
  const [editOpen, setEditOpen] = useState(false);
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
  const locationAt = data ? lastKnownLocationAt(data, couriers.data) : null;
  const assignedCourier = data?.courierId ? couriers.data?.find(courier => courier.id === data.courierId) : undefined;
  const detailMarkers = useMemo<MapMarker[]>(() => {
    if (!data) return [];
    const list: MapMarker[] = [];
    if (data.storeLatitude != null && data.storeLongitude != null) {
      list.push({ id: `store-${data.storeId}`, kind: 'store', latitude: data.storeLatitude, longitude: data.storeLongitude, title: data.storeName, detail: 'Retirada' });
    }
    if (data.customerLatitude != null && data.customerLongitude != null) {
      list.push({ id: `customer-${data.id}`, kind: 'stop', label: 'Cliente', latitude: data.customerLatitude, longitude: data.customerLongitude, title: data.customerName, detail: data.destination, completed: data.status === 'COMPLETED' });
    }
    // Posição do motoboy só enquanto ele está com a entrega.
    if (assignedCourier?.currentLatitude != null && assignedCourier.currentLongitude != null && !CLOSED_DELIVERY_STATUSES.includes(data.status)) {
      list.push({ id: `courier-${assignedCourier.id}`, kind: 'courier', latitude: assignedCourier.currentLatitude, longitude: assignedCourier.currentLongitude, title: assignedCourier.name, detail: timeAgo(locationAt) });
    }
    return list;
  }, [data, assignedCourier, locationAt]);
  return <div className="soft-enter">
    <Link href="/entregas" className="back-link"><ArrowLeft size={15}/>Voltar para a fila</Link>
    {isLoading ? <div className="mt-5 panel"><Skeleton rows={7}/></div> : isError || !data ? <div className="mt-5 panel"><EmptyState title="Entrega não encontrada" detail="O registro pode ter sido removido ou estar temporariamente indisponível." action={<button className="button-secondary" onClick={() => void refetch()}><RefreshCw size={14}/>Tentar novamente</button>}/></div> :
      <>
        <div className="mt-5 flex flex-col justify-between gap-4 md:flex-row md:items-start">
          <div><div className="eyebrow">DETALHE DA SOLICITAÇÃO</div><div className="mt-1 flex flex-wrap items-center gap-3"><h1 className="text-[30px] font-bold tracking-[-.05em]">{data.code}</h1><StatusBadge status={data.status}/>{data.priority === 'urgent' && <span className="priority-tag">URGENTE</span>}</div><p className="mt-1 text-sm text-muted-foreground">Pedido {data.orderNumber || '—'} <span className="mx-1.5">·</span> Criado {fmtTime(data.createdAt)}</p></div>
          <div className="flex flex-wrap gap-2">{!CLOSED_DELIVERY_STATUSES.includes(data.status) && <button className="button-secondary" onClick={() => setEditOpen(true)} data-testid="button-edit-delivery"><Pencil size={15}/>Editar</button>}{REQUEUE_STATUSES.includes(data.status) && !data.routeId && <RequeueButton deliveryId={data.id} code={data.code} onDone={() => refresh()}/>}
            <select className="filter-select" value={nextStatus} onChange={e => setNextStatus(e.target.value)} aria-label="Novo status"><option value="">Atualizar status</option>{(statusOptions[data.status] ?? []).map(s => <option key={s} value={s}>{statusNames[s]}</option>)}</select>
            {nextStatus !== "COMPLETED" && <button className="button-secondary" disabled={!nextStatus || updateStatus.isPending} onClick={applyStatus}>{updateStatus.isPending ? 'Salvando…' : 'Aplicar'}</button>}
          </div>
        </div>
        {nextStatus === "COMPLETED" && <div className="mt-4 max-w-md"><EvidencePhotoAction deliveryId={id} label="Enviar foto e concluir entrega" requiresPrescription={data.requiresPrescription === true} onComplete={async (evidencePath, options) => {
          await updateStatus.mutateAsync({ deliveryId: id, data: { status: "COMPLETED", evidencePath, ...(options.prescriptionCollected ? { prescriptionCollected: true } : {}) } });
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
                <Info label="Pagamento do cliente" value={paymentLabel(data) ?? 'Não informado'}/>
                <Info label="Valor da entrega (filial)" value={data.deliveryAmount.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}/>
                <Info label="Endereço de entrega" value={data.destination} wide icon={<MapPin size={14}/>}/><Info label="Unidade de origem" value={data.storeName}/><Info label="Número do pedido" value={data.orderNumber || '—'}/>{data.requiresPrescription && <Info label="Receita" value={data.prescriptionCollectedAt ? `Recolhida pelo motoboy · ${fmtTime(data.prescriptionCollectedAt)}` : 'Motoboy precisa pegar com o cliente'}/>}
                <Info label="Distância informada" value={data.distanceKm != null ? `${data.distanceKm} km` : 'Não disponível'}/><Info label="Previsão" value={data.estimatedMinutes != null ? `${data.estimatedMinutes} min` : 'Não informada'}/>
              </div>
              <div className="mt-5 rounded-lg bg-[#f7f6f4] p-3">
                <DeliveryProgress status={data.status} events={data.events} createdAt={data.createdAt} />
              </div>
              {data.evidenceAvailable && <EvidencePhotoViewer apiBase={isNativeApp ? nativeApiBaseUrl : basePath} deliveryId={data.id} />}
              {data.notes && <div className="mt-4 rounded-lg bg-[#f7f6f4] p-3"><div className="eyebrow">OBSERVAÇÕES</div><p className="mt-1 text-sm leading-relaxed">{data.notes}</p></div>}
            </section>
            <section className="panel p-5">
              <div className="mb-4"><div className="eyebrow">MAPA E LOCALIZAÇÃO</div><h2 className="mt-1 font-bold">Loja, destino e entregador</h2></div>
              {detailMarkers.length ? (
                <div className="mb-4 overflow-hidden rounded-xl border border-border" data-testid="map-delivery-detail">
                  <LiveMap markers={detailMarkers} ariaLabel={`Mapa da entrega ${data.code}: loja, destino e entregador`} size="compact" showCenterOnMe={false}/>
                </div>
              ) : (
                <p className="mb-4 rounded-lg bg-[#f7f6f4] p-3 text-xs text-muted-foreground">Sem coordenadas para mostrar no mapa: o endereço foi digitado sem escolher uma sugestão da lista.</p>
              )}
              <div className="location-panel"><div className="location-symbol"><MapPin size={19}/></div><div><div className="font-semibold">{data.courierName || 'Entregador ainda não atribuído'}</div><p className="mt-1 text-xs text-muted-foreground">{locationAt ? `${timeAgo(locationAt)} · ${fmtTime(locationAt)}` : 'Localização indisponível no momento.'}</p></div><div className="location-stamp">GPS<br/>{locationAt ? 'OK' : 'N/D'}</div></div>
            </section>
          </div>
          <aside className="space-y-4">
            <section className="panel p-5">
              <div className="mb-4"><div className="eyebrow">ENTREGADOR</div><h2 className="mt-1 font-bold">Atribuição atual</h2></div>
              {data.courierName ? <div className="flex items-center gap-3 rounded-lg bg-[#f7f6f4] p-3"><span className="avatar avatar-large">{data.courierInitials || data.courierName.slice(0,2).toUpperCase()}</span><div className="min-w-0 flex-1"><div className="font-semibold">{data.courierName}</div><div className="mt-1 text-xs text-muted-foreground">Última localização: {timeAgo(locationAt)}</div></div><Badge tone="blue">Atribuído</Badge></div> : <div className="rounded-lg border border-dashed border-border px-4 py-5 text-center"><Bike size={22} className="mx-auto text-muted-foreground"/><p className="mt-2 text-sm font-semibold">Aguardando entregador</p><p className="mt-1 text-xs text-muted-foreground">Despache para iniciar o atendimento.</p></div>}
              {waitingForCourier(data) && <div className="mt-4"><label className="eyebrow" htmlFor="quick-courier">ENVIAR SÓ PARA UM MOTOBOY</label><div className="mt-2 flex gap-2"><select id="quick-courier" className="filter-select min-w-0 flex-1" defaultValue=""><option value="">Escolher motoboy</option>{(couriers.data ?? []).map(c => <option key={c.id} value={c.id} disabled={c.status === 'BUSY'}>{c.name} · {c.status === 'AVAILABLE' ? 'Disponível' : c.status === 'OFFLINE' ? 'Offline' : 'Em atendimento'}</option>)}</select><button className="button-secondary" onClick={e => { const select = e.currentTarget.previousElementSibling as HTMLSelectElement; if (select.value) singleDispatch(select.value); else setActionError('Selecione um motoboy que não esteja em atendimento.'); }} disabled={dispatch.isPending}>Enviar</button></div></div>}
            </section>
            <section className="panel p-5">
              <div className="mb-5 flex items-center gap-2"><History size={16} className="text-primary"/><div><div className="eyebrow">AUDITORIA</div><h2 className="mt-0.5 font-bold">Histórico de eventos</h2></div></div>
              {data.events?.length ? <div className="timeline">{[...data.events].sort((a,b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()).map((event, i) => <div className="timeline-item" key={event.id}><span className={`timeline-pin ${i === data.events.length - 1 ? 'timeline-current' : ''}`}/><div className="flex items-start justify-between gap-3"><div><div className="text-sm font-semibold">{event.label}</div><div className="mt-1 text-xs text-muted-foreground">{event.actor || 'Sistema'}</div></div><time className="shrink-0 text-[10px] text-muted-foreground">{fmtTime(event.timestamp)}</time></div></div>)}</div> : <div className="rounded-lg bg-[#f7f6f4] p-4 text-sm text-muted-foreground">Ainda não há eventos registrados para esta entrega.</div>}
            </section>
          </aside>
        </div>
      </>}
    {dispatchOpen && <DispatchModal deliveryId={id} onClose={() => setDispatchOpen(false)}/>}
    {editOpen && data && <EditDeliveryModal delivery={data} onClose={() => setEditOpen(false)} onSaved={refresh}/>}
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
  const { signOut } = useAuth();
  return <main className="grid min-h-[100dvh] place-items-center bg-[#f4f3f1] p-5">
    <section className="panel w-full max-w-md p-7 text-center">
      <div className="brand-mark mx-auto">MM</div>
      <h1 className="mt-5 text-xl font-bold">Acesso aguardando aprovação</h1>
      <p className="mt-2 text-sm leading-relaxed text-muted-foreground">Sua conta foi criada, mas ainda não recebeu um perfil de acesso. Um administrador precisa aprovar e vincular sua conta.</p>
      <p className="mt-4 rounded-lg bg-[#f7f6f4] px-3 py-2 text-xs text-muted-foreground">{profile.email}</p>
      <Link className="button-secondary mt-5" href="/account"><KeyRound size={15}/> Configurar senha</Link>
      <button className="button-secondary mt-5" onClick={() => void signOut()}>Sair da conta</button>
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
  const auth = useAuth();
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
  const auth = useAuth();
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
    return <StorePortal profile={profile.data} NewDeliveryModal={DeliveryModal} DispatchModal={DispatchModal} GroupRouteModal={GroupRouteModal} RemoveFromRouteModal={RemoveFromRouteModal} CancelDeliveryModal={CancelDeliveryModal} EditDeliveryModal={EditDeliveryModal} />;
  }
  // Admin e Central: a página inicial é a operação de entregas (antes "Visão geral" + "Entregas").
  return <RoutedErrorBoundary><AdminShell profile={profile.data}><Dashboard canCancel={profile.data.role === 'ADMIN' || profile.data.role === 'CENTRAL'} canDelete={profile.data.role === 'ADMIN'} /></AdminShell></RoutedErrorBoundary>;
}

function CentralRoute({ children, adminOnly = false }: { children: ReactNode | ((profile: AppUser) => ReactNode); adminOnly?: boolean }) {
  const { auth, profile } = useSignedInProfile();
  if (!auth.isLoaded || (auth.isSignedIn && profile.isLoading)) return <ProfileLoading />;
  if (!auth.isSignedIn) return <Redirect to="/" />;
  if (profile.isError || !profile.data) return <ProfileError retry={() => void profile.refetch()} />;
  if (profile.data.role === 'PENDING') return <PendingApproval profile={profile.data} />;
  if (profile.data.role !== 'ADMIN' && profile.data.role !== 'CENTRAL') return <Redirect to="/user-portal" />;
  if (adminOnly && profile.data.role !== 'ADMIN') {
    return <main className="grid min-h-[100dvh] place-items-center bg-[#f4f3f1] p-5"><section className="panel p-6 text-center"><h1 className="font-bold">Acesso restrito</h1><p className="mt-2 text-sm text-muted-foreground">Somente administradores podem gerenciar perfis.</p><Link className="button-primary mt-4" href="/">Voltar ao painel</Link></section></main>;
  }
  return <RoutedErrorBoundary><AdminShell profile={profile.data}>{typeof children === 'function' ? children(profile.data) : children}</AdminShell></RoutedErrorBoundary>;
}

/** Relatórios: o geral é só do admin/Central; o gerente vê só a contabilidade da filial dele. */
function ReportsRoute() {
  const { auth, profile } = useSignedInProfile();
  if (!auth.isLoaded || (auth.isSignedIn && profile.isLoading)) return <ProfileLoading />;
  if (auth.isSignedIn && profile.data?.role === 'STORE_MANAGER') {
    return <main className="min-h-[100dvh] bg-[#f4f3f1] px-4 pb-10 pt-5 text-[#24272d] sm:px-6"><div className="mx-auto max-w-6xl"><StoreAccountingPage/></div></main>;
  }
  return <CentralRoute><Reports/></CentralRoute>;
}

function AppRoutes() {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <NativeConnectivityGuard />
        <PasswordRecoveryRedirect />
        <InviteLinkRedirect />
        <TooltipProvider>
          <Switch>
            <Route path="/" component={HomeRedirect}/>
            <Route path="/user-portal" component={UserPortalRoute}/>
            <Route path="/account" component={AccountRoute}/>
            <Route path="/motoboy-pwa" component={CourierAccessPage}/>
            <Route path="/entregas" component={() => <CentralRoute>{(profile) => <Dashboard canCancel={profile.role === 'ADMIN' || profile.role === 'CENTRAL'} canDelete={profile.role === 'ADMIN'} />}</CentralRoute>}/>
            {/* A aba "Mapa em tempo real" saiu: o mapa está na página de entregas. */}
            <Route path="/mapa">{() => <Redirect to="/" />}</Route>
            <Route path="/motoboys" component={() => <CentralRoute><CouriersPage/></CentralRoute>}/>
            <Route path="/deliveries/:deliveryId" component={() => <CentralRoute><DeliveryDetail/></CentralRoute>}/>
            <Route path="/access" component={() => <CentralRoute adminOnly><AccessManagement/></CentralRoute>}/>
            <Route path="/filiais" component={() => <CentralRoute adminOnly><StoreManagement/></CentralRoute>}/>
            <Route path="/painel-tecnico" component={() => <CentralRoute adminOnly><DevPanel/></CentralRoute>}/>
            <Route path="/integracao-erp">{() => <Redirect to="/painel-tecnico?aba=erp" />}</Route>
            <Route path="/reports" component={ReportsRoute}/>
            <Route path="/sign-in/*?" component={SignInPage}/>
            <Route path="/sign-up/*?" component={SignUpPage}/>
            <Route path="/esqueci-senha" component={ForgotPasswordPage}/>
            <Route path="/redefinir-senha" component={ResetPasswordPage}/>
            <Route path="/aceitar-convite" component={AcceptInvitePage}/>
            <Route component={NotFound}/>
          </Switch>
          <PublicSupportButton/>
          <Toaster/>
        </TooltipProvider>
      </AuthProvider>
    </QueryClientProvider>
  );
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
  return <WouterRouter base={basePath}><AppRoutes/></WouterRouter>;
}
export default App;
