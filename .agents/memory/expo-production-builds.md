---
name: Empacotamento Expo de produção
description: Evite conflitos de porta ao empacotar localmente o app do motoboy para publicação.
---

O empacotador de produção do app Expo espera o Metro na porta 8081. Se outro workflow do Replit já ocupa essa porta, o Expo escolhe outra, mas o script continua consultando 8081 e expira.

**Why:** O workflow do Canvas e a prévia Expo podem disputar a porta 8081 durante a validação local.

**How to apply:** Antes do build local de publicação do app, verifique se 8081 está livre. Pause temporariamente os workflows conflitantes, execute o build e reinicie-os. O build de produção remoto roda em ambiente separado.
