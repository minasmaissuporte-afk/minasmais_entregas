---
name: Requisitos do acesso PWA do motoboy
description: Requisitos do PWA do entregador, login e cálculo de valores a receber.
---

## Regra

O motoboy deve acessar o sistema por um PWA instalável em iOS e Android, sem depender das lojas de aplicativos. A área deve mostrar a quantidade de entregas e o valor a receber, calculado a partir do valor cadastrado em cada entrega.

**Why:** o usuário definiu o PWA como caminho de acesso para evitar publicação na App Store e Google Play, mantendo o uso em iOS e Android e a visualização dos repasses.

**How to apply:** o login do PWA deve usar as mesmas contas e dados autenticados do webapp. O cálculo atual considera entregas concluídas; confirme com o usuário antes de mudar a regra de repasse.

## Verificação de login

O usuário confirmou em 30 de outubro de 2026 que o teste de login funcionou corretamente.

**Why:** o fluxo de acesso já foi testado pelo usuário no ambiente disponível.

**How to apply:** considere esse ambiente verificado; valide novamente após republicar, pois as contas do Clerk de desenvolvimento e produção são separadas.
