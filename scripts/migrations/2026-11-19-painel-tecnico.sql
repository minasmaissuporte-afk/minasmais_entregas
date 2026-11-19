-- Painel técnico: métricas de requisições da API e últimos erros.
-- Só cria tabelas novas. Pode rodar mais de uma vez.

CREATE TABLE IF NOT EXISTS api_request_stats (
  bucket timestamptz NOT NULL,
  method text NOT NULL,
  route text NOT NULL,
  status_class text NOT NULL,
  count integer NOT NULL DEFAULT 0,
  total_ms double precision NOT NULL DEFAULT 0,
  max_ms double precision NOT NULL DEFAULT 0,
  CONSTRAINT api_request_stats_bucket_method_route_status_class_pk PRIMARY KEY (bucket, method, route, status_class)
);

CREATE TABLE IF NOT EXISTS api_error_logs (
  id text PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now(),
  method text NOT NULL,
  route text NOT NULL,
  path text NOT NULL,
  status integer NOT NULL,
  duration_ms double precision NOT NULL,
  message text,
  request_id text,
  role text
);
CREATE INDEX IF NOT EXISTS api_error_logs_created_idx ON api_error_logs (created_at);
CREATE INDEX IF NOT EXISTS api_error_logs_status_idx ON api_error_logs (status);

-- Acesso só pela API (service role).
ALTER TABLE api_request_stats ENABLE ROW LEVEL SECURITY;
ALTER TABLE api_error_logs ENABLE ROW LEVEL SECURITY;
