-- Perfis novos: Supervisor regional (com filiais) e Desenvolvedor.
-- Remove os perfis antigos "Central de entregas" e "Equipe da unidade": quem estiver neles
-- volta para "Aguardando aprovação" (em produção não havia ninguém nesses perfis).
-- Pode rodar mais de uma vez.

CREATE TABLE IF NOT EXISTS supervisor_stores (
  app_user_id text NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  store_id text NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT supervisor_stores_app_user_id_store_id_pk PRIMARY KEY (app_user_id, store_id)
);
CREATE INDEX IF NOT EXISTS supervisor_stores_store_idx ON supervisor_stores (store_id);
ALTER TABLE supervisor_stores ENABLE ROW LEVEL SECURITY;

UPDATE app_users
SET role = 'PENDING', store_id = NULL, updated_at = now()
WHERE role IN ('CENTRAL', 'STORE_STAFF');
