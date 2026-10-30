---
name: Requisitos do acesso PWA do motoboy
description: Requisitos do PWA do entregador, login e cálculo de valores a receber.
---

## Regra

O motoboy deve acessar o sistema por um PWA instalável em iOS e Android, sem depender das lojas de aplicativos. A área deve mostrar a quantidade de entregas e o valor a receber, calculado a partir do valor cadastrado em cada entrega.

**Why:** o usuário definiu o PWA como caminho de acesso para evitar publicação na App Store e Google Play, mantendo o uso em iOS e Android e a visualização dos repasses.

**How to apply:** o login do PWA deve usar as mesmas contas e dados autenticados do webapp. O cálculo atual considera entregas concluídas; confirme com o usuário antes de mudar a regra de repasse.

## Tarifa por filial

A tarifa configurada por filial define o valor de novas entregas. Alterar a tarifa da filial não deve recalcular entregas já registradas.

**Why:** cada registro precisa preservar o valor que foi acordado quando a entrega foi criada, para manter o histórico e os repasses consistentes.

**How to apply:** ao criar uma entrega, copie a tarifa vigente da filial para o registro; mantenha valores históricos inalterados.

## Verificação de login

O usuário confirmou em 30 de outubro de 2026 que o teste de login funcionou corretamente.

**Why:** o fluxo de acesso já foi testado pelo usuário no ambiente disponível.

**How to apply:** considere esse ambiente verificado; valide novamente após republicar, pois as contas do Clerk de desenvolvimento e produção são separadas.

## Localização e mapas

Não inventar coordenadas: o mapa deve exibir somente posições GPS realmente recebidas durante um atendimento ativo, com horário da última atualização. O PWA precisa permanecer aberto para continuar enviando a posição; o rastreamento em segundo plano não é garantido em iOS/Android.

**Why:** o usuário solicitou rastreamento real no painel e rota visível no PWA, sem dados fictícios.

**How to apply:** mantenha posições atuais protegidas por perfil e vinculadas ao atendimento; informe quando o GPS estiver ausente ou desatualizado, sem apresentar pontos estimados como atuais.
