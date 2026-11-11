import { useEffect, useState } from "react";
import { ActiveCouriers, OperationMap, useOperationsData } from "./overview";

/* Pages behind the sidebar items "Mapa em Tempo Real" and "Motoboys". */

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

export function LiveMapPage() {
  const data = useOperationsData();
  const now = useNow();
  return (
    <div>
      <PageTitle crumb="OPERAÇÃO / MAPA EM TEMPO REAL" title="Mapa em tempo real" subtitle="Posições dos motoboys, filiais e rota ativa. Atualizado a cada 15 segundos." />
      <OperationMap data={data} now={now} tall />
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
