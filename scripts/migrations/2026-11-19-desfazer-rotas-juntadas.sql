-- Entregas aceitas "em cima" de outra voltam a ser separadas (cada uma com seus botões);
-- o app passa a só sugerir a ordem. Desfaz as rotas criadas pelo aceite do motoboy.
UPDATE delivery_route_stops SET status = 'CANCELLED'
WHERE status = 'PENDING'
  AND route_id IN (SELECT id FROM delivery_routes WHERE status = 'ACCEPTED' AND created_by = 'motoboy');
UPDATE delivery_routes SET status = 'CANCELLED'
WHERE status = 'ACCEPTED' AND created_by = 'motoboy';
