import {
  index,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { deliveriesTable } from "./deliveries";
import { appUsersTable } from "./deliveries";

export const pushSubscriptionsTable = pgTable(
  "push_subscriptions",
  {
    id: text("id").primaryKey(),
    courierId: text("courier_id"),
    userId: text("user_id").references(() => appUsersTable.id, {
      onDelete: "cascade",
    }),
    endpoint: text("endpoint").notNull(),
    p256dh: text("p256dh").notNull(),
    auth: text("auth").notNull(),
    vapidKeyId: text("vapid_key_id"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("push_subscriptions_endpoint_idx").on(table.endpoint),
    index("push_subscriptions_courier_idx").on(table.courierId),
    index("push_subscriptions_user_idx").on(table.userId),
  ],
);

export const deliveryEvidenceUploadsTable = pgTable(
  "delivery_evidence_uploads",
  {
    objectPath: text("object_path").primaryKey(),
    deliveryId: text("delivery_id")
      .notNull()
      .references(() => deliveriesTable.id, { onDelete: "cascade" }),
    courierId: text("courier_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("delivery_evidence_uploads_delivery_idx").on(table.deliveryId),
  ],
);
