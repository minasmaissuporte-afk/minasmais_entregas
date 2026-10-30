---
name: Escolha do estilo dos mapas Mapbox
description: Estilo e idioma que devem ser preservados nos mapas da Central e do PWA.
---

Todos os mapas deste app devem usar `mapbox://styles/mapbox/streets-v12`; não restaurar o estilo personalizado nem adicionar fallback. Definir português com a opção nativa `language: "pt"` do Mapbox GL JS, sem `@mapbox/mapbox-gl-language`.

**Why:** o usuário solicitou o estilo padrão em todas as telas; o plugin de idioma lançou exceções com o estilo customizado e com o fallback, deixando o mapa em branco.

**How to apply:** mantenha um único estilo compartilhado para Central, PWA, cadastro de filial e modal de entrega; use o token `VITE_MAPBOX_PUBLIC_TOKEN` via Secrets.
