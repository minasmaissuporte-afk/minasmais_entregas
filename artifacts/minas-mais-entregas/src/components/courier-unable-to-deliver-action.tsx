import { useQueryClient } from "@tanstack/react-query";
import {
  getListCourierRoutesQueryKey,
  getListDeliveriesQueryKey,
  useCreateCourierDeliveryCancellation,
  useListDeliveryCancellationReasons,
} from "@workspace/api-client-react";
import { AlertTriangle, ArrowLeft, ArrowRight, CheckCircle2, LoaderCircle, XCircle } from "lucide-react";
import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { triggerCourierLightHaptic } from "@/lib/courier-haptics";

function errorMessage(error: unknown) {
  if (error && typeof error === "object" && "data" in error) {
    const data = (error as { data?: unknown }).data;
    if (data && typeof data === "object" && "error" in data) {
      const message = (data as { error?: unknown }).error;
      if (typeof message === "string") return message;
    }
  }
  return "Não foi possível registrar a ocorrência. Tente novamente.";
}

export default function CourierUnableToDeliverAction({
  deliveryId,
  disabled = false,
  className = "",
  onCompleted,
}: {
  deliveryId: string;
  disabled?: boolean;
  className?: string;
  onCompleted?: () => void;
}) {
  const queryClient = useQueryClient();
  const reasons = useListDeliveryCancellationReasons();
  const cancellation = useCreateCourierDeliveryCancellation();
  const [open, setOpen] = useState(false);
  const [selectedReason, setSelectedReason] = useState("");
  const [observation, setObservation] = useState("");
  const [step, setStep] = useState<"reason" | "confirm">("reason");
  const [error, setError] = useState("");

  const close = (nextOpen: boolean) => {
    setOpen(nextOpen);
    if (!nextOpen) {
      setSelectedReason("");
      setObservation("");
      setStep("reason");
      setError("");
    }
  };

  const submit = async () => {
    if (!selectedReason) return;
    setError("");
    try {
      await cancellation.mutateAsync({
        deliveryId,
        data: {
          reason: selectedReason,
          ...(observation.trim() ? { observation: observation.trim() } : {}),
        },
      });
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: getListCourierRoutesQueryKey() }),
        queryClient.invalidateQueries({ queryKey: getListDeliveriesQueryKey() }),
      ]);
      void triggerCourierLightHaptic();
      close(false);
      onCompleted?.();
    } catch (submitError) {
      setError(errorMessage(submitError));
    }
  };

  return (
    <>
    <Dialog open={open} onOpenChange={close}>
      <DialogTrigger asChild>
        <button
          type="button"
          disabled={disabled}
          className={`button-outlined min-h-12 ${className}`}
        >
          <XCircle size={16} /> Não consigo entregar
        </button>
      </DialogTrigger>
      <DialogContent className="courier-cancellation-dialog max-h-[90dvh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Informar problema na entrega</DialogTitle>
          <DialogDescription>
            A Central receberá o motivo e poderá orientar os próximos passos.
          </DialogDescription>
        </DialogHeader>

        {step === "reason" ? (
          <div className="space-y-3">
            <div className="grid gap-2">
              {reasons.data?.map((reason) => (
                <button
                  key={reason.id}
                  type="button"
                  onClick={() => {
                    setSelectedReason(reason.label);
                    setError("");
                  }}
                  aria-pressed={selectedReason === reason.label}
                  className={`min-h-12 rounded-lg border px-3 py-2 text-left text-sm font-medium ${
                    selectedReason === reason.label
                      ? "border-primary bg-primary/5 text-primary"
                      : "border-border bg-white hover:bg-muted/40"
                  }`}
                >
                  {reason.label}
                </button>
              ))}
              {reasons.isLoading && (
                <p className="py-3 text-sm text-muted-foreground">Carregando motivos…</p>
              )}
              {reasons.isError && (
                <div role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">
                  Não foi possível carregar os motivos. Feche e tente novamente.
                </div>
              )}
              {!reasons.isLoading && !reasons.isError && !reasons.data?.length && (
                <p className="py-3 text-sm text-muted-foreground">Nenhum motivo está ativo.</p>
              )}
            </div>
            <label className="block text-sm font-medium">
              Observação (opcional)
              <Textarea
                className="mt-2 min-h-24"
                maxLength={500}
                value={observation}
                onChange={(event) => setObservation(event.target.value)}
                placeholder="Descreva algum detalhe importante"
              />
            </label>
            {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
            <DialogFooter className="gap-2 sm:gap-2">
              <button type="button" className="button-quiet min-h-12" onClick={() => close(false)}>
                Voltar
              </button>
              <button
                type="button"
                className="button-primary min-h-12"
                disabled={!selectedReason || reasons.isLoading || reasons.isError}
                onClick={() => setStep("confirm")}
              >
                <ArrowRight size={15} /> Continuar
              </button>
            </DialogFooter>
            {!selectedReason && !reasons.isLoading && Boolean(reasons.data?.length) && (
              <p className="text-xs text-muted-foreground" role="status">Selecione um motivo para liberar a continuação.</p>
            )}
          </div>
        ) : (
          <div className="space-y-4">
            <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950">
              <div className="flex items-start gap-2 font-semibold">
                <AlertTriangle size={17} className="mt-0.5 shrink-0" />
                Tem certeza? A Central será avisada.
              </div>
              <p className="mt-2">{selectedReason}</p>
              {observation.trim() && (
                <p className="mt-1 text-xs text-amber-900/80">{observation.trim()}</p>
              )}
            </div>
            {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
            <DialogFooter className="gap-2 sm:gap-2">
              <button
                type="button"
                className="button-quiet min-h-12"
                disabled={cancellation.isPending}
                onClick={() => setStep("reason")}
              >
                <ArrowLeft size={15} /> Voltar
              </button>
              <button
                type="button"
                className="button-primary min-h-12"
                disabled={cancellation.isPending}
                onClick={() => void submit()}
              >
                {cancellation.isPending ? (
                  <><LoaderCircle size={15} className="animate-spin" /> Enviando…</>
                ) : (
                  <><CheckCircle2 size={15} /> Confirmar ocorrência</>
                )}
              </button>
            </DialogFooter>
            {cancellation.isPending && (
              <p className="text-xs text-muted-foreground" role="status">Enviando a ocorrência. Aguarde a resposta para evitar duplicidade.</p>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
    {disabled && (
      <p className="block text-xs text-muted-foreground" role="status">
        Aguarde a ação atual terminar para informar outra ocorrência.
      </p>
    )}
    </>
  );
}
