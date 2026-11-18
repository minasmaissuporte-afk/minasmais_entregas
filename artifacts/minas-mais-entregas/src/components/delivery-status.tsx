import type { ReactNode } from "react";

/** pt-BR labels for delivery statuses, shared by the central panel and the store portal. */
// Quatro etapas principais: Solicitada (inclui a oferta aos motoboys), Aceita, Retirada
// (chegada à loja + retirada) e Concluída.
export const statusNames: Record<string, string> = {
  REQUESTED: "Solicitada", OFFERED: "Solicitada", AWAITING_COURIER: "Devolvida pelo motoboy",
  ACCEPTED: "Aceita", TO_STORE: "Aceita", AT_STORE: "Aceita",
  IN_TRANSIT: "Retirada", COMPLETED: "Concluída", CANCELLED: "Cancelada",
  RETURNING_TO_STORE: "Voltando para a loja", NOT_DELIVERED: "Não entregue",
};

export function statusLabel(status: string) {
  return statusNames[status] ?? status.replaceAll("_", " ");
}

export function Badge({ children, tone = "neutral" }: { children: ReactNode; tone?: string }) {
  return <span className={`inline-flex items-center rounded-full px-2.5 py-1 text-[11px] font-semibold tracking-[.01em] badge-${tone}`}>{children}</span>;
}

export function StatusBadge({ status }: { status: string }) {
  const tone = ["COMPLETED"].includes(status) ? "green" : ["CANCELLED"].includes(status) ? "muted" :
    ["IN_TRANSIT"].includes(status) ? "red" :
    ["AWAITING_COURIER", "RETURNING_TO_STORE", "NOT_DELIVERED"].includes(status) ? "amber" :
    ["OFFERED", "AWAITING_COURIER", "REQUESTED"].includes(status) ? "amber" : "blue";
  return <Badge tone={tone}>{statusLabel(status)}</Badge>;
}
