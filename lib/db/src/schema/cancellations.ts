import {
  boolean,
  index,
  integer,
  pgTable,
  text,
  timestamp,
} from "drizzle-orm/pg-core";
import {
  couriersTable,
  deliveriesTable,
  deliveryRoutesTable,
} from "./deliveries";

export const deliveryCancellationReasonsTable = pgTable(
  "delivery_cancellation_reasons",
  {
    id: text("id").primaryKey(),
    label: text("label").notNull(),
    active: boolean("active").notNull().default(true),
    position: integer("position").notNull().default(0),
  },
  (table) => [index("delivery_cancellation_reasons_active_idx").on(table.active)],
);

export const deliveryCancellationsTable = pgTable(
  "delivery_cancellations",
  {
    id: text("id").primaryKey(),
    deliveryId: text("delivery_id")
      .notNull()
      .references(() => deliveriesTable.id, { onDelete: "cascade" }),
    courierId: text("courier_id").references(() => couriersTable.id, {
      onDelete: "set null",
    }),
    routeId: text("route_id").references(() => deliveryRoutesTable.id, {
      onDelete: "set null",
    }),
    reason: text("reason").notNull(),
    observation: text("observation"),
    status: text("status").notNull(),
    priority: boolean("priority").notNull().default(false),
    routeContinues: boolean("route_continues").notNull().default(false),
    requestedAt: timestamp("requested_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
  },
  (table) => [
    index("delivery_cancellations_delivery_idx").on(table.deliveryId),
    index("delivery_cancellations_courier_idx").on(table.courierId),
    index("delivery_cancellations_status_idx").on(table.status),
    index("delivery_cancellations_requested_idx").on(table.requestedAt),
  ],
);
