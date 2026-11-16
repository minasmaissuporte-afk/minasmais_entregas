import { useEffect, useState } from "react";
import { ImageOff, LoaderCircle, Maximize2 } from "lucide-react";
import { supabase } from "@/lib/auth";

/**
 * Foto de comprovação no detalhe da entrega.
 *
 * A API só aceita o login no cabeçalho `Authorization` (sessão do Supabase). Um link
 * comum (<a href>) abre a foto sem esse cabeçalho e recebe 401, por isso a foto é
 * baixada aqui com o token e exibida a partir de uma URL local (blob).
 */
export default function EvidencePhotoViewer({ apiBase, deliveryId }: { apiBase: string; deliveryId: string }) {
  const [url, setUrl] = useState<string | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");

  useEffect(() => {
    let objectUrl: string | null = null;
    let cancelled = false;
    setState("loading");
    (async () => {
      try {
        const token = (await supabase.auth.getSession()).data.session?.access_token;
        const response = await fetch(`${apiBase}/api/deliveries/${encodeURIComponent(deliveryId)}/evidence`, {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        });
        if (!response.ok) throw new Error(String(response.status));
        objectUrl = URL.createObjectURL(await response.blob());
        if (cancelled) return URL.revokeObjectURL(objectUrl);
        setUrl(objectUrl);
        setState("ready");
      } catch {
        if (!cancelled) setState("error");
      }
    })();
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [apiBase, deliveryId]);

  if (state === "loading") {
    return (
      <div className="mt-4 flex h-40 items-center justify-center rounded-lg bg-[#f7f6f4] text-sm text-muted-foreground" role="status">
        <LoaderCircle size={16} className="mr-2 animate-spin" aria-hidden="true" /> Carregando foto de comprovação…
      </div>
    );
  }
  if (state === "error" || !url) {
    return (
      <div className="mt-4 flex items-center gap-2 rounded-lg bg-[#f7f6f4] p-3 text-sm text-muted-foreground" role="status">
        <ImageOff size={16} aria-hidden="true" /> Não foi possível carregar a foto de comprovação. Atualize a página para tentar de novo.
      </div>
    );
  }
  return (
    <figure className="mt-4" data-testid={`evidence-photo-${deliveryId}`}>
      <img
        src={url}
        alt="Foto de comprovação da entrega"
        className="max-h-72 w-full rounded-lg border border-border bg-[#f7f6f4] object-contain"
      />
      <figcaption className="mt-2">
        <a
          className="button-secondary min-h-10"
          href={url}
          target="_blank"
          rel="noreferrer"
          data-testid={`link-evidence-${deliveryId}`}
        >
          <Maximize2 size={15} aria-hidden="true" /> Abrir foto em tamanho real
        </a>
      </figcaption>
    </figure>
  );
}
