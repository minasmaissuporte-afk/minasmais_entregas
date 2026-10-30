import { useEffect, useState } from "react";
import { useUser } from "@clerk/react";
import { Bike, Download, Smartphone } from "lucide-react";
import { Link, Redirect } from "wouter";

type InstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

function InstallPwaAction() {
  const [installPrompt, setInstallPrompt] = useState<InstallPromptEvent | null>(null);
  const [installed, setInstalled] = useState(false);

  useEffect(() => {
    const isStandalone =
      window.matchMedia("(display-mode: standalone)").matches ||
      (navigator as Navigator & { standalone?: boolean }).standalone === true;
    setInstalled(isStandalone);

    const onBeforeInstallPrompt = (event: Event) => {
      event.preventDefault();
      setInstallPrompt(event as InstallPromptEvent);
    };
    const onAppInstalled = () => {
      setInstalled(true);
      setInstallPrompt(null);
    };
    window.addEventListener("beforeinstallprompt", onBeforeInstallPrompt);
    window.addEventListener("appinstalled", onAppInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onBeforeInstallPrompt);
      window.removeEventListener("appinstalled", onAppInstalled);
    };
  }, []);

  if (installed) {
    return <p className="text-sm font-medium text-green-800">Minas Mais já está instalado neste aparelho.</p>;
  }

  if (installPrompt) {
    return (
      <button
        className="button-secondary min-h-11"
        type="button"
        onClick={() => {
          void (async () => {
            await installPrompt.prompt();
            const choice = await installPrompt.userChoice;
            if (choice.outcome === "accepted") setInstalled(true);
            setInstallPrompt(null);
          })();
        }}
      >
        <Download size={16} /> Instalar no celular
      </button>
    );
  }

  const userAgent = navigator.userAgent;
  const isIos = /iPad|iPhone|iPod/.test(userAgent) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  return (
    <p className="text-xs leading-relaxed text-muted-foreground">
      {isIos
        ? "No Safari do iPhone, toque em Compartilhar e depois em Adicionar à Tela de Início."
        : "No Android, abra o menu do navegador e escolha Instalar app ou Adicionar à tela inicial."}
    </p>
  );
}

export default function CourierAccessPage() {
  const { isLoaded, isSignedIn } = useUser();

  if (isLoaded && isSignedIn) return <Redirect to="/user-portal" />;
  if (!isLoaded) {
    return <main className="grid min-h-[100dvh] place-items-center bg-[#f4f3f1] p-5"><div className="panel h-16 w-full max-w-sm animate-pulse" /></main>;
  }

  return (
    <main className="min-h-[100dvh] bg-[#f4f3f1] px-4 py-6 text-[#24272d] sm:px-8">
      <div className="mx-auto max-w-xl">
        <Link href="/" className="inline-flex items-center gap-3" aria-label="Voltar ao Minas Mais Entregas">
          <span className="brand-mark">MM</span>
          <span>
            <span className="block text-sm font-bold">MINAS MAIS</span>
            <span className="mt-0.5 block text-[10px] font-semibold uppercase tracking-[.16em] text-muted-foreground">Entregas</span>
          </span>
        </Link>

        <section className="panel mt-8 p-6 sm:mt-12 sm:p-8">
          <span className="metric-icon metric-icon-red"><Bike size={20} /></span>
          <div className="eyebrow mt-5">ACESSO DO MOTOBOY · PWA</div>
          <h1 className="mt-2 text-2xl font-bold tracking-tight sm:text-3xl">Suas entregas no celular</h1>
          <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
            Entre pelo navegador ou instale o Minas Mais na tela inicial. Não é necessário baixar o app pela App Store ou Google Play.
          </p>

          <div className="mt-6 grid gap-3 sm:grid-cols-2">
            <Link href="/sign-in" className="button-primary min-h-11 justify-center">Entrar na minha conta</Link>
            <Link href="/sign-up" className="button-secondary min-h-11 justify-center">Solicitar cadastro</Link>
          </div>

          <div className="mt-6 rounded-xl border border-border bg-[#faf9f7] p-4">
            <div className="flex items-center gap-2 text-sm font-semibold"><Smartphone size={16} /> Instalar como PWA</div>
            <div className="mt-2"><InstallPwaAction /></div>
          </div>

          <p className="mt-5 text-xs leading-relaxed text-muted-foreground">
            No primeiro acesso, um administrador precisa aprovar sua conta e vinculá-la ao seu cadastro de motoboy. Depois disso, suas rotas, entregas e valores aparecerão aqui.
          </p>
        </section>
      </div>
    </main>
  );
}
