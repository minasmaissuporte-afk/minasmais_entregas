---
name: Senha da conta
description: Requisito para criar ou trocar senha em contas autenticadas pelo webapp/PWA.
---

Usuários autenticados devem conseguir criar ou trocar a senha dentro do webapp. Para contas que entram apenas com código de e-mail, permita criar a primeira senha sem exigir uma senha atual; para contas com senha, valide a senha atual. A senha deve permanecer sob gestão do Clerk, sem ser armazenada pelo aplicativo.

**Why:** o usuário pediu uma opção interna para troca de senha e recuperação de acesso, inclusive para pessoas que usam o PWA.

**How to apply:** mantenha a ação de segurança acessível nos portais de administração, filial e motoboy; teste separadamente contas passwordless e contas que já têm senha.
