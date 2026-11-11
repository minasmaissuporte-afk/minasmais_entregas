import { useEffect, useRef, useState } from "react";
import { LoaderCircle } from "lucide-react";

/**
 * Declining an offer cannot be undone, and a gloved thumb can hit it by accident
 * (it sits right under "Aceitar"). The first tap only opens a short confirmation;
 * the decline happens on the second, clearly labelled button.
 */
export default function CourierDeclineButton({
  label,
  busyLabel,
  question,
  detail,
  onConfirm,
  busy,
  disabled,
  className = "",
  testId,
}: {
  label: string;
  busyLabel: string;
  question: string;
  detail: string;
  onConfirm: () => void;
  busy: boolean;
  disabled?: boolean;
  className?: string;
  testId?: string;
}) {
  const [confirming, setConfirming] = useState(false);
  const keepRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (confirming) keepRef.current?.focus();
  }, [confirming]);

  if (busy) {
    return (
      <button type="button" className={`courier-decline-button ${className}`} disabled aria-busy="true" data-testid={testId}>
        <LoaderCircle size={15} className="animate-spin" /> {busyLabel}
      </button>
    );
  }

  if (confirming) {
    return (
      <div className="courier-decline-confirm" role="group" aria-label={question} data-testid={testId ? `${testId}-confirm` : undefined}>
        <p><strong>{question}</strong> {detail}</p>
        <div>
          <button ref={keepRef} type="button" className="button-secondary" onClick={() => setConfirming(false)}>
            Voltar
          </button>
          <button
            type="button"
            className="courier-decline-button"
            disabled={disabled}
            onClick={() => {
              setConfirming(false);
              onConfirm();
            }}
            data-testid={testId ? `${testId}-yes` : undefined}
          >
            Sim, recusar
          </button>
        </div>
      </div>
    );
  }

  return (
    <button
      type="button"
      className={`courier-decline-button ${className}`}
      disabled={disabled}
      onClick={() => setConfirming(true)}
      data-testid={testId}
    >
      {label}
    </button>
  );
}
