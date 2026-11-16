import { useCallback, useEffect, useState } from "react";
import {
  getGetVapidPublicKeyQueryKey,
  useGetVapidPublicKey,
  useSavePushSubscription,
} from "@workspace/api-client-react";

/** Avisa os outros componentes da página quando a inscrição muda. */
const PUSH_CHANGED_EVENT = "minas-mais:push-subscription-changed";

function urlBase64ToUint8Array(value: string) {
  const base64 = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = `${base64}${"=".repeat((4 - (base64.length % 4)) % 4)}`;
  const bytes = Uint8Array.from(window.atob(padded), (character) => character.charCodeAt(0));
  if (bytes.length !== 65 || bytes[0] !== 0x04) {
    throw new Error("A chave pública de notificações é inválida.");
  }
  return bytes;
}

/**
 * Service Worker do PWA. Ele só é registrado na versão de produção (ver main.tsx);
 * em desenvolvimento não existe, e `navigator.serviceWorker.ready` nunca resolveria.
 */
async function getServiceWorker(): Promise<ServiceWorkerRegistration | null> {
  const registration = await navigator.serviceWorker.getRegistration();
  if (!registration) return null;
  if (registration.active) return registration;
  // Registrado mas ainda instalando: espera até 10 s ficar ativo.
  return Promise.race([
    navigator.serviceWorker.ready,
    new Promise<null>((resolve) => window.setTimeout(() => resolve(null), 10_000)),
  ]);
}

const NO_SERVICE_WORKER_MESSAGE = import.meta.env.DEV
  ? "Em modo de desenvolvimento as notificações ficam desligadas. Teste na versão de produção (build) ou no sistema publicado."
  : "O serviço de notificações ainda está carregando. Atualize a página e tente de novo.";

function browserSupportsPush() {
  return (
    typeof window !== "undefined" &&
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    "Notification" in window
  );
}

/**
 * Notificações do navegador (Web Push) para administradores e central.
 * `activate` precisa ser chamado a partir de um clique: o navegador só mostra o
 * pedido de permissão em resposta a uma ação do usuário.
 */
export function usePushNotifications() {
  const key = useGetVapidPublicKey({
    query: { queryKey: getGetVapidPublicKeyQueryKey(), retry: false },
  });
  const savePush = useSavePushSubscription();
  const [enabled, setEnabled] = useState(false);
  const [checking, setChecking] = useState(true);
  const [message, setMessage] = useState("");
  const supported = browserSupportsPush();
  const publicKey = key.data?.publicKey;
  const blocked = supported && Notification.permission === "denied";

  const refresh = useCallback(async () => {
    if (!supported) {
      setChecking(false);
      return;
    }
    try {
      const registration = await getServiceWorker();
      const subscription = registration ? await registration.pushManager.getSubscription() : null;
      setEnabled(Boolean(subscription) && Notification.permission === "granted");
    } catch {
      setMessage("O Service Worker ainda não está disponível neste navegador.");
    } finally {
      setChecking(false);
    }
  }, [supported]);

  useEffect(() => {
    void refresh();
    const onChanged = () => void refresh();
    window.addEventListener(PUSH_CHANGED_EVENT, onChanged);
    return () => window.removeEventListener(PUSH_CHANGED_EVENT, onChanged);
  }, [refresh]);

  const activate = useCallback(async () => {
    setMessage("");
    try {
      if (!supported) {
        throw new Error("Este navegador não permite notificações. Use o Chrome, o Edge ou o app instalado.");
      }
      if (!publicKey) throw new Error("As notificações ainda não estão configuradas no servidor.");
      const applicationServerKey = urlBase64ToUint8Array(publicKey);
      if (Notification.permission === "denied") {
        throw new Error("As notificações estão bloqueadas. Libere em: cadeado ao lado do endereço → Notificações → Permitir.");
      }
      if (Notification.permission !== "granted") {
        const permission = await Notification.requestPermission();
        if (permission !== "granted") throw new Error("Permita notificações para receber os avisos.");
      }
      const registration = await getServiceWorker();
      if (!registration) throw new Error(NO_SERVICE_WORKER_MESSAGE);
      let subscription = await registration.pushManager.getSubscription();
      if (subscription) {
        const current = subscription.options.applicationServerKey;
        const bytes = current ? new Uint8Array(current) : null;
        const matches = Boolean(
          bytes &&
            bytes.length === applicationServerKey.length &&
            bytes.every((byte, index) => byte === applicationServerKey[index]),
        );
        if (!matches) {
          await subscription.unsubscribe();
          subscription = null;
        }
      }
      subscription ??= await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: applicationServerKey.buffer as ArrayBuffer,
      });
      const json = subscription.toJSON();
      if (!json.endpoint || !json.keys?.p256dh || !json.keys.auth) {
        throw new Error("O navegador não retornou uma inscrição válida.");
      }
      await savePush.mutateAsync({
        data: { endpoint: json.endpoint, p256dh: json.keys.p256dh, auth: json.keys.auth },
      });
      setEnabled(true);
      setMessage("Notificações ativadas neste navegador.");
      window.dispatchEvent(new Event(PUSH_CHANGED_EVENT));
      return true;
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Não foi possível ativar notificações.");
      return false;
    }
  }, [publicKey, savePush, supported]);

  return {
    supported,
    enabled,
    blocked,
    checking: checking || key.isLoading,
    pending: savePush.isPending,
    message,
    clearMessage: () => setMessage(""),
    activate,
  };
}
