import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { Link, useLocation } from "wouter";
import {
  getGetDashboardSummaryQueryKey,
  getListDeliveryCancellationsQueryKey,
  getListStoresQueryKey,
  useGetDashboardSummary,
  useListDeliveryCancellations,
  useListStores,
  type AppUser,
} from "@workspace/api-client-react";
import {
  Bell,
  Bike,
  ChartColumn,
  ChevronDown,
  KeyRound,
  LayoutGrid,
  LogOut,
  Map as MapIcon,
  Menu,
  Package,
  PanelLeft,
  Search,
  Settings,
  Store,
  UserRound,
} from "lucide-react";
import { useAuth } from "@/lib/auth";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

/*
 * Administrative shell from the Figma file: 224px sidebar (≥1440px), 72px icon
 * rail (1024–1439px) and a drawer below 1024px, plus the 76px header with global
 * search, alerts and profile. Navigation keeps the existing permissions:
 * Filiais and Acessos stay admin-only, Relatórios is admin + central.
 */

const roleLabels: Record<string, string> = {
  ADMIN: "Administração",
  CENTRAL: "Central de operação",
};

type NavItem = { href: string; label: string; icon: typeof LayoutGrid; match: (path: string) => boolean; count?: number };

function useMediaQuery(query: string) {
  const [matches, setMatches] = useState(() => typeof window !== "undefined" && window.matchMedia(query).matches);
  useEffect(() => {
    const media = window.matchMedia(query);
    const update = () => setMatches(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, [query]);
  return matches;
}

const COLLAPSE_KEY = "adm-sidebar-collapsed";

export default function AdminShell({ profile, children }: { profile: AppUser; children: ReactNode }) {
  const [location, setLocation] = useLocation();
  const { signOut } = useAuth();
  const isDesktop = useMediaQuery("(min-width: 1024px)");
  const isWide = useMediaQuery("(min-width: 1440px)");
  const [collapsedPref, setCollapsedPref] = useState<boolean | null>(() => {
    try {
      const saved = window.localStorage.getItem(COLLAPSE_KEY);
      return saved == null ? null : saved === "1";
    } catch {
      return null;
    }
  });
  const [drawerOpen, setDrawerOpen] = useState(false);
  const collapsed = isDesktop && (collapsedPref ?? !isWide);
  const toggleCollapsed = () => {
    const next = !collapsed;
    setCollapsedPref(next);
    try {
      window.localStorage.setItem(COLLAPSE_KEY, next ? "1" : "0");
    } catch {
      // Preference only lives for this visit.
    }
  };

  const summary = useGetDashboardSummary({
    query: { queryKey: getGetDashboardSummaryQueryKey(), refetchInterval: 15_000, refetchOnWindowFocus: true },
  });
  const stores = useListStores({ query: { queryKey: getListStoresQueryKey() } });
  const cancellations = useListDeliveryCancellations({
    query: { queryKey: getListDeliveryCancellationsQueryKey(), refetchInterval: 15_000, refetchOnWindowFocus: true },
  });
  const awaitingCount = summary.data?.awaitingCourier ?? 0;
  const pendingOccurrences = cancellations.data?.length ?? 0;
  const alertCount = pendingOccurrences + (summary.data?.delayed ?? 0);
  const activeStores = (stores.data ?? []).filter((store) => store.active).length;
  const connected = !summary.isError && !stores.isError;

  useEffect(() => setDrawerOpen(false), [location]);

  const isAdmin = profile.role === "ADMIN";
  const nav: NavItem[] = [
    { href: "/", label: "Visão Geral", icon: LayoutGrid, match: (path) => path === "/" || path === "/user-portal" },
    { href: "/entregas", label: "Entregas", icon: Package, match: (path) => path === "/entregas" || path.startsWith("/deliveries/"), count: awaitingCount },
    { href: "/mapa", label: "Mapa em Tempo Real", icon: MapIcon, match: (path) => path === "/mapa" },
    { href: "/motoboys", label: "Motoboys", icon: Bike, match: (path) => path === "/motoboys" },
    ...(isAdmin ? [{ href: "/filiais", label: "Filiais", icon: Store, match: (path: string) => path === "/filiais" }] : []),
    { href: "/reports", label: "Relatórios", icon: ChartColumn, match: (path) => path === "/reports" },
  ];
  // "Configurações": profiles and access for admins; own account and password for the central.
  const settingsHref = isAdmin ? "/access" : "/account";

  const sidebar = (compact: boolean) => (
    <div className="flex h-full flex-col">
      <div className={compact ? "px-[11px] pt-7" : "px-6 pt-7"}>
        {compact ? (
          <Link href="/" className="block text-center text-[20px] font-bold leading-[23px] text-[var(--adm-primary)]" aria-label="Minas Mais Entregas, visão geral">MM</Link>
        ) : (
          <Link href="/" className="block" title="Visão geral">
            <span className="block text-[19px] font-bold leading-[23px] text-[var(--adm-primary)]">MINAS MAIS</span>{" "}
            <span className="mt-0.5 block text-[10px] font-semibold tracking-[3px] text-[var(--adm-muted)]">ENTREGAS</span>
          </Link>
        )}
      </div>
      <div className={`mt-8 h-px bg-[var(--adm-border)] ${compact ? "mx-[15px]" : "mx-6"}`} />
      {!compact && <p className="mt-6 px-6 text-[10px] font-semibold tracking-[1px] text-[var(--adm-muted)]">WORKSPACE</p>}
      <nav className={`flex flex-col gap-1.5 ${compact ? "mt-[51px] px-[11px]" : "mt-3 px-3"}`} aria-label="Navegação principal">
        {nav.map((item) => {
          const active = item.match(location);
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`adm-nav-item ${compact ? "justify-center px-0" : ""}`}
              aria-current={active ? "page" : undefined}
              aria-label={compact ? `${item.label}${item.count ? `, ${item.count} aguardando entregador` : ""}` : undefined}
              title={compact ? item.label : undefined}
            >
              <Icon size={20} strokeWidth={1.75} aria-hidden="true" />
              {!compact && <span className="min-w-0 flex-1 truncate">{item.label}</span>}
              {!compact && item.count ? (
                <span className="rounded-[5px] bg-[var(--adm-chip)] px-2 py-1 text-[10px] font-semibold leading-none text-[var(--adm-muted)]" aria-label={`${item.count} aguardando entregador`}>{item.count}</span>
              ) : null}
              {compact && item.count ? <span className="absolute right-1.5 top-1.5 size-2 rounded-full bg-[var(--adm-primary)]" aria-hidden="true" /> : null}
            </Link>
          );
        })}
      </nav>
      <div className={`mt-[44px] h-px bg-[var(--adm-border)] ${compact ? "mx-[15px]" : "mx-6"}`} />
      <div className={compact ? "mt-4 px-[11px]" : "mt-4 px-3"}>
        <Link
          href={settingsHref}
          className={`adm-nav-item ${compact ? "justify-center px-0" : ""}`}
          aria-current={location === settingsHref ? "page" : undefined}
          aria-label={compact ? "Configurações" : undefined}
          title={compact ? "Configurações" : undefined}
        >
          <Settings size={20} strokeWidth={1.75} aria-hidden="true" />
          {!compact && <span>Configurações</span>}
        </Link>
      </div>
      <div className="mt-auto">
        {!compact && (
          <div className="mx-4 mb-8 rounded-[10px] bg-[var(--adm-surface-soft)] px-3.5 py-3.5" role="status">
            <p className="flex items-center gap-2 text-[11px] font-medium text-[var(--adm-ink)]">
              <span className={`size-1.5 rounded-full ${connected ? "bg-[var(--adm-success)]" : "bg-[#d97706]"}`} aria-hidden="true" />
              {connected ? "Operação conectada" : "Reconectando…"}
            </p>
            <p className="mt-3 text-[11px] text-[var(--adm-muted)]">
              {stores.isLoading ? "Carregando filiais…" : `${activeStores} ${activeStores === 1 ? "filial ativa" : "filiais ativas"}`}
            </p>
          </div>
        )}
        {isDesktop && (
          <>
            <div className={`h-px bg-[var(--adm-border)] ${compact ? "mx-[15px]" : "mx-6"}`} />
            <div className={compact ? "px-[11px] py-4" : "px-3 py-4"}>
              <button
                type="button"
                className={`adm-nav-item w-full ${compact ? "justify-center px-0" : ""}`}
                onClick={toggleCollapsed}
                aria-label={compact ? "Expandir menu" : "Recolher menu"}
                title={compact ? "Expandir menu" : undefined}
              >
                <PanelLeft size={18} strokeWidth={1.75} aria-hidden="true" />
                {!compact && <span className="text-[11px] font-normal">Recolher menu</span>}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );

  return (
    <div className="admin-ui">
      {isDesktop && (
        <aside
          className={`fixed inset-y-0 left-0 z-30 overflow-y-auto border-r border-[var(--adm-border)] bg-white transition-[width] duration-200 ${collapsed ? "w-[72px]" : "w-[224px]"}`}
          aria-label="Menu lateral"
        >
          {sidebar(collapsed)}
        </aside>
      )}
      {!isDesktop && (
        <Sheet open={drawerOpen} onOpenChange={setDrawerOpen}>
          <SheetContent side="left" className="admin-ui w-[264px] max-w-[85vw] border-[var(--adm-border)] p-0">
            <SheetTitle className="sr-only">Menu</SheetTitle>
            {sidebar(false)}
          </SheetContent>
        </Sheet>
      )}
      <div className={`flex min-h-[100dvh] flex-col transition-[padding] duration-200 ${isDesktop ? (collapsed ? "pl-[72px]" : "pl-[224px]") : ""}`}>
        <AdminHeader
          profile={profile}
          alertCount={alertCount}
          onOpenMenu={!isDesktop ? () => setDrawerOpen(true) : undefined}
          onSearch={(term) => setLocation(term ? `/entregas?busca=${encodeURIComponent(term)}` : "/entregas")}
          onSignOut={() => void signOut()}
          onAlerts={() => {
            if (location === "/" || location === "/user-portal") document.getElementById("alertas")?.scrollIntoView({ behavior: "smooth", block: "start" });
            else setLocation("/?alertas=1");
          }}
        />
        <main className="mx-auto w-full max-w-[1376px] flex-1 px-4 pb-10 pt-6 sm:px-6 lg:px-7 lg:pt-7">{children}</main>
      </div>
    </div>
  );
}

function AdminHeader({
  profile,
  alertCount,
  onOpenMenu,
  onSearch,
  onSignOut,
  onAlerts,
}: {
  profile: AppUser;
  alertCount: number;
  onOpenMenu?: () => void;
  onSearch: (term: string) => void;
  onSignOut: () => void;
  onAlerts: () => void;
}) {
  const [term, setTerm] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        inputRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    onSearch(term.trim());
  };

  return (
    <header className="sticky top-0 z-20 flex h-[76px] items-center gap-3 border-b border-[var(--adm-border)] bg-white px-4 sm:px-6 lg:px-7">
      {onOpenMenu && (
        <button type="button" className="adm-icon-button -ml-1" onClick={onOpenMenu} aria-label="Abrir menu">
          <Menu size={20} aria-hidden="true" />
        </button>
      )}
      <div className="flex min-w-0 items-center gap-[18px]">
        <p className="truncate text-[17px] font-semibold text-[var(--adm-ink)]">Minas Mais Entregas</p>
        <span className="hidden h-[22px] w-px bg-[var(--adm-border)] sm:block" aria-hidden="true" />
        <p className="hidden text-[12px] text-[var(--adm-muted)] sm:block">Administrativo</p>
      </div>
      <form onSubmit={submit} className="relative ml-auto hidden w-full max-w-[382px] md:block lg:ml-[118px] lg:mr-auto" role="search">
        <Search size={18} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[var(--adm-muted)]" aria-hidden="true" />
        <input
          ref={inputRef}
          type="search"
          value={term}
          onChange={(event) => setTerm(event.target.value)}
          placeholder="Buscar entrega, motoboy ou filial…"
          aria-label="Buscar entrega, motoboy ou filial"
          className="!h-10 !w-full !rounded-[8px] !border !border-[#edf0f3] !bg-[var(--adm-surface-soft)] !py-0 !pl-10 !pr-14 !text-[12px] !text-[var(--adm-ink)] placeholder:!text-[var(--adm-muted)]"
        />
        <kbd className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 rounded-[4px] border border-[var(--adm-border)] bg-white px-1.5 py-0.5 font-sans text-[10px] text-[var(--adm-muted)]">{isMac ? "⌘ K" : "Ctrl K"}</kbd>
      </form>
      <div className="ml-auto flex shrink-0 items-center gap-2 md:ml-0 lg:gap-[22px]">
        <button type="button" className="adm-icon-button relative" onClick={onAlerts} aria-label={alertCount ? `Alertas da operação: ${alertCount}` : "Alertas da operação: nenhum"}>
          <Bell size={21} strokeWidth={1.75} aria-hidden="true" />
          {alertCount > 0 && <span className="absolute right-[7px] top-[6px] size-1.5 rounded-full bg-[var(--adm-primary)]" aria-hidden="true" />}
        </button>
        <span className="hidden h-8 w-px bg-[var(--adm-border)] sm:block" aria-hidden="true" />
        <DropdownMenu>
          <DropdownMenuTrigger className="flex items-center gap-3 rounded-[10px] py-1 pl-1 pr-2 text-left hover:bg-[var(--adm-surface-soft)]">
            <span className="sr-only">Abrir menu da conta: </span>
            <span className="grid size-[38px] shrink-0 place-items-center rounded-full bg-[var(--adm-chip)] text-[var(--adm-muted)]" aria-hidden="true"><UserRound size={19} strokeWidth={1.75} /></span>
            <span className="hidden min-w-0 sm:block">
              <span className="block max-w-[160px] truncate text-[12px] font-semibold text-[var(--adm-ink)]">{profile.name}</span>
              <span className="mt-1 block text-[11px] text-[var(--adm-muted)]">{roleLabels[profile.role] ?? profile.role}</span>
            </span>
            <ChevronDown size={16} className="ml-1 hidden text-[var(--adm-muted)] sm:block lg:ml-[60px]" aria-hidden="true" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="admin-ui !min-h-0 w-56">
            <DropdownMenuLabel className="truncate text-xs font-normal text-[var(--adm-muted)]">{profile.email}</DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem asChild>
              <Link href="/account" className="flex cursor-pointer items-center gap-2"><KeyRound size={15} aria-hidden="true" /> Minha conta e senha</Link>
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={onSignOut} className="flex cursor-pointer items-center gap-2 text-[var(--adm-primary)]">
              <LogOut size={15} aria-hidden="true" /> Sair
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
}
