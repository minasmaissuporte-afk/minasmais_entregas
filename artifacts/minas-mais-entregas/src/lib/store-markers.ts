import type { MapMarker } from "@/components/live-map";

/** Filial com entrega em andamento ou esperando motoboy: vermelha. Sem entrega: cinza. */
export const STORE_ACTIVE_COLOR = "#d8112b";
export const STORE_IDLE_COLOR = "#8a929c";

/** Status em que a entrega "acende" a filial no mapa. */
export const STORE_ACTIVE_STATUSES = ["OFFERED", "AWAITING_COURIER", "ACCEPTED", "TO_STORE", "AT_STORE", "IN_TRANSIT"];

function shortName(name: string) {
  return name.length > 18 ? `${name.slice(0, 17).trimEnd()}…` : name;
}

/**
 * Marcadores fixos das filiais, com o nome de cada uma (ajuda a identificar quando houver
 * várias). `activeStoreIds`: filiais com entrega em andamento ou na fila.
 */
export function storeMarkers(
  stores: { id: string; name: string; city?: string; address?: string; active?: boolean; latitude?: number | null; longitude?: number | null }[],
  activeStoreIds: Set<string>,
): MapMarker[] {
  return stores
    .filter((store) => store.active !== false && store.latitude != null && store.longitude != null)
    .map((store) => {
      const active = activeStoreIds.has(store.id);
      return {
        id: `store-${store.id}`,
        latitude: store.latitude!,
        longitude: store.longitude!,
        title: `Filial ${store.name}`,
        detail: active ? "Com entrega em andamento" : "Sem entrega no momento",
        kind: "store" as const,
        label: shortName(store.name),
        color: active ? STORE_ACTIVE_COLOR : STORE_IDLE_COLOR,
        textColor: "#ffffff",
        zIndex: active ? 4 : 1,
        // Filial sem entrega aparece, mas não afasta o mapa para caber todas.
        fit: active,
      };
    });
}
