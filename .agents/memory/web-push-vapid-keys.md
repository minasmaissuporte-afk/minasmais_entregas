---
name: Formato das chaves VAPID
description: Formatos de entrada e proteção das chaves VAPID usadas pelo push do PWA.
---

Ao configurar Web Push, extraia separadamente os valores Base64/Base64URL, mesmo se vierem com rótulos `Public Key:` e `Private Key:` ou aspas. Converta Base64 comum para Base64URL; valide a pública com 65 bytes e primeiro byte `0x04`, a privada com 32 bytes e confirme que formam o mesmo par P-256. Nunca registre nem mostre os valores recebidos.

**Why:** o usuário pode copiar a saída completa da geração do par VAPID; erros de formato ou pares incompatíveis impedem a ativação e podem deixar inscrições antigas inválidas. O usuário confirmou que a ativação e o push funcionaram após essa configuração.

**How to apply:** valide e normalize no servidor e exponha apenas a chave pública limpa por API; o cliente decodifica com `urlBase64ToUint8Array` antes de assinar e substitui inscrições criadas com outra chave.
