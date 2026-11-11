import { useEffect, useState } from "react";
import { Camera, Check, LoaderCircle } from "lucide-react";
import { useRequestDeliveryEvidenceUploadUrl } from "@workspace/api-client-react";
import SwipeToConfirm from "./swipe-to-confirm";

const acceptedTypes = ["image/jpeg", "image/png", "image/webp"];
/** Server limit for the stored proof photo. */
const maxBytes = 8 * 1024 * 1024;
/** Camera originals can be larger; they are shrunk on the phone before upload. */
const maxInputBytes = 30 * 1024 * 1024;
const maxSide = 1600;
const uploadTimeoutMs = 90_000;

type Stage = "idle" | "preparing" | "uploading" | "confirming";

/**
 * Shrinks a camera photo (often 4–8 MB) to a ~1600px JPEG (usually 200–500 KB),
 * which is what makes the upload viable on a weak mobile signal.
 * Falls back to the original file if the browser cannot decode it.
 */
async function compressPhoto(file: File): Promise<Blob> {
  try {
    const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" } as ImageBitmapOptions);
    const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext("2d")?.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.72));
    return blob && blob.size < file.size ? blob : file;
  } catch {
    return file;
  }
}

function uploadWithProgress(url: string, body: Blob, contentType: string, onProgress: (percent: number) => void) {
  return new Promise<void>((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open("PUT", url);
    request.setRequestHeader("Content-Type", contentType);
    request.timeout = uploadTimeoutMs;
    request.upload.onprogress = (event) => {
      if (event.lengthComputable) onProgress(Math.round((event.loaded / event.total) * 100));
    };
    request.onload = () => (request.status >= 200 && request.status < 300
      ? resolve()
      : reject(new Error("O envio da foto falhou. Verifique a conexão e tente novamente.")));
    request.onerror = () => reject(new Error("Sem conexão para enviar a foto. Ela continua aqui: tente de novo quando o sinal voltar."));
    request.ontimeout = () => reject(new Error("O envio da foto demorou demais. Ela continua aqui: tente de novo com sinal melhor."));
    request.send(body);
  });
}

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
  const [stage, setStage] = useState<Stage>("idle");
  const [progress, setProgress] = useState(0);
  // Once the photo is stored, a retry only needs to confirm the delivery again.
  const [uploadedPath, setUploadedPath] = useState<string | null>(null);
  const submitting = stage !== "idle";
  const preview = file ? URL.createObjectURL(file) : "";
  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview); }, [preview]);

  const submit = async () => {
    setError("");
    if (!file) {
      setError("Anexe ou capture uma foto antes de concluir.");
      return;
    }
    if (!acceptedTypes.includes(file.type) || file.size > maxInputBytes) {
      setError("Use uma foto JPEG, PNG ou WebP.");
      return;
    }
    try {
      let evidencePath = uploadedPath;
      if (!evidencePath) {
        setStage("preparing");
        const photo = await compressPhoto(file);
        if (photo.size > maxBytes) throw new Error("A foto ficou grande demais para enviar. Tire outra foto, um pouco mais de longe.");
        const contentType = (photo.type || file.type) as "image/jpeg" | "image/png" | "image/webp";
        const upload = await requestUpload.mutateAsync({
          deliveryId,
          data: { name: contentType === "image/jpeg" ? "comprovante.jpg" : file.name || "comprovante", size: photo.size, contentType },
        });
        setStage("uploading");
        setProgress(0);
        await uploadWithProgress(upload.uploadURL, photo, contentType, setProgress);
        evidencePath = upload.objectPath;
        setUploadedPath(evidencePath);
      }
      setStage("confirming");
      await onComplete(evidencePath);
      setFile(null);
      setUploadedPath(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Não foi possível enviar a foto. A entrega não foi concluída.");
    } finally {
      setStage("idle");
    }
  };

  const stageText = stage === "preparing"
    ? "Preparando a foto…"
    : stage === "uploading"
      ? `Enviando a foto… ${progress}%`
      : stage === "confirming"
        ? "Foto enviada. Confirmando a entrega…"
        : "";

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
            setUploadedPath(null);
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
            <div className="mt-1 text-xs text-muted-foreground">{uploadedPath ? "Foto já enviada · falta só confirmar" : "Será reduzida e enviada ao concluir"}</div>
          </div>
          <Check size={15} className="text-green-700" />
        </div>
      )}
      {error && <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-800">{error}</p>}
      {file ? (
        <>
          <SwipeToConfirm
            disabled={disabled || submitting || requestUpload.isPending}
            onConfirm={() => void submit()}
            label={confirmationLabel}
          />
          {(disabled || submitting || requestUpload.isPending) && (
            <div role="status" aria-live="polite">
              <p className="flex items-center gap-2 text-sm text-muted-foreground">
                <LoaderCircle size={14} className="animate-spin" />
                {submitting ? stageText : "Aguarde a ação atual terminar."}
              </p>
              {stage === "uploading" && (
                <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-[#eadfdf]" aria-hidden="true">
                  <div className="h-full rounded-full bg-[#E20210] transition-[width] duration-200" style={{ width: `${progress}%` }} />
                </div>
              )}
            </div>
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
