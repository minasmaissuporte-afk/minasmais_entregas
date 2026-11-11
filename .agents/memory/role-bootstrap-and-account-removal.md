---
name: Bootstrap e papéis de acesso
description: Preservação de papéis atribuídos e limites seguros ao excluir contas.
---

## Regra

Os e-mails de administrador inicial servem para estabelecer o primeiro administrador quando ainda não existe nenhum. Depois disso, o papel salvo no sistema é a fonte de verdade e não deve ser sobrescrito em cada login. A exclusão de uma conta revoga primeiro o acesso, pode remover o login no Supabase Auth, preserva o histórico de entregas e bloqueia a própria conta, o último administrador e motoboys com trabalho ativo.

**Why:** uma promoção automática a administrador em cada leitura do perfil fazia a função de motoboy voltar para administrador após recarregar. O usuário confirmou que excluir cadastro também deve excluir o login, mas manter as entregas anteriores.

**How to apply:** trate o bootstrap apenas como recuperação/inicialização sem administrador; mantenha atribuições posteriores persistentes e confirme permissões e histórico antes de alterar o fluxo de exclusão.
