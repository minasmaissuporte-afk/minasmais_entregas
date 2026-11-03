---
name: Cache dos assets do PWA
description: Prevenir chunks antigos ou respostas HTML inválidas no cache do service worker.
---

O cache do service worker deve mudar com os assets de cada build, remover caches antigos na ativação e não armazenar `text/html` em URLs de assets. Rotas SPA podem responder com `index.html` e status 200 para um chunk JS inexistente; a tela de erro para falha de importação dinâmica deve oferecer recarga completa, não apenas remontar o componente.

**Why:** um PWA pode manter um bundle antigo após republicação; um chunk dinâmico removido pode receber HTML de fallback e ficar preso no cache como se fosse JavaScript.

**How to apply:** derive o nome do cache dos arquivos JS/CSS emitidos, faça o worker verificar atualizações em cada carregamento e limpe os caches de versão anterior ao ativar a nova versão.
