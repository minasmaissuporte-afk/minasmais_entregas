-- Valor total dos produtos e "já está pago" na entrega.
ALTER TABLE deliveries
  ADD COLUMN IF NOT EXISTS products_amount_cents integer,
  ADD COLUMN IF NOT EXISTS prepaid boolean NOT NULL DEFAULT false;
