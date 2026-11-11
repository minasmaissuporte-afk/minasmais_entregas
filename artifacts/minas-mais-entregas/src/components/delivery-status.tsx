import type { ReactNode } from "react";

/** pt-BR labels for delivery statuses, shared by the central panel and the store portal. */
export const statusNames: Record<string, string> = {
  REQUESTED: "Solicitada", AWAITING_COURIER: "Aguardando entregador", OFFERED: "Oferta enviada",
  ACCEPTED: "Aceita", TO_STORE: "A caminho da loja", AT_STORE: "Na loja",
  IN_TRANSIT: "Em entrega", COMPLETED: "Concluída", CANCELLED: "Cancelado pela Central",
  RETURNING_TO_STORE: "Retornando à filial", NOT_DELIVERED: "Não entregue",
};

export function statusLabel(status: string) {
  return statusNames[status] ?? status.replaceAll("_", " ");
}

export function Badge({ children, tone = "neutral" }: { children: ReactNode; tone?: string }) {
  return <span className={`inline-flex items-center rounded-full px-2.5 py-1 text-[11px] font-semibold tracking-[.01em] badge-${tone}`}>{children}</span>;
}

export function StatusBadge({ status }: { status: string }) {
  const tone = ["COMPLETED"].includes(status) ? "green" : ["CANCELLED"].includes(status) ? "muted" :
    ["IN_TRANSIT", "TO_STORE", "AT_STORE"].includes(status) ? "red" :
    ["OFFERED", "AWAITING_COURIER", "REQUESTED"].includes(status) ? "amber" : "blue";
  return <Badge tone={tone}>{statusLabel(status)}</Badge>;
}
