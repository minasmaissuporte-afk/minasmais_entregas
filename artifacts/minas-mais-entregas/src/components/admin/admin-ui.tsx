import type { ButtonHTMLAttributes, HTMLAttributes, ReactNode, SelectHTMLAttributes } from "react";
import { ChevronDown, LoaderCircle, Search, WifiOff } from "lucide-react";
import { statusLabel } from "@/components/delivery-status";

/*
 * Building blocks of the administrative dashboard, following the Figma file
 * "Dashboard Administrativo Minas Mais Entregas" (Biblioteca UI): Indicador,
 * Status da operação, Filtro / Padrão, Botão de ação and the panel states.
 * Colors and sizes come from the design tokens in index.css (`--adm-*`).
 */

export function Card({ children, className = "", ...props }: { children: ReactNode; className?: string } & HTMLAttributes<HTMLElement>) {
  return <section className={`adm-card ${className}`} {...props}>{children}</section>;
}

export function CardHeader({ title, aside, children }: { title: ReactNode; aside?: ReactNode; children?: ReactNode }) {
  return (
    <div className="flex min-h-[64px] flex-wrap items-center justify-between gap-x-4 gap-y-2 px-5 py-4">
      <div className="flex min-w-0 flex-wrap items-center gap-x-6 gap-y-1">
        <h2 className="text-[16px] font-semibold text-[var(--adm-ink)]">{title}</h2>
        {children}
      </div>
      {aside}
    </div>
  );
}

/** Figma "Indicador": 100px tall card with label, value and context line. */
export function Indicator({
  label,
  value,
  context,
  contextTone = "muted",
  highlight = false,
  loading = false,
}: {
  label: string;
  value: ReactNode;
  context: ReactNode;
  contextTone?: "muted" | "success" | "danger";
  highlight?: boolean;
  loading?: boolean;
}) {
  const toneClass = contextTone === "success" ? "text-[var(--adm-success)]" : contextTone === "danger" ? "text-[var(--adm-primary)]" : "text-[var(--adm-muted)]";
  return (
    <div className={`adm-card flex min-h-[100px] flex-col px-4 pb-3 pt-3.5 ${highlight ? "border-[#f0ccd1]" : ""}`}>
      <span className="text-[12px] font-medium text-[var(--adm-muted)]">{label}</span>
      {loading ? (
        <span className="adm-skeleton mt-2 h-8 w-16" aria-hidden="true" />
      ) : (
        <strong className="mt-1 text-[29px] font-semibold leading-[1.2] tracking-[-0.01em] text-[var(--adm-ink)] tabular-nums">{value}</strong>
      )}
      <span className={`mt-auto pt-1 text-[11px] ${toneClass}`}>{loading ? " " : context}</span>
    </div>
  );
}

export type PillTone = "info" | "success" | "danger" | "warning" | "neutral";

const pillToneClass: Record<PillTone, string> = {
  info: "bg-[var(--adm-info-bg)] text-[var(--adm-info)]",
  success: "bg-[var(--adm-success-bg)] text-[var(--adm-success)]",
  danger: "bg-[var(--adm-danger-bg)] text-[var(--adm-primary)]",
  warning: "bg-[var(--adm-warning-bg)] text-[var(--adm-warning)]",
  neutral: "bg-[var(--adm-chip)] text-[var(--adm-muted)]",
};

/** Figma "Status da operação": dot + label pill. */
export function StatusPill({ tone, children }: { tone: PillTone; children: ReactNode }) {
  return (
    <span className={`inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-[6px] px-[9px] py-[5px] text-[11px] font-medium ${pillToneClass[tone]}`}>
      <span className="size-[5px] rounded-full bg-current" aria-hidden="true" />
      {children}
    </span>
  );
}

/** Delivery status in the dashboard vocabulary; an overdue active delivery reads "Atrasada". */
export function deliveryPill(status: string, delayed: boolean): { tone: PillTone; label: string } {
  if (delayed) return { tone: "danger", label: "Atrasada" };
  if (status === "IN_TRANSIT") return { tone: "info", label: "Em rota" };
  if (status === "COMPLETED") return { tone: "success", label: "Concluída" };
  if (status === "CANCELLED" || status === "NOT_DELIVERED") return { tone: "neutral", label: status === "CANCELLED" ? "Cancelada" : statusLabel(status) };
  if (status === "RETURNING_TO_STORE") return { tone: "warning", label: statusLabel(status) };
  if (["ACCEPTED", "TO_STORE", "AT_STORE"].includes(status)) return { tone: "info", label: statusLabel(status) };
  return { tone: "neutral", label: statusLabel(status) };
}

/** Figma "Filtro / Padrão" (198 × 38) as an accessible native select. */
export function FilterSelect({ label, children, className = "", ...props }: { label: string } & SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <label className={`relative block ${className}`}>
      <span className="sr-only">{label}</span>
      <select className="adm-select" {...props}>{children}</select>
      <ChevronDown size={16} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[var(--adm-muted)]" aria-hidden="true" />
    </label>
  );
}

/** Figma "Botão de ação". */
export function ActionButton({ variant = "primary", children, className = "", ...props }: { variant?: "primary" | "secondary" } & ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button type="button" className={`adm-action adm-action--${variant} ${className}`} {...props}>
      {children}
    </button>
  );
}

/** Figma "Estado do painel operacional": Carregando / Vazio / Erro. */
export function PanelState({
  state,
  title,
  detail,
  action,
  footnote,
}: {
  state: "loading" | "empty" | "error";
  title: string;
  detail: string;
  action?: ReactNode;
  footnote?: string;
}) {
  if (state === "loading") {
    return (
      <div className="px-5 pb-6 pt-5" role="status" aria-live="polite">
        <div className="grid grid-cols-3 gap-3" aria-hidden="true">
          {[0, 1, 2].map((item) => (
            <div key={item} className="h-11 rounded-[7px] bg-[var(--adm-chip)] p-2.5"><div className="h-2 w-[50px] rounded bg-[var(--adm-border-strong)]" /></div>
          ))}
        </div>
        <div className="mt-5 grid h-24 place-items-center rounded-[8px] bg-[var(--adm-surface-soft)]" aria-hidden="true">
          <LoaderCircle size={28} className="animate-spin text-[var(--adm-primary)]" />
        </div>
        <p className="mt-5 text-[16px] font-semibold text-[var(--adm-ink)]">{title}</p>
        <p className="mt-1 text-[12px] text-[var(--adm-muted)]">{detail}</p>
      </div>
    );
  }
  return (
    <div className="flex flex-col items-center px-6 pb-6 pt-7 text-center" role={state === "error" ? "alert" : "status"}>
      <span className={`grid size-14 place-items-center rounded-full ${state === "error" ? "bg-[var(--adm-danger-bg)] text-[var(--adm-primary)]" : "bg-[var(--adm-chip)] text-[var(--adm-muted)]"}`} aria-hidden="true">
        {state === "error" ? <WifiOff size={24} /> : <Search size={24} />}
      </span>
      <p className="mt-5 text-[19px] font-semibold leading-[1.5] text-[var(--adm-ink)]">{title}</p>
      <p className="mt-1 max-w-[352px] text-[12px] leading-[1.5] text-[var(--adm-muted)]">{detail}</p>
      {action && <div className="mt-6">{action}</div>}
      {footnote && <p className="mt-3 text-[11px] text-[var(--adm-muted)]">{footnote}</p>}
    </div>
  );
}
