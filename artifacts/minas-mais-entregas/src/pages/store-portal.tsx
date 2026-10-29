import { useQueryClient } from "@tanstack/react-query";
import {
  getListDeliveriesQueryKey,
  useListDeliveries,
  useUpdateDeliveryStatus,
  type AppUser,
} from "@workspace/api-client-react";
import { Check, LogOut, PackageCheck } from "lucide-react";
import { useClerk } from "@clerk/react";

export default function StorePortal({ profile }: { profile: AppUser }) {
  const { signOut } = useClerk();
  const queryClient = useQueryClient();
  const deliveries = useListDeliveries(
    {},
    { query: { queryKey: getListDeliveriesQueryKey(), refetchInterval: 15000 } },
  );
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
          <button
            className="button-quiet"
            onClick={() => void signOut({ redirectUrl: import.meta.env.BASE_URL })}
          >
            <LogOut size={15} /> Sair
          </button>
        </header>

        <div className="mb-5 mt-6">
          <div className="eyebrow">OPERAÇÃO DA UNIDADE</div>
          <h1 className="mt-2 text-[28px] font-bold tracking-[-.045em]">Entregas da loja</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Olá, {profile.name}. Aqui aparecem somente as entregas da sua unidade.
          </p>
        </div>
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
