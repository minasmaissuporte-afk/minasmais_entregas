import type { CourierDeliveryRoute } from "@workspace/api-client-react";

type Stop = CourierDeliveryRoute["stops"][number];

/** Parada como o motoboy vê: retiradas seguidas na mesma loja viram uma só. */
export type DisplayStop = {
  /** Primeira parada do grupo (é ela que a API recebe em "chegar" e "confirmar saída"). */
  stop: Stop;
  stops: Stop[];
  /** Número mostrado ao motoboy (1, 2, 3…), já sem contar retiradas repetidas. */
  number: number;
  codes: string[];
  done: boolean;
};

const samePlace = (a: Stop, b: Stop) =>
  Math.abs(a.latitude - b.latitude) < 0.00002 && Math.abs(a.longitude - b.longitude) < 0.00002;

/** A API confirma juntas as retiradas seguidas no mesmo ponto; a tela mostra do mesmo jeito. */
export function groupRouteStops(stops: Stop[]): DisplayStop[] {
  const groups: DisplayStop[] = [];
  for (const stop of [...stops].sort((a, b) => a.sequence - b.sequence)) {
    const last = groups[groups.length - 1];
    if (
      last &&
      stop.kind === "pickup" &&
      last.stop.kind === "pickup" &&
      samePlace(last.stop, stop) &&
      (stop.status === "DONE") === last.done
    ) {
      last.stops.push(stop);
      last.codes.push(stop.code);
      continue;
    }
    groups.push({ stop, stops: [stop], number: groups.length + 1, codes: [stop.code], done: stop.status === "DONE" });
  }
  return groups;
}
