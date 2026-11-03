---
name: Formato das chaves VAPID
description: Formatos de entrada e proteção das chaves VAPID usadas pelo push do PWA.
---

Ao configurar Web Push, normalize a chave pública e a privada separadamente. Além dos valores Base64URL, a entrada pode conter rótulos `Public Key:` e `Private Key:` juntos, PEM público P-256 ou ponto público hexadecimal. Nunca registre nem mostre os valores recebidos.

**Why:** o usuário pode copiar a saída completa da geração do par VAPID, e rejeitar o texto rotulado impede a ativação do PWA antes mesmo de solicitar permissão.

**How to apply:** mantenha a mesma normalização no cliente e na API; valide a chave pública como ponto P-256 não comprimido de 65 bytes e converta-a para Base64URL antes da assinatura Web Push.
