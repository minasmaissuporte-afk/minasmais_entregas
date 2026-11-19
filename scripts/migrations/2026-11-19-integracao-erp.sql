-- Integração ERP: credenciais de API, auditoria dos envios, código da filial no ERP
-- e identificação da venda na entrega (evita duplicidade).
-- Só cria coisas novas; não altera dados existentes. Pode rodar mais de uma vez.

-- 1) Código da filial no ERP.
ALTER TABLE stores ADD COLUMN IF NOT EXISTS erp_code text;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'stores_erp_code_unique') THEN
    ALTER TABLE stores ADD CONSTRAINT stores_erp_code_unique UNIQUE (erp_code);
  END IF;
END $$;

-- 2) Venda do ERP vinculada à entrega. Origem + ID da venda é único (idempotência).
ALTER TABLE deliveries
  ADD COLUMN IF NOT EXISTS erp_source text,
  ADD COLUMN IF NOT EXISTS erp_sale_id text,
  ADD COLUMN IF NOT EXISTS erp_sold_at timestamptz,
  ADD COLUMN IF NOT EXISTS erp_payload jsonb;
CREATE UNIQUE INDEX IF NOT EXISTS deliveries_erp_sale_uidx ON deliveries (erp_source, erp_sale_id);

-- 3) Credenciais da integração (o token nunca é guardado, só o hash SHA-256).
CREATE TABLE IF NOT EXISTS erp_api_credentials (
  id text PRIMARY KEY,
  name text NOT NULL,
  source text NOT NULL DEFAULT 'ERP',
  key_prefix text NOT NULL,
  secret_hash text NOT NULL,
  created_by text,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_used_at timestamptz,
  revoked_at timestamptz,
  revoked_by text,
  CONSTRAINT erp_api_credentials_key_prefix_unique UNIQUE (key_prefix)
);

-- 4) Auditoria de cada envio do ERP.
CREATE TABLE IF NOT EXISTS erp_integration_events (
  id text PRIMARY KEY,
  credential_id text REFERENCES erp_api_credentials(id) ON DELETE SET NULL,
  operation text NOT NULL,
  sale_id text,
  store_code text,
  outcome text NOT NULL,
  http_status integer NOT NULL,
  error_code text,
  error_message text,
  payload jsonb,
  delivery_id text REFERENCES deliveries(id) ON DELETE SET NULL,
  client_ip text,
  request_id text,
  reprocess_of text,
  reprocessed_at timestamptz,
  reprocessed_by text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS erp_events_created_idx ON erp_integration_events (created_at);
CREATE INDEX IF NOT EXISTS erp_events_credential_idx ON erp_integration_events (credential_id, created_at);
CREATE INDEX IF NOT EXISTS erp_events_ip_idx ON erp_integration_events (client_ip, created_at);
CREATE INDEX IF NOT EXISTS erp_events_outcome_idx ON erp_integration_events (outcome);
CREATE INDEX IF NOT EXISTS erp_events_sale_idx ON erp_integration_events (sale_id);

-- Tabelas acessadas só pela API (service role); bloqueia acesso direto pelo Supabase.
ALTER TABLE erp_api_credentials ENABLE ROW LEVEL SECURITY;
ALTER TABLE erp_integration_events ENABLE ROW LEVEL SECURITY;
