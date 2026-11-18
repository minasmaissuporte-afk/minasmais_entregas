-- Colunas e tabela novas do fluxo de novembro/2026 (equivalente ao `pnpm db:push`).
-- Para bancos acessados pelo pooler (Vercel/Supabase), onde o drizzle-kit não funciona bem.
-- Pode rodar mais de uma vez. Rodar ANTES de 2026-11-18-fluxo-filial.sql.

ALTER TABLE couriers ADD COLUMN IF NOT EXISTS city text;

ALTER TABLE deliveries
  ADD COLUMN IF NOT EXISTS payment_method text,
  ADD COLUMN IF NOT EXISTS change_for_cents integer,
  ADD COLUMN IF NOT EXISTS bring_card_machine boolean,
  ADD COLUMN IF NOT EXISTS courier_paid_at timestamp with time zone,
  ADD COLUMN IF NOT EXISTS courier_paid_by text;

CREATE TABLE IF NOT EXISTS delivery_offer_declines (
  id text PRIMARY KEY,
  delivery_id text NOT NULL,
  courier_id text NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT delivery_offer_declines_delivery_id_deliveries_id_fk
    FOREIGN KEY (delivery_id) REFERENCES deliveries(id) ON DELETE CASCADE,
  CONSTRAINT delivery_offer_declines_courier_id_couriers_id_fk
    FOREIGN KEY (courier_id) REFERENCES couriers(id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS delivery_offer_declines_delivery_courier_idx
  ON delivery_offer_declines (delivery_id, courier_id);
