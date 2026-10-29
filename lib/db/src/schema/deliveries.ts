import {
  boolean,
  index,
  integer,
  pgTable,
  real,
  text,
  timestamp,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const storesTable = pgTable("stores", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  code: text("code").notNull().unique(),
  city: text("city").notNull(),
  address: text("address").notNull(),
  active: boolean("active").notNull().default(true),
});

export const couriersTable = pgTable(
  "couriers",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    initials: text("initials").notNull(),
    status: text("status").notNull().default("AVAILABLE"),
    currentDeliveryCode: text("current_delivery_code"),
    lastLocationAt: timestamp("last_location_at", { withTimezone: true }),
  },
  (table) => [index("couriers_status_idx").on(table.status)],
);

export const appUsersTable = pgTable(
  "app_users",
  {
    id: text("id").primaryKey(),
    clerkUserId: text("clerk_user_id").unique(),
    email: text("email").notNull().unique(),
    name: text("name").notNull(),
    role: text("role").notNull().default("PENDING"),
    storeId: text("store_id").references(() => storesTable.id),
    courierId: text("courier_id").references(() => couriersTable.id),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("app_users_role_idx").on(table.role),
    index("app_users_store_idx").on(table.storeId),
    index("app_users_courier_idx").on(table.courierId),
  ],
);

export const deliveriesTable = pgTable(
  "deliveries",
  {
    id: text("id").primaryKey(),
    code: text("code").notNull().unique(),
    customerName: text("customer_name").notNull(),
    customerPhone: text("customer_phone"),
    destination: text("destination").notNull(),
    orderNumber: text("order_number").notNull(),
    notes: text("notes"),
    storeId: text("store_id")
      .notNull()
      .references(() => storesTable.id),
    courierId: text("courier_id").references(() => couriersTable.id),
    status: text("status").notNull().default("REQUESTED"),
    priority: text("priority").notNull().default("normal"),
    deliveryAmountCents: integer("delivery_amount_cents")
      .notNull()
      .default(0),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    lastLocationAt: timestamp("last_location_at", { withTimezone: true }),
    estimatedMinutes: integer("estimated_minutes"),
    distanceKm: real("distance_km"),
  },
  (table) => [
    index("deliveries_status_idx").on(table.status),
    index("deliveries_store_idx").on(table.storeId),
    index("deliveries_created_idx").on(table.createdAt),
  ],
);

export const deliveryEventsTable = pgTable(
  "delivery_events",
  {
    id: text("id").primaryKey(),
    deliveryId: text("delivery_id")
      .notNull()
      .references(() => deliveriesTable.id, { onDelete: "cascade" }),
    label: text("label").notNull(),
    kind: text("kind").notNull(),
    actor: text("actor"),
    timestamp: timestamp("timestamp", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [index("delivery_events_delivery_idx").on(table.deliveryId)],
);

export const insertDeliverySchema = createInsertSchema(deliveriesTable).omit({
  createdAt: true,
  updatedAt: true,
});
export type InsertDelivery = z.infer<typeof insertDeliverySchema>;
export type DeliveryRecord = typeof deliveriesTable.$inferSelect;
