-- Fluxo novo (despacho automático por cidade, pagamento, 4 etapas).
-- Rodar DEPOIS do `pnpm db:push` (que cria as colunas e a tabela delivery_offer_declines).
-- Pode rodar mais de uma vez sem efeito colateral.

-- 1) Motoboy passa a ser por cidade: herda a cidade da filial em que estava vinculado.
UPDATE couriers c
SET city = s.city
FROM app_users u
JOIN stores s ON s.id = u.store_id
WHERE u.courier_id = c.id
  AND u.role = 'COURIER'
  AND c.city IS NULL;

-- Motoboy não fica mais preso a uma filial.
UPDATE app_users SET store_id = NULL WHERE role = 'COURIER' AND store_id IS NOT NULL;

-- 2) Só os motivos de cancelamento mais frequentes ficam ativos.
UPDATE delivery_cancellation_reasons SET active = false
WHERE id NOT IN ('CLIENT_ABSENT', 'ADDRESS_NOT_FOUND', 'CUSTOMER_REFUSED', 'OTHER');
UPDATE delivery_cancellation_reasons SET active = true, position = 0, label = 'Cliente ausente / não atende' WHERE id = 'CLIENT_ABSENT';
UPDATE delivery_cancellation_reasons SET active = true, position = 1, label = 'Endereço não encontrado' WHERE id = 'ADDRESS_NOT_FOUND';
UPDATE delivery_cancellation_reasons SET active = true, position = 2, label = 'Cliente desistiu / recusou' WHERE id = 'CUSTOMER_REFUSED';
UPDATE delivery_cancellation_reasons SET active = true, position = 3, label = 'Outro motivo' WHERE id = 'OTHER';

-- 3) Entregas que ficaram "Solicitadas" sem ir para ninguém entram na fila dos motoboys.
UPDATE deliveries d
SET status = 'OFFERED', updated_at = now()
WHERE d.status = 'REQUESTED'
  AND d.courier_id IS NULL
  AND NOT EXISTS (
    SELECT 1 FROM delivery_routes r
    WHERE r.status IN ('OFFERED', 'ACCEPTED') AND d.id = ANY(r.delivery_ids)
  );
