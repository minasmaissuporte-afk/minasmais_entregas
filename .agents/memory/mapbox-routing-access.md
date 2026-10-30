---
name: Acesso e requisitos do Mapbox
description: Recursos Mapbox habilitados para mapas, geocodificação e rotas neste projeto.
---

O usuário confirmou que a conta Mapbox tem acesso ao Optimization API v2 Beta e à geocodificação permanente. Coordenadas selecionadas são armazenadas para entregas, filiais e rotas; não usar resultados temporários para esse fluxo. As rotas agrupadas precisam manter a precedência coleta antes da entrega.

**Why:** o usuário escolheu o Mapbox para mapa, busca de endereços e rotas, e confirmou esses recursos da conta.

**How to apply:** usar Geocoding v6 com `permanent=true` e Optimization v2 para rotas agrupadas. Manter tokens no fluxo de Secrets; nunca registrar valores em memória ou logs.
