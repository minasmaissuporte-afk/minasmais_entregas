import { Check, X } from "lucide-react";

type ProgressEvent = { kind: string; timestamp: string; label?: string };

/**
 * As quatro informações importantes de uma entrega:
 * 1. Solicitada (inclui a oferta enviada aos motoboys)
 * 2. Aceita
 * 3. Retirada (chegada à loja + retirada confirmada)
 * 4. Concluída
 */
export const DELIVERY_STEPS = ["Solicitada", "Aceita", "Retirada", "Concluída"] as const;

export function deliveryStage(status: string): number {
  if (["ACCEPTED", "TO_STORE", "AT_STORE"].includes(status)) return 1;
  if (["IN_TRANSIT", "RETURNING_TO_STORE"].includes(status)) return 2;
  if (status === "COMPLETED") return 3;
  return 0;
}

const stepKinds: string[][] = [
  ["requested", "offered"],
  ["accepted"],
  ["in_transit"],
  ["completed"],
];

const time = (value?: string) =>
  value ? new Date(value).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }) : null;

export default function DeliveryProgress({
  status,
  events,
  createdAt,
  compact = false,
}: {
  status: string;
  events: ProgressEvent[];
  createdAt?: string;
  compact?: boolean;
}) {
  const stopped = ["CANCELLED", "NOT_DELIVERED"].includes(status);
  const current = deliveryStage(status);
  // Último evento de cada etapa (uma entrega reenviada volta para "Solicitada").
  const stamps = stepKinds.map((kinds, index) => {
    const found = [...events].reverse().find((event) => kinds.includes(event.kind));
    return found?.timestamp ?? (index === 0 ? createdAt : undefined);
  });
  const stoppedEvent = stopped
    ? [...events].reverse().find((event) => ["cancelled", "not_delivered", "product_returned"].includes(event.kind))
    : undefined;

  return (
    <div data-testid="delivery-progress">
      <ol className={`grid grid-cols-4 ${compact ? "gap-1" : "gap-2"}`} aria-label="Andamento da entrega">
        {DELIVERY_STEPS.map((label, index) => {
          const done = !stopped && (index < current || (index === current && (status === "COMPLETED" || index === 0 || current > 0)));
          const active = !stopped && index === current && status !== "COMPLETED";
          const reached = stopped ? index === 0 || Boolean(stamps[index] && index <= current) : index <= current;
          return (
            <li key={label} className="min-w-0" aria-current={active ? "step" : undefined}>
              <div className={`h-1.5 rounded-full ${reached ? (stopped ? "bg-[#c7c3bf]" : "bg-[#b91e2c]") : "bg-[#ebe8e4]"}`} />
              <div className={`mt-1.5 flex items-center gap-1 ${compact ? "text-[11px]" : "text-xs"} font-semibold ${reached ? "text-[#2b2e33]" : "text-[#6b7079]"}`}>
                {done && index < current && <Check size={12} className="shrink-0 text-[#28794f]" aria-hidden="true" />}
                <span className="truncate">{label}</span>
              </div>
              {!compact && (
                <div className="text-[11px] text-muted-foreground">{reached && stamps[index] ? time(stamps[index]) : "—"}</div>
              )}
            </li>
          );
        })}
      </ol>
      {stopped && (
        <p className={`mt-2 flex items-start gap-1.5 rounded-md bg-[#f6f4f1] px-2.5 py-1.5 ${compact ? "text-[11px]" : "text-xs"} text-[#5f6268]`}>
          <X size={13} className="mt-0.5 shrink-0" aria-hidden="true" />
          <span>{stoppedEvent?.label ?? (status === "CANCELLED" ? "Entrega cancelada" : "Entrega não realizada")}{stoppedEvent ? ` · ${time(stoppedEvent.timestamp)}` : ""}</span>
        </p>
      )}
    </div>
  );
}
