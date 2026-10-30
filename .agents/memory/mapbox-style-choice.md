---
name: Escolha do estilo dos mapas Mapbox
description: Estilo e idioma que devem ser preservados nos mapas da Central e do PWA.
---

Todos os mapas deste app devem usar `mapbox://styles/mapbox/streets-v12`; não restaurar o estilo personalizado nem adicionar fallback. Definir português com a opção nativa `language: "pt"` do Mapbox GL JS, sem `@mapbox/mapbox-gl-language`.

O elemento passado ao construtor do Mapbox deve receber altura explícita e ficar no fluxo normal do layout. Não usar um mount absoluto sem altura própria nem depender de `height: 100%` sem ancestral dimensionado. Chamar `map.resize()` no evento `load` e observar o elemento real com `ResizeObserver`.

**Why:** o plugin de idioma lançou exceções com o estilo customizado e com o fallback; além disso, o CSS do Mapbox aplica `position: relative` e um mount sem altura própria pode colapsar para 0px.

**How to apply:** mantenha um único estilo compartilhado para Central, PWA, cadastro de filial e modal de entrega; use o token `VITE_MAPBOX_PUBLIC_TOKEN` via Secrets e configure alturas explícitas por contexto.
