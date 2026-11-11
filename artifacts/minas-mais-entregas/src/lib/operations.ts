import type { Courier, Delivery } from "@workspace/api-client-react";

/*
 * Pure calculations for the administrative overview. Everything is derived from
 * the real `/deliveries` and `/couriers` responses (no sample data), so the
 * filters on the overview apply to every block consistently.
 */

export const ACTIVE_STATUSES = new Set([
  "REQUESTED",
  "AWAITING_COURIER",
  "OFFERED",
  "ACCEPTED",
  "TO_STORE",
  "AT_STORE",
  "IN_TRANSIT",
]);
/** Waiting to be picked up at the store (design: "Aguardando coleta"). */
export const PENDING_STATUSES = new Set(["REQUESTED", "AWAITING_COURIER", "OFFERED", "ACCEPTED", "TO_STORE", "AT_STORE"]);

/** Same rule as the API (`/dashboard/summary`): a GPS fix in the last 2 minutes means online. */
export const COURIER_ONLINE_MS = 120_000;
/** Design rule: GPS missing for 5 minutes during a delivery becomes an alert. */
export const COURIER_SIGNAL_LOST_MS = 5 * 60_000;

export type PeriodKey = "today" | "yesterday" | "7d";

export type OverviewFilters = {
  storeId: string;
  status: string;
  courierId: string;
  priority: string;
};

export const emptyFilters: OverviewFilters = { storeId: "", status: "", courierId: "", priority: "" };

export function periodRange(period: PeriodKey, now = new Date()) {
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const day = 24 * 60 * 60_000;
  if (period === "yesterday") {
    const start = new Date(startOfToday.getTime() - day);
    return { start, end: startOfToday, previousStart: new Date(start.getTime() - day) };
  }
  if (period === "7d") {
    const start = new Date(startOfToday.getTime() - 6 * day);
    return { start, end: new Date(now.getTime() + 1), previousStart: new Date(start.getTime() - 7 * day) };
  }
  return { start: startOfToday, end: new Date(now.getTime() + 1), previousStart: new Date(startOfToday.getTime() - day) };
}

export function completedAt(delivery: Delivery) {
  const event = delivery.events.find((item) => item.kind === "completed");
  const value = event?.timestamp ?? (delivery.status === "COMPLETED" ? delivery.updatedAt : null);
  const time = value ? Date.parse(value) : NaN;
  return Number.isFinite(time) ? time : null;
}

/** Expected arrival, from the estimate the API stores when the delivery is created or routed. */
export function expectedAt(delivery: Delivery) {
  if (delivery.estimatedMinutes == null) return null;
  const created = Date.parse(delivery.createdAt);
  return Number.isFinite(created) ? created + delivery.estimatedMinutes * 60_000 : null;
}

/** Active and past its expected arrival (same rule as the API's "delayed"). */
export function isDelayed(delivery: Delivery, now: number) {
  const expected = expectedAt(delivery);
  return ACTIVE_STATUSES.has(delivery.status) && expected != null && now > expected;
}

export function applyFilters(deliveries: Delivery[], filters: OverviewFilters, now: number) {
  return deliveries.filter((delivery) => {
    if (filters.storeId && delivery.storeId !== filters.storeId) return false;
    if (filters.courierId && delivery.courierId !== filters.courierId) return false;
    if (filters.priority && delivery.priority !== filters.priority) return false;
    if (filters.status === "DELAYED") return isDelayed(delivery, now);
    if (filters.status && delivery.status !== filters.status) return false;
    return true;
  });
}

function percentChange(current: number, previous: number) {
  if (previous === 0) return current === 0 ? 0 : null;
  return ((current - previous) / previous) * 100;
}

export function deliveryMetrics(deliveries: Delivery[], period: PeriodKey, now: number) {
  const { start, end, previousStart } = periodRange(period, new Date(now));
  const active = deliveries.filter((item) => ACTIVE_STATUSES.has(item.status));
  const pending = active.filter((item) => PENDING_STATUSES.has(item.status));
  const inTransit = active.filter((item) => item.status === "IN_TRANSIT");
  const urgent = active.filter((item) => item.priority === "urgent");
  const delayed = active.filter((item) => isDelayed(item, now));
  const urgentAtRisk = urgent.filter((item) => isDelayed(item, now));

  const completedIn = (from: number, to: number) =>
    deliveries.filter((item) => {
      if (item.status !== "COMPLETED") return false;
      const done = completedAt(item);
      return done != null && done >= from && done < to;
    });
  const completed = completedIn(start.getTime(), end.getTime());
  const previousCompleted = completedIn(previousStart.getTime(), start.getTime());

  const minutes = completed
    .map((item) => {
      const done = completedAt(item);
      const created = Date.parse(item.createdAt);
      return done != null && Number.isFinite(created) ? (done - created) / 60_000 : null;
    })
    .filter((value): value is number => value != null && value >= 0);
  const averageMinutes = minutes.length ? minutes.reduce((sum, value) => sum + value, 0) / minutes.length : null;

  const onTimeShare = (items: Delivery[]) => {
    const withEstimate = items.filter((item) => expectedAt(item) != null);
    if (!withEstimate.length) return null;
    const onTime = withEstimate.filter((item) => (completedAt(item) ?? Infinity) <= (expectedAt(item) ?? -Infinity));
    return { share: (onTime.length / withEstimate.length) * 100, measured: withEstimate.length };
  };

  return {
    pending: pending.length,
    inTransit: inTransit.length,
    urgent: urgent.length,
    urgentAtRisk: urgentAtRisk.length,
    delayed,
    completed: completed.length,
    completedChange: percentChange(completed.length, previousCompleted.length),
    averageMinutes,
    onTime: onTimeShare(completed),
    previousOnTime: onTimeShare(previousCompleted),
  };
}

export type CourierState = "busy" | "available" | "offline";

export function courierAgeMs(courier: Courier, now: number) {
  const time = courier.lastLocationAt ? Date.parse(courier.lastLocationAt) : NaN;
  return Number.isFinite(time) ? Math.max(0, now - time) : null;
}

export function courierState(courier: Courier, now: number): CourierState {
  const age = courierAgeMs(courier, now);
  const online = age != null && age <= COURIER_ONLINE_MS;
  if (!online) return "offline";
  return courier.status === "BUSY" ? "busy" : "available";
}

export function courierMetrics(couriers: Courier[], now: number) {
  const states = couriers.map((courier) => ({ courier, state: courierState(courier, now) }));
  const busy = states.filter((item) => item.state === "busy").map((item) => item.courier);
  const available = states.filter((item) => item.state === "available").map((item) => item.courier);
  const offline = states.filter((item) => item.state === "offline").map((item) => item.courier);
  // On a delivery (BUSY) but without GPS for 5+ minutes.
  const signalLost = couriers.filter((courier) => {
    if (courier.status !== "BUSY") return false;
    const age = courierAgeMs(courier, now);
    return age == null || age > COURIER_SIGNAL_LOST_MS;
  });
  return { busy, available, offline, signalLost, connected: busy.length + available.length };
}

export function formatAge(ms: number | null) {
  if (ms == null) return "sem registro";
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds} s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} h`;
  return `${Math.floor(hours / 24)} d`;
}

export function formatClock(time: number) {
  return new Date(time).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
}

export function periodLabel(period: PeriodKey, now = new Date()) {
  const date = (value: Date) =>
    value.toLocaleDateString("pt-BR", { day: "2-digit", month: "short", year: "numeric" }).replace(/\./g, "").replace(/ de /g, " ");
  if (period === "yesterday") return `Ontem, ${date(new Date(now.getTime() - 24 * 60 * 60_000))}`;
  if (period === "7d") return "Últimos 7 dias";
  return `Hoje, ${date(now)}`;
}
