---
name: Nome do motoboy
description: Regra de prioridade para o nome de exibição dos motoboys e sincronização da conta.
---

O nome do motoboy definido pelo administrador no cadastro local é a fonte de verdade e não deve ser sobrescrito por dados do Clerk. Se não houver nome local válido, use a parte do e-mail anterior ao `@`, com a primeira letra maiúscula; não use o e-mail completo nem um rótulo genérico na saudação.

**Why:** o cadastro de login pode conter apenas e-mail, enquanto a Central e o motoboy precisam exibir um nome administrável e consistente.

**How to apply:** mantenha o nome sincronizado entre a conta local e o cadastro de motoboy; ao adicionar fluxos de sincronização, preserve o valor definido pelo administrador.
