-- Troca do login: Clerk -> Supabase Auth.
-- Os IDs do Clerk não existem no Supabase; o vínculo é refeito pelo e-mail no
-- primeiro login de cada pessoa (ver resolveAppUser na API). Papéis, filial,
-- motoboy e histórico de entregas são preservados.
BEGIN;
ALTER TABLE app_users RENAME COLUMN clerk_user_id TO auth_user_id;
ALTER TABLE app_users RENAME CONSTRAINT app_users_clerk_user_id_unique TO app_users_auth_user_id_unique;
UPDATE app_users SET auth_user_id = NULL;
COMMIT;
