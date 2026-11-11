# Google Maps (substituiu o Mapbox em 11/2026)

- Servidor: `artifacts/api-server/src/lib/googleMaps.ts`.
  - Busca de endereços: Places API (New) Text Search, restrita ao Brasil.
  - Geocodificação: Geocoding API.
  - Traçado: Routes API `computeRoutes` (polyline decodificada no servidor).
  - Rotas agrupadas: Route Optimization API `optimizeTours` (coleta antes da entrega, rota aberta).
- A Route Optimization API não aceita chave de API: usa conta de serviço (`GOOGLE_SERVICE_ACCOUNT_JSON`, com `FIREBASE_SERVICE_ACCOUNT_JSON` como reserva).
- Painel: `live-googlemap.tsx` (Maps JavaScript API + AdvancedMarkerElement). Marcadores HTML exigem Map ID; sem `VITE_GOOGLE_MAPS_MAP_ID` usa `DEMO_MAP_ID`.
- O contêiner do mapa precisa de altura explícita (classe `live-map-frame`).
- Termos do Google: coordenadas da Geocoding/Places só podem ficar em cache por até 30 dias; o place ID pode ser guardado sem limite. O app hoje persiste coordenadas em entregas e filiais — revisar antes de produção.
