import { useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import {
  getListCouriersQueryKey,
  getListDeliveriesQueryKey,
  useListCouriers,
  useListDeliveries,
  useUpdateDeliveryStatus,
  type AppUser,
} from "@workspace/api-client-react";
import { Check, KeyRound, LogOut, PackageCheck } from "lucide-react";
import { useClerk } from "@clerk/react";
import LiveMap, { type MapMarker } from "@/components/live-map";
import { Link } from "wouter";

export default function StorePortal({ profile }: { profile: AppUser }) {
  const { signOut } = useClerk();
  const queryClient = useQueryClient();
  const [selectedCourierId, setSelectedCourierId] = useState("");
  const deliveries = useListDeliveries(
    {},
    { query: { queryKey: getListDeliveriesQueryKey(), refetchInterval: 15000 } },
  );
  const couriers = useListCouriers(undefined, {
    query: { queryKey: getListCouriersQueryKey(), refetchInterval: 15000 },
  });
  const activeCouriers = useMemo(
    () => (couriers.data ?? []).filter((courier) => courier.status === "BUSY"),
    [couriers.data],
  );
  const effectiveSelectedCourierId = activeCouriers.some(
    (courier) => courier.id === selectedCourierId,
  ) ? selectedCourierId : "";
  const trackingMarkers: MapMarker[] = activeCouriers
    .filter(
      (courier) =>
        (!effectiveSelectedCourierId || courier.id === effectiveSelectedCourierId) &&
        courier.currentLatitude != null &&
        courier.currentLongitude != null,
    )
    .map((courier) => ({
      id: courier.id,
      latitude: courier.currentLatitude!,
      longitude: courier.currentLongitude!,
      title: courier.name,
      detail: `Entrega ${courier.currentDeliveryCode ?? ""} · posição recebida ${
        courier.lastLocationAt
          ? new Date(courier.lastLocationAt).toLocaleTimeString("pt-BR", {
              hour: "2-digit",
              minute: "2-digit",
            })
          : "sem horário"
      }`,
      kind: "courier",
    }));
  const updateStatus = useUpdateDeliveryStatus();
  const confirmPickup = (deliveryId: string) => {
    updateStatus.mutate(
      { deliveryId, data: { status: "IN_TRANSIT" } },
      {
        onSuccess: () => void queryClient.invalidateQueries({ queryKey: getListDeliveriesQueryKey() }),
      },
    );
  };

  return (
    <main className="min-h-[100dvh] bg-[#f4f3f1] px-4 pb-10 pt-4 text-[#24272d] sm:px-6">
      <div className="mx-auto max-w-3xl">
        <header className="flex items-center justify-between rounded-xl border border-[#e7e6e3] bg-white px-4 py-3">
          <div className="flex items-center gap-3">
            <span className="brand-mark">MM</span>
            <div>
              <div className="text-sm font-bold">Minas Mais</div>
              <div className="text-[11px] text-muted-foreground">Área da unidade</div>
            </div>
          </div>
          <div className="flex items-center gap-1 sm:gap-2">
            <Link href="/account" className="button-secondary min-h-9 px-2 text-xs sm:px-3" aria-label="Alterar senha">
              <KeyRound size={14} /> <span className="hidden sm:inline">Senha</span>
            </Link>
            <button
              className="button-quiet min-h-9 px-2 text-xs sm:px-3"
              onClick={() => void signOut({ redirectUrl: import.meta.env.BASE_URL })}
            >
              <LogOut size={15} /> Sair
            </button>
          </div>
        </header>

        <div className="mb-5 mt-6">
          <div className="eyebrow">OPERAÇÃO DA UNIDADE</div>
          <h1 className="mt-2 text-[28px] font-bold tracking-[-.045em]">Entregas da loja</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Olá, {profile.name}. Aqui aparecem somente as entregas da sua unidade.
          </p>
        </div>
        <section className="panel mb-5 overflow-hidden" aria-label="Rastreamento dos motoboys da unidade">
          <div className="flex flex-col gap-3 border-b border-border px-4 py-4 sm:flex-row sm:items-end sm:justify-between sm:px-5">
            <div>
              <div className="eyebrow">ACOMPANHAMENTO</div>
              <h2 className="mt-1 text-sm font-bold">Motoboys com entregas da unidade</h2>
              <p className="mt-1 text-xs text-muted-foreground">Acompanhe todos ou selecione um motoboy.</p>
            </div>
            <label className="sr-only" htmlFor="store-track-courier">Selecionar motoboy para acompanhar</label>
            <select
              id="store-track-courier"
              className="filter-select w-full sm:w-auto"
              value={effectiveSelectedCourierId}
              onChange={(event) => setSelectedCourierId(event.target.value)}
              aria-label="Selecionar motoboy para acompanhar"
            >
              <option value="">Todos os motoboys em atendimento</option>
              {activeCouriers.map((courier) => (
                <option key={courier.id} value={courier.id}>{courier.name}</option>
              ))}
            </select>
          </div>
          {couriers.isLoading ? (
            <div className="skeleton m-4 h-[280px]" />
          ) : trackingMarkers.length ? (
            <LiveMap
              markers={trackingMarkers}
              ariaLabel="Localização atual dos motoboys atendendo esta unidade"
            />
          ) : (
            <div className="p-5 text-sm text-muted-foreground">
              {effectiveSelectedCourierId
                ? `Aguardando uma posição GPS real de ${activeCouriers.find((courier) => courier.id === effectiveSelectedCourierId)?.name ?? "motoboy selecionado"}. O PWA precisa estar aberto com a localização permitida.`
                : "Nenhuma posição GPS recebida para entregas ativas desta unidade. O mapa será atualizado quando o motoboy permitir a localização no PWA."}
            </div>
          )}
        </section>
        {deliveries.isLoading ? (
          <div className="panel p-5 text-sm text-muted-foreground">Carregando entregas…</div>
        ) : deliveries.isError ? (
          <div className="panel p-5 text-sm text-red-700">Não foi possível carregar as entregas.</div>
        ) : deliveries.data?.length ? (
          <div className="space-y-3">
            {deliveries.data.map((delivery) => (
              <article key={delivery.id} className="panel p-4 sm:p-5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="font-mono text-xs font-semibold text-[#a91d2a]">{delivery.code}</div>
                    <h2 className="mt-1 text-sm font-bold">{delivery.customerName}</h2>
                    <p className="mt-1 text-xs text-muted-foreground">{delivery.destination}</p>
                    <p className="mt-1 text-[11px] text-muted-foreground">Pedido {delivery.orderNumber}</p>
                  </div>
                  <span className="rounded-full bg-[#f6f4f1] px-2.5 py-1 text-[10px] font-semibold">
                    {delivery.status.replaceAll("_", " ")}
                  </span>
                </div>
                {delivery.status === "AT_STORE" ? (
                  <button
                    className="button-primary mt-4 w-full sm:w-auto"
                    disabled={updateStatus.isPending}
                    onClick={() => confirmPickup(delivery.id)}
                  >
                    <Check size={15} /> Confirmar saída para entrega
                  </button>
                ) : null}
              </article>
            ))}
          </div>
        ) : (
          <div className="panel p-8 text-center">
            <PackageCheck className="mx-auto text-muted-foreground" size={23} />
            <h2 className="mt-3 text-sm font-bold">Nenhuma entrega para mostrar</h2>
            <p className="mt-1 text-xs text-muted-foreground">
              As entregas vinculadas à sua unidade aparecerão aqui.
            </p>
          </div>
        )}
      </div>
    </main>
  );
}
