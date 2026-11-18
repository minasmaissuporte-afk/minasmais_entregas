import { useEffect, useRef, useState } from "react";
import { Capacitor } from "@capacitor/core";
import { MessageCircle, X } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { supportWhatsAppUrl } from "@/lib/support";

function isInstalledApp() {
  if (Capacitor.isNativePlatform()) return true;
  if (typeof window === "undefined") return false;
  return (
    window.matchMedia?.("(display-mode: standalone)").matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

/**
 * Botão flutuante "Suporte" do site público (telas de entrada, sem login).
 * Não aparece com a sessão aberta nem no app/PWA instalado: lá o suporte fica no perfil.
 */
export function PublicSupportButton() {
  const { isLoaded, isSignedIn } = useAuth();
  const [open, setOpen] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
        triggerRef.current?.focus();
      }
    };
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!panelRef.current?.contains(target) && !triggerRef.current?.contains(target)) setOpen(false);
    };
    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("pointerdown", onPointerDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("pointerdown", onPointerDown);
    };
  }, [open]);

  if (!isLoaded || isSignedIn || isInstalledApp()) return null;

  return (
    <div className="support-fab">
      {open && (
        <div
          ref={panelRef}
          id="support-panel"
          role="dialog"
          aria-labelledby="support-panel-title"
          className="support-fab__panel"
          data-testid="support-panel"
        >
          <div className="flex items-start justify-between gap-3">
            <h2 id="support-panel-title" className="text-[15px] font-bold text-[#24272d]">Precisa de ajuda?</h2>
            <button
              type="button"
              className="icon-button-sm -mr-1 -mt-1 size-8"
              onClick={() => setOpen(false)}
              aria-label="Fechar"
            >
              <X size={16} aria-hidden="true" />
            </button>
          </div>
          <p className="mt-1.5 text-[13px] leading-relaxed text-[#5f6268]">
            Nossa equipe está disponível para ajudar você com o sistema de entregas.
          </p>
          <a
            href={supportWhatsAppUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="button-primary mt-4 min-h-10 w-full text-[13px]"
            onClick={() => setOpen(false)}
            data-testid="link-support-whatsapp"
          >
            <MessageCircle size={16} aria-hidden="true" /> Conversar no WhatsApp
          </a>
        </div>
      )}
      <button
        ref={triggerRef}
        type="button"
        className="support-fab__trigger"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-controls="support-panel"
        data-testid="button-support"
      >
        <MessageCircle size={16} aria-hidden="true" /> Suporte
      </button>
    </div>
  );
}
