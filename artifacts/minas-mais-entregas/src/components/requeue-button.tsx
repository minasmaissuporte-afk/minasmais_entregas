import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { RotateCcw } from "lucide-react";
import {
  getGetDashboardSummaryQueryKey,
  getGetDeliveryQueryKey,
  getListDeliveriesQueryKey,
  useDispatchDelivery,
} from "@workspace/api-client-react";

/** Status em que a entrega pode voltar para a fila dos motoboys com um clique. */
export const REQUEUE_STATUSES = ["AWAITING_COURIER", "NOT_DELIVERED", "RETURNING_TO_STORE", "REQUESTED"];

/** "Reenviar aos motoboys": a entrega volta para a fila de todos os motoboys da cidade. */
export default function RequeueButton({
  deliveryId,
  code,
  className = "button-primary",
  onDone,
  shortLabel = false,
}: {
  deliveryId: string;
  code: string;
  className?: string;
  /** Tabelas estreitas: só "Reenviar" (o nome completo fica na dica e no leitor de tela). */
  shortLabel?: boolean;
  onDone?: (message: string) => void;
}) {
  const qc = useQueryClient();
  const dispatch = useDispatchDelivery();
  const [error, setError] = useState("");
  const go = () => {
    setError("");
    dispatch.mutate(
      { deliveryId, data: { mode: "group" } },
      {
        onSuccess: () => {
          void qc.invalidateQueries({ queryKey: getListDeliveriesQueryKey() });
          void qc.invalidateQueries({ queryKey: getGetDeliveryQueryKey(deliveryId) });
          void qc.invalidateQueries({ queryKey: getGetDashboardSummaryQueryKey() });
          onDone?.(`${code} voltou para a fila dos motoboys.`);
        },
        onError: (mutationError) => {
          const apiError = mutationError as Error & { data?: { error?: string } };
          setError(apiError.data?.error ?? "Não foi possível reenviar. Atualize e tente de novo.");
        },
      },
    );
  };
  return (
    <span className="inline-flex flex-col items-stretch gap-1">
      <button
        type="button"
        className={className}
        onClick={go}
        disabled={dispatch.isPending}
        aria-busy={dispatch.isPending}
        data-testid={`button-requeue-${deliveryId}`}
        title="Reenviar aos motoboys"
      >
        <RotateCcw size={15} aria-hidden="true" /> {dispatch.isPending ? "Reenviando…" : shortLabel ? <>Reenviar<span className="sr-only"> aos motoboys</span></> : "Reenviar aos motoboys"}
      </button>
      {error && <span role="alert" className="text-xs text-red-700">{error}</span>}
    </span>
  );
}
