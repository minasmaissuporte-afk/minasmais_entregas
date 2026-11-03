---
name: Exclusão definitiva de entregas
description: Regras de autorização e limpeza das dependências de uma entrega apagada permanentemente.
---

## Regra

A exclusão permanente de uma entrega deve ser exclusiva de ADMIN e remover registros de eventos, comprovantes e paradas/rotas vinculadas, além dos arquivos de evidência no App Storage. Push subscriptions e GPS atual do motoboy são dados compartilhados, não pertencem exclusivamente a uma entrega, então não devem ser removidos.

Uma oferta agrupada ainda não aceita pode continuar com os outros pedidos se restarem ao menos dois. Se restar só um pedido, desfaça a oferta, devolva esse pedido para `REQUESTED` e registre o motivo no histórico. Não exclua uma rota aceita enquanto ela contiver outros pedidos ativos; responda conflito para evitar deixar entregas em andamento sem rota.

**Why:** apagar um trajeto aceito pode interromper os outros pedidos da rota, enquanto apagar a posição GPS atual ou a inscrição push do motoboy afetaria atividades sem relação com o pedido excluído. As notificações push não são persistidas por entrega neste projeto.

**How to apply:** ao implementar exclusão de entrega, verificar todas as referências relacionais e arquivos privados, preservar dados compartilhados do motoboy e bloquear a operação quando outra entrega ativa depende da mesma rota.
