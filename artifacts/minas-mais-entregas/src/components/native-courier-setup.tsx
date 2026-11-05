import { useEffect, useState, type ReactNode } from "react";
import { App as CapacitorApp } from "@capacitor/app";
import { Capacitor, registerPlugin } from "@capacitor/core";
import { Geolocation } from "@capacitor/geolocation";
import { Preferences } from "@capacitor/preferences";
import { PushNotifications } from "@capacitor/push-notifications";
import { BatteryCharging, Bell, Check, MapPin, RefreshCw, Settings } from "lucide-react";

interface CourierDevicePermissionStatus {
  locationForeground: boolean;
  locationBackground: boolean;
  notifications: boolean;
  batteryExemption: boolean;
}

interface CourierDeviceSetupPlugin {
  checkPermissionStatus(): Promise<CourierDevicePermissionStatus>;
  requestBackgroundLocation(): Promise<CourierDevicePermissionStatus>;
  openLocationSettings(): Promise<void>;
  requestBatteryOptimizationExemption(): Promise<void>;
  openBatterySettings(): Promise<void>;
}

const DeviceSetup = registerPlugin<CourierDeviceSetupPlugin>("CourierDeviceSetup");

function setupIsComplete(status: CourierDevicePermissionStatus | null) {
  return Boolean(
    status?.locationForeground &&
      status.locationBackground &&
      status.notifications &&
      status.batteryExemption,
  );
}

function messageFor(error: unknown) {
  return error instanceof Error
    ? error.message
    : "Não foi possível verificar as permissões do aparelho.";
}

export default function NativeCourierSetupGate({
  userId,
  children,
}: {
  userId: string;
  children: ReactNode;
}) {
  const isNative = Capacitor.isNativePlatform();
  const [status, setStatus] = useState<CourierDevicePermissionStatus | null>(null);
  const [hasCompletedSetup, setHasCompletedSetup] = useState(false);
  const [busy, setBusy] = useState<"location" | "notifications" | "battery" | null>(null);
  const [errorMessage, setErrorMessage] = useState("");
  const [isRefreshing, setIsRefreshing] = useState(false);
  const setupKey = `native-courier-setup-complete:${userId}`;

  useEffect(() => {
    if (!isNative) return;
    let mounted = true;
    let appStateListener: { remove: () => Promise<void> } | undefined;

    const refresh = async () => {
      setIsRefreshing(true);
      try {
        const [nextStatus, savedSetup] = await Promise.all([
          DeviceSetup.checkPermissionStatus(),
          Preferences.get({ key: setupKey }),
        ]);
        if (!mounted) return;
        setStatus(nextStatus);
        setHasCompletedSetup(savedSetup.value === "true");
        if (setupIsComplete(nextStatus)) {
          setHasCompletedSetup(true);
          await Preferences.set({ key: setupKey, value: "true" });
        }
        setErrorMessage("");
      } catch (error) {
        if (mounted) setErrorMessage(messageFor(error));
      } finally {
        if (mounted) setIsRefreshing(false);
      }
    };

    void refresh();
    void CapacitorApp.addListener("appStateChange", ({ isActive }) => {
      if (isActive) void refresh();
    }).then((listener) => {
      if (mounted) appStateListener = listener;
      else void listener.remove();
    });

    return () => {
      mounted = false;
      void appStateListener?.remove();
    };
  }, [isNative, setupKey]);

  if (!isNative) return children;

  const allReady = setupIsComplete(status);
  const runAction = async (
    action: "location" | "notifications" | "battery",
    callback: () => Promise<void>,
  ) => {
    setBusy(action);
    setErrorMessage("");
    try {
      await callback();
      const nextStatus = await DeviceSetup.checkPermissionStatus();
      setStatus(nextStatus);
      if (setupIsComplete(nextStatus)) {
        setHasCompletedSetup(true);
        await Preferences.set({ key: setupKey, value: "true" });
      }
    } catch (error) {
      setErrorMessage(messageFor(error));
    } finally {
      setBusy(null);
    }
  };

  if (allReady) return children;

  if (hasCompletedSetup) {
    return (
      <div>
        <div
          className="sticky top-0 z-50 flex items-center justify-between gap-3 border-b border-red-300 bg-red-50 px-4 py-3 text-sm text-red-900"
          role="alert"
        >
          <span>Uma permissão necessária foi removida. Reative localização em segundo plano, notificações e a liberação de bateria nas configurações.</span>
          <button
            className="button-secondary min-h-12 shrink-0"
            type="button"
            onClick={() => setHasCompletedSetup(false)}
          >
            Corrigir
          </button>
        </div>
        {children}
      </div>
    );
  }

  if (!status) {
    return (
      <main className="grid min-h-[100dvh] place-items-center bg-[#f4f3f1] p-5">
        <section className="panel w-full max-w-lg p-6 text-center">
          <RefreshCw className="mx-auto animate-spin text-primary" size={22} />
          <p className="mt-3 text-sm font-semibold">Verificando as permissões do aparelho…</p>
          {errorMessage && <p role="alert" className="mt-3 text-sm text-red-700">{errorMessage}</p>}
        </section>
      </main>
    );
  }

  const permissionCards = [
    {
      id: "location" as const,
      title: "Localização o tempo todo",
      description: "Permita localização precisa e escolha “Permitir o tempo todo” para manter o mapa atualizado com a tela bloqueada.",
      complete: status.locationForeground && status.locationBackground,
      icon: MapPin,
      action: () =>
        runAction("location", async () => {
          if (!status.locationForeground) {
            await Geolocation.requestPermissions();
          }
          const next = await DeviceSetup.requestBackgroundLocation();
          if (!next.locationBackground) {
            await DeviceSetup.openLocationSettings();
          }
        }),
      label: status.locationForeground ? "Configurar localização" : "Permitir localização",
    },
    {
      id: "notifications" as const,
      title: "Notificações",
      description: "Autorize notificações para o Android exibir o aviso persistente enquanto o GPS estiver rastreando.",
      complete: status.notifications,
      icon: Bell,
      action: () =>
        runAction("notifications", async () => {
          await PushNotifications.requestPermissions();
        }),
      label: "Permitir notificações",
    },
    {
      id: "battery" as const,
      title: "Uso de bateria",
      description: "Permita que o aplicativo continue enviando a localização em segundo plano. Se o pedido direto não estiver disponível, abra as configurações de bateria.",
      complete: status.batteryExemption,
      icon: BatteryCharging,
      action: () =>
        runAction("battery", async () => {
          await DeviceSetup.requestBatteryOptimizationExemption();
        }),
      label: "Permitir em segundo plano",
    },
  ];

  return (
    <main className="min-h-[100dvh] bg-[#f4f3f1] px-4 py-8 sm:px-6">
      <section className="mx-auto w-full max-w-lg">
        <header className="mb-6 flex items-center gap-3">
          <span className="grid h-12 w-12 place-items-center rounded-2xl bg-[#a91d2a] text-sm font-bold text-white">MM</span>
          <div>
            <div className="text-sm font-bold">Minas Mais Entregas</div>
            <div className="text-xs text-muted-foreground">Configuração do motoboy</div>
          </div>
        </header>

        <section className="panel p-5 sm:p-6">
          <div className="eyebrow">PRIMEIRO ACESSO</div>
          <h1 className="mt-2 text-2xl font-bold">Prepare o rastreamento</h1>
          <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
            Para usar o app durante as entregas, habilite as três permissões abaixo. O GPS será compartilhado somente enquanto você estiver conectado.
          </p>

          <div className="mt-5 space-y-3">
            {permissionCards.map((card) => {
              const Icon = card.icon;
              return (
                <article key={card.id} className="rounded-xl border border-border bg-white p-4">
                  <div className="flex items-start gap-3">
                    <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-full ${card.complete ? "bg-green-100 text-green-800" : "bg-[#f7e7e9] text-primary"}`}>
                      {card.complete ? <Check size={18} /> : <Icon size={17} />}
                    </span>
                    <div className="min-w-0 flex-1">
                      <h2 className="text-sm font-bold">{card.title}</h2>
                      <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{card.description}</p>
                      <div className="mt-3 flex flex-wrap gap-2">
                        {!card.complete && (
                          <button
                            className="button-primary min-h-10"
                            type="button"
                            disabled={busy !== null}
                            onClick={() => void card.action()}
                          >
                            {busy === card.id ? "Aguardando…" : card.label}
                          </button>
                        )}
                        {card.id === "location" && !status.locationBackground && (
                          <button
                            className="button-secondary min-h-10"
                            type="button"
                            disabled={busy !== null}
                            onClick={() =>
                              void runAction("location", () => DeviceSetup.openLocationSettings())
                            }
                          >
                            <Settings size={15} /> Abrir configurações
                          </button>
                        )}
                        {card.id === "battery" && !status.batteryExemption && (
                          <button
                            className="button-secondary min-h-10"
                            type="button"
                            disabled={busy !== null}
                            onClick={() =>
                              void runAction("battery", () => DeviceSetup.openBatterySettings())
                            }
                          >
                            <Settings size={15} /> Abrir configurações de bateria
                          </button>
                        )}
                        {card.complete && <span className="self-center text-xs font-semibold text-green-800">Ativado</span>}
                      </div>
                    </div>
                  </div>
                </article>
              );
            })}
          </div>

          {errorMessage && (
            <div role="alert" className="mt-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
              {errorMessage}
            </div>
          )}

          <button
            type="button"
            className="button-secondary mt-4 min-h-10 w-full justify-center"
            disabled={isRefreshing || busy !== null}
            onClick={() =>
              void runAction("location", async () => {
                setIsRefreshing(true);
                const nextStatus = await DeviceSetup.checkPermissionStatus();
                setStatus(nextStatus);
              })
            }
          >
            <RefreshCw size={15} /> Já ativei, verificar novamente
          </button>

          <p className="mt-4 text-center text-xs text-muted-foreground">
            Você precisa concluir a configuração para abrir a área de entregas.
          </p>
        </section>
      </section>
    </main>
  );
}
