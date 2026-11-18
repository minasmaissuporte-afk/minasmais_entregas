-- Fim da etapa "levar o produto de volta à filial" no app do motoboy.
-- Entregas presas em RETURNING_TO_STORE passam a "Devolvida pelo motoboy" (AWAITING_COURIER),
-- ficam com a loja (reenviar ou cancelar) e o motoboy é liberado.
WITH presas AS (
  SELECT id, courier_id FROM deliveries WHERE status = 'RETURNING_TO_STORE'
), liberar AS (
  UPDATE couriers c SET status = 'AVAILABLE', current_delivery_code = NULL
  FROM presas p
  WHERE c.id = p.courier_id
    AND c.status = 'BUSY'
    AND NOT EXISTS (
      SELECT 1 FROM deliveries d
      WHERE d.courier_id = c.id AND d.status IN ('ACCEPTED','TO_STORE','AT_STORE','IN_TRANSIT')
    )
  RETURNING c.id
), ocorrencias AS (
  UPDATE delivery_cancellations SET status = 'AWAITING_CENTRAL'
  WHERE status = 'RETURNING_TO_STORE' AND delivery_id IN (SELECT id FROM presas)
  RETURNING id
)
UPDATE deliveries SET status = 'AWAITING_COURIER', courier_id = NULL, updated_at = now()
WHERE id IN (SELECT id FROM presas);

-- Motoboy marcado como ocupado sem nenhuma entrega ou rota ativa (ex.: entrega excluída
-- enquanto ele "devolvia à filial") volta a ficar disponível.
UPDATE couriers c SET status = 'AVAILABLE', current_delivery_code = NULL
WHERE c.status = 'BUSY'
  AND NOT EXISTS (
    SELECT 1 FROM deliveries d
    WHERE d.courier_id = c.id AND d.status IN ('ACCEPTED','TO_STORE','AT_STORE','IN_TRANSIT','RETURNING_TO_STORE')
  )
  AND NOT EXISTS (
    SELECT 1 FROM delivery_routes r WHERE r.courier_id = c.id AND r.status = 'ACCEPTED'
  );
