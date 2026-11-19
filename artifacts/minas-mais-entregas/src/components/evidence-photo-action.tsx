import { useEffect, useRef, useState } from "react";
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
async function compressPhoto(file: File, forceJpeg = false): Promise<Blob> {
  try {
    const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" } as ImageBitmapOptions);
    const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext("2d")?.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.72));
    // Formato que o servidor não aceita (ex.: HEIC da galeria, ou foto da câmera sem tipo): sempre vira JPEG.
    return blob && (forceJpeg || blob.size < file.size) ? blob : file;
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
  requiresPrescription = false,
}: {
  deliveryId: string;
  onComplete: (evidencePath: string, options: { prescriptionCollected: boolean }) => Promise<void>;
  disabled?: boolean;
  label?: string;
  confirmationLabel?: string;
  /** Medicamento com receita: o motoboy confirma que recolheu a receita antes de concluir. */
  requiresPrescription?: boolean;
}) {
  const [prescriptionCollected, setPrescriptionCollected] = useState(false);
  const blockedByPrescription = requiresPrescription && !prescriptionCollected;
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
  // Depois de escolher a foto, o "deslizar para concluir" aparece abaixo da dobra (atrás da barra
  // inferior). Rola até ele para o motoboy não precisar procurar.
  const confirmRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!file) return;
    const frame = window.requestAnimationFrame(() =>
      confirmRef.current?.scrollIntoView({ block: "center", inline: "nearest", behavior: "smooth" }));
    return () => window.cancelAnimationFrame(frame);
  }, [file]);

  const submit = async () => {
    setError("");
    if (!file) {
      setError("Tire a foto de comprovação antes de concluir.");
      return;
    }
    if (blockedByPrescription) {
      setError("Marque que pegou a receita do cliente antes de concluir.");
      return;
    }
    if (file.size > maxInputBytes) {
      setError("A foto é grande demais. Tire outra foto.");
      return;
    }
    try {
      let evidencePath = uploadedPath;
      if (!evidencePath) {
        setStage("preparing");
        const photo = await compressPhoto(file, !acceptedTypes.includes(file.type));
        if (!acceptedTypes.includes(photo.type || file.type)) {
          throw new Error("Não deu para ler esta foto. Tire a foto pela câmera ou use JPEG ou PNG.");
        }
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
      await onComplete(evidencePath, { prescriptionCollected: requiresPrescription && prescriptionCollected });
      setFile(null);
      setUploadedPath(null);
      setPrescriptionCollected(false);
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
    <div className="min-w-0 space-y-2">
      <label className={`flex min-h-12 items-center justify-center gap-2 rounded-lg border border-dashed border-[#d8c6c3] bg-[#fbf7f5] px-3 py-2 text-xs font-semibold text-[#85434a] transition hover:bg-[#f8efed] ${disabled || submitting || requestUpload.isPending ? "cursor-not-allowed opacity-60" : "cursor-pointer"}`}>
        <Camera size={16} />
        <span>{file ? "Tirar outra foto" : "Tirar foto de comprovação"}</span>
        <input
          className="sr-only"
          type="file"
          // "image/*" + capture: no app Android (Capacitor) e no navegador do celular abre a câmera direto.
          // Com uma lista de tipos específicos o Capacitor cai no seletor de arquivos.
          accept="image/*"
          capture="environment"
          disabled={disabled || submitting || requestUpload.isPending}
          onChange={(event) => {
            setError("");
            setUploadedPath(null);
            setFile(event.target.files?.[0] ?? null);
          }}
          aria-label="Tirar foto de comprovação com a câmera"
          data-testid={`input-evidence-${deliveryId}`}
        />
      </label>
      {file && (
        <div className="flex items-center gap-3 rounded-lg border border-border bg-white p-2">
          <img src={preview} alt="Prévia da foto de comprovação" className="h-14 w-14 shrink-0 rounded-md object-cover" />
          <div className="min-w-0 flex-1">
            <div className="truncate text-xs font-semibold">{/^(JPEG|IMG|PXL)_/i.test(file.name) || !file.name ? "Foto da câmera" : file.name}</div>
            <div className="mt-1 text-xs text-muted-foreground">{uploadedPath ? "Foto já enviada · falta só confirmar" : "Será reduzida e enviada ao concluir"}</div>
          </div>
          <Check size={15} className="shrink-0 text-green-700" />
        </div>
      )}
      {file && requiresPrescription && (
        <label className="flex min-h-12 cursor-pointer items-center gap-3 rounded-lg border-2 border-[#e5b9bd] bg-[#fff6f6] px-3 py-2.5 text-sm font-semibold text-[#8f1d27]">
          <input
            type="checkbox"
            className="h-6 w-6 shrink-0 accent-[#c51c2a]"
            checked={prescriptionCollected}
            onChange={(event) => {
              setPrescriptionCollected(event.target.checked);
              setError("");
            }}
            disabled={submitting}
            data-testid={`checkbox-prescription-${deliveryId}`}
          />
          <span>Peguei a receita do cliente</span>
        </label>
      )}
      {error && <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-800">{error}</p>}
      {file ? (
        <div ref={confirmRef} className="space-y-2 scroll-mb-28">
          {blockedByPrescription && (
            <p className="text-center text-xs font-semibold text-[#8f1d27]">Marque a receita acima para liberar a conclusão.</p>
          )}
          <SwipeToConfirm
            disabled={disabled || submitting || requestUpload.isPending || blockedByPrescription}
            onConfirm={() => void submit()}
            label={confirmationLabel}
          />
          {(disabled || submitting || requestUpload.isPending) && !blockedByPrescription && (
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
        </div>
      ) : (
        <p className="rounded-md bg-[#f7f4f1] px-3 py-2 text-center text-xs text-muted-foreground">
          {disabled
            ? "Aguarde a ação atual terminar antes de anexar a confirmação."
            : requiresPrescription
              ? "Esta entrega tem receita: tire a foto e depois marque que pegou a receita."
              : "Adicione uma foto para confirmar."}
        </p>
      )}
    </div>
  );
}
