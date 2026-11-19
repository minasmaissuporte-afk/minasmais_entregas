import { index, pgTable, primaryKey, text, timestamp } from "drizzle-orm/pg-core";
import { appUsersTable, storesTable } from "./deliveries";

/**
 * Filiais sob a supervisão de cada Supervisor regional. O supervisor vê e opera só
 * as entregas, os relatórios e os motoboys (das cidades) dessas filiais.
 */
export const supervisorStoresTable = pgTable(
  "supervisor_stores",
  {
    appUserId: text("app_user_id")
      .notNull()
      .references(() => appUsersTable.id, { onDelete: "cascade" }),
    storeId: text("store_id")
      .notNull()
      .references(() => storesTable.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.appUserId, table.storeId] }),
    index("supervisor_stores_store_idx").on(table.storeId),
  ],
);
