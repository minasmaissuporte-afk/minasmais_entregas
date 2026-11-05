import { useEffect, useState } from "react";
import { Camera, Check, LoaderCircle } from "lucide-react";
import { useRequestDeliveryEvidenceUploadUrl } from "@workspace/api-client-react";
import SwipeToConfirm from "./swipe-to-confirm";

const acceptedTypes = ["image/jpeg", "image/png", "image/webp"];
const maxBytes = 8 * 1024 * 1024;

export default function EvidencePhotoAction({
  deliveryId,
  onComplete,
  disabled = false,
  label = "Enviar foto e concluir entrega",
  confirmationLabel = "Deslize para enviar a foto e concluir",
}: {
  deliveryId: string;
  onComplete: (evidencePath: string) => Promise<void>;
  disabled?: boolean;
  label?: string;
  confirmationLabel?: string;
}) {
  const requestUpload = useRequestDeliveryEvidenceUploadUrl();
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const preview = file ? URL.createObjectURL(file) : "";
  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview); }, [preview]);

  const submit = async () => {
    setError("");
    if (!file) {
      setError("Anexe ou capture uma foto antes de concluir.");
      return;
    }
    if (!acceptedTypes.includes(file.type) || file.size > maxBytes) {
      setError("Use uma imagem JPEG, PNG ou WebP de até 8 MB.");
      return;
    }
    setSubmitting(true);
    try {
      const upload = await requestUpload.mutateAsync({
        deliveryId,
        data: { name: file.name || "comprovante.jpg", size: file.size, contentType: file.type as "image/jpeg" | "image/png" | "image/webp" },
      });
      const response = await fetch(upload.uploadURL, {
        method: "PUT",
        headers: { "Content-Type": file.type },
        body: file,
      });
      if (!response.ok) throw new Error("O envio da foto falhou. Verifique a conexão e tente novamente.");
      await onComplete(upload.objectPath);
      setFile(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Não foi possível enviar a foto. A entrega não foi concluída.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-2">
      <label className={`flex min-h-12 items-center justify-center gap-2 rounded-lg border border-dashed border-[#d8c6c3] bg-[#fbf7f5] px-3 py-2 text-xs font-semibold text-[#85434a] transition hover:bg-[#f8efed] ${disabled || submitting || requestUpload.isPending ? "cursor-not-allowed opacity-60" : "cursor-pointer"}`}>
        <Camera size={16} />
        <span>{file ? "Trocar foto de comprovação" : "Capturar ou anexar foto"}</span>
        <input
          className="sr-only"
          type="file"
          accept="image/jpeg,image/png,image/webp"
          capture="environment"
          disabled={disabled || submitting || requestUpload.isPending}
          onChange={(event) => {
            setError("");
            setFile(event.target.files?.[0] ?? null);
          }}
          aria-label="Capturar ou anexar foto de comprovação"
          data-testid={`input-evidence-${deliveryId}`}
        />
      </label>
      {file && (
        <div className="flex items-center gap-3 rounded-lg border border-border bg-white p-2">
          <img src={preview} alt="Prévia da foto de comprovação" className="h-14 w-14 rounded-md object-cover" />
          <div className="min-w-0 flex-1">
            <div className="truncate text-xs font-semibold">{file.name || "Foto capturada"}</div>
            <div className="mt-1 text-[10px] text-muted-foreground">{(file.size / 1024 / 1024).toFixed(1)} MB · somente será enviada ao concluir</div>
          </div>
          <Check size={15} className="text-green-700" />
        </div>
      )}
      {error && <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-xs text-red-800">{error}</p>}
      {file ? (
        <>
          <SwipeToConfirm
            disabled={disabled || submitting || requestUpload.isPending}
            onConfirm={() => void submit()}
            label={confirmationLabel}
          />
          {(disabled || submitting || requestUpload.isPending) && (
            <p className="flex items-center gap-2 text-xs text-muted-foreground" role="status" aria-live="polite">
              <LoaderCircle size={14} className="animate-spin" />
              {disabled ? "Aguarde a ação atual terminar." : "Enviando a foto e confirmando a entrega…"}
            </p>
          )}
        </>
      ) : (
        <p className="rounded-md bg-[#f7f4f1] px-3 py-2 text-center text-xs text-muted-foreground">
          {disabled
            ? "Aguarde a ação atual terminar antes de anexar a confirmação."
            : "Adicione uma foto para confirmar."}
        </p>
      )}
    </div>
  );
}
