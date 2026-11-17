import { useEffect, useState } from "react";
import { ActiveCouriers, useOperationsData } from "./overview";

/* Página do item "Motoboys" do menu. */

function useNow() {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") setNow(Date.now());
    }, 1000);
    return () => window.clearInterval(timer);
  }, []);
  return now;
}

function PageTitle({ crumb, title, subtitle }: { crumb: string; title: string; subtitle: string }) {
  return (
    <div className="mb-6">
      <p className="text-[10px] font-medium tracking-[0.7px] text-[var(--adm-muted)]">{crumb}</p>
      <h1 className="mt-3 text-[24px] font-semibold leading-tight tracking-[-0.01em] text-[var(--adm-ink)] sm:text-[28px]">{title}</h1>
      <p className="mt-2 text-[13px] text-[var(--adm-muted)]">{subtitle}</p>
    </div>
  );
}

export function CouriersPage() {
  const data = useOperationsData();
  const now = useNow();
  return (
    <div className="max-w-[720px]">
      <PageTitle crumb="OPERAÇÃO / MOTOBOYS" title="Motoboys" subtitle="Quem está em rota, disponível ou sem sinal agora." />
      <ActiveCouriers
        couriers={data.couriers.data ?? []}
        deliveries={data.deliveries.data ?? []}
        now={now}
        isLoading={data.couriers.isLoading}
        isError={data.couriers.isError && !data.couriers.data}
        onRetry={() => void data.couriers.refetch()}
        full
      />
    </div>
  );
}
