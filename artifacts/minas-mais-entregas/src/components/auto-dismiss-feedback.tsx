import { useEffect, useRef } from "react";
import { AlertTriangle, Check, X } from "lucide-react";

export type FeedbackMessage = {
  kind: "success" | "error";
  text: string;
};

export function AutoDismissFeedback({
  feedback,
  onDismiss,
  className = "",
}: {
  feedback: FeedbackMessage;
  onDismiss: () => void;
  className?: string;
}) {
  const dismissRef = useRef(onDismiss);
  dismissRef.current = onDismiss;

  useEffect(() => {
    if (feedback.kind !== "success") return;
    const timeout = window.setTimeout(() => dismissRef.current(), 5000);
    return () => window.clearTimeout(timeout);
  }, [feedback]);

  const isError = feedback.kind === "error";
  return (
    <div
      role={isError ? "alert" : "status"}
      className={`flex items-start gap-2 rounded-xl border px-4 py-3 text-sm ${
        isError
          ? "border-red-200 bg-red-50 text-red-800"
          : "border-green-200 bg-green-50 text-green-800"
      } ${className}`}
    >
      {isError ? (
        <AlertTriangle size={16} className="mt-0.5 shrink-0" />
      ) : (
        <Check size={16} className="mt-0.5 shrink-0" />
      )}
      <span className="min-w-0 flex-1">{feedback.text}</span>
      <button
        type="button"
        onClick={onDismiss}
        className="ml-auto grid h-6 w-6 shrink-0 place-items-center rounded-md opacity-70 hover:bg-black/5 hover:opacity-100"
        aria-label="Fechar mensagem"
        title="Fechar"
      >
        <X size={14} />
      </button>
    </div>
  );
}
