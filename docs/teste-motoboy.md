# Teste do ponto de vista do motoboy — Minas Mais Entregas

**Data:** 16/11/2026 · **Como:** celular simulado 390×844 (toque, GPS em BH), painel com o código atual, Google Maps funcionando, API local.
**Jornadas:** (1) entrega individual, do "ficar online" até a entrega concluída com foto; (2) rota com 2 pedidos da mesma loja.
**Teste automático:** `e2e/tests/ui/courier-jornada.spec.ts` (rode com `E2E_JORNADA=1`; gera `e2e/test-results/jornada/` com as capturas e `jornada.json`).

## Atalhos implementados (16/11/2026) — antes × depois

| | Antes | Depois |
|---|---|---|
| Oferta chegar no celular (sem push) | 13–15 s | **2,5–4,6 s** (busca a cada 5 s quando online e livre) |
| Aviso de nova oferta no navegador | só no app Android | **vibração + som** também no PWA |
| Toques de etapa até a foto | 4 (aceitar, iniciar ida, chegada, saída) | **3** (aceitar, "Cheguei na loja", "Peguei o pedido, sair para entrega") |
| Navegar até a loja / até o cliente | 2 toques (aba Mapa → Google Maps) | **1 toque** — botões "Navegar até a loja" e "Navegar até o cliente" no cartão |
| Perto da loja | nada | botão "Cheguei na loja" **pulsa** + aviso "Você está na loja?" (GPS a ≤150 m) |
| Deslizar para concluir depois da foto | escondido atrás da barra inferior (rolar) | a tela **rola sozinha** até o controle |
| Oferta individual | só o valor | **"Até a loja ≈ X · Loja → cliente ≈ Y · ~Z min"** |
| Cabeçalho com oferta/entrega | 1/3 da tela (saudação + cartão + aviso) | **compacto**; aviso de notificações volta quando o motoboy está livre |
| Textos da rua (código, situação) | 10–11 px | **13 px** |
| Botão principal visível sem rolar | "Aceitar entrega" atrás da barra inferior | todas as ações principais **na zona do polegar** |

**Total de gestos na entrega individual:** de ~10 para **7** (online, aceitar, chegada, saída, navegar, foto, deslizar).
Arquivos: `pages/courier-portal.tsx`, `components/evidence-photo-action.tsx`, `components/live-googlemap.tsx`, `index.css`.
Validado com `e2e/tests/ui/courier-jornada.spec.ts` (2/2) e os demais testes do motoboy (12/12).

## Resultado geral (antes dos atalhos)

As duas jornadas funcionam de ponta a ponta. As respostas aos toques são rápidas (0,2–0,6 s). O que mais pesa para o motoboy é **esperar a oferta chegar (13–15 s)**, **passos repetidos** e **a navegação até o cliente não estar a um toque**.

### Tempos medidos

| Etapa | Toques | Tempo |
|---|---|---|
| Abrir o app (já logado) até poder trabalhar | 0 | 1,6–1,8 s |
| Ficar online | 1 | 0,6–1,1 s |
| **Oferta chegar no celular** (sem push) | 0 | **13–15 s** |
| Aceitar a entrega | 1 | 0,2–0,4 s |
| Iniciar ida à loja | 1 | 0,4–0,6 s |
| Confirmar chegada à loja | 1 | 0,2 s |
| Confirmar saída para entrega | 1 | 0,3–0,5 s |
| Abrir navegação até o cliente | **2** (Mapa → Google Maps) | — |
| Foto + deslizar para concluir (inclui rolar a tela) | 3 | 2,7–3,9 s |
| Aceitar rota (GPS + otimização Google) | 1 | 2,4–2,5 s |
| Chegada à loja (rota) | 1 | 0,4 s |
| Saída da loja — 2 pedidos de uma vez | 1 | 0,5 s |
| Cada entrega da rota (foto + deslizar) | 2–3 | 2,2–3,4 s |

**Total de gestos:** entrega individual ≈ **10** (1 online + 4 botões de etapa + 2 navegação + 3 foto/rolar/deslizar). Rota de 2 pedidos ≈ **8**.

### O que está bom
- Botões principais grandes (48–50 px de altura, largura total) e **na zona do polegar** (parte de baixo da tela) em todas as etapas.
- Nenhum alvo de toque menor que 44 px nas telas de trabalho.
- Respostas rápidas; o botão mostra "Salvando…" e evita toque duplo.
- Rota: **uma chegada e uma saída** na loja para todos os pedidos; "Navegar" já aparece no cartão da próxima parada.
- Foto comprimida no celular: 2–4 s para enviar e concluir, mesmo com foto grande.
- Tela final clara: "Aguardando pedidos…" + "Hoje: 1 entrega · R$ 8,50".
- Telefone e WhatsApp do cliente a um toque.

## Problemas encontrados

### 1. Tela do motoboy quebrava inteira quando o Google Maps falha — CORRIGIDO
- **Gravidade:** BLOQUEIA
- **O que acontecia:** se o mapa não carrega (chave recusada, cota do Google, internet ruim), ao tocar em "Confirmar saída para entrega" a tela inteira virava "Não foi possível abrir esta tela — Cannot read properties of undefined (reading 'getRootNode')". O motoboy ficava sem o botão da foto e sem como concluir.
- **Correção:** a limpeza do mapa em `components/live-googlemap.tsx` agora é protegida; se o mapa falhar, só o mapa fica sem desenho e a entrega segue.

### 2. Oferta demora até 15 s para aparecer
- **Gravidade:** ALTA (rapidez)
- **O que acontece:** sem notificação push ativa, o app só procura pedidos novos a cada 15 s. No teste a oferta apareceu em 13–15 s.
- **Sugestão:** quando o motoboy estiver online e sem entrega, procurar a cada 5 s (ou manter a conexão aberta) e garantir o push com som; mostrar "Nova entrega!" em tela cheia com vibração.

### 3. Navegação até o cliente precisa de 2 toques na entrega individual
- **Gravidade:** ALTA (atalho)
- **O que acontece:** no cartão "Entrega em andamento" há ícones de telefone, WhatsApp e mapa, mas o ícone de mapa abre o mapa do app; para abrir o Google Maps/Waze é preciso ir à aba Mapa e tocar em "Google Maps". Na rota já existe o botão "Navegar" no cartão.
- **Sugestão:** botão grande **"Navegar"** no cartão da entrega individual (como na rota), indo direto para o Google Maps/Waze — e abrir a navegação automaticamente ao confirmar a saída da loja (opcional nas configurações).

### 4. Passo "Iniciar ida à loja" é redundante
- **Gravidade:** MÉDIA (atalho)
- **O que acontece:** depois de "Aceitar entrega" o motoboy ainda precisa tocar em "Iniciar ida à loja" antes de "Confirmar chegada". São 4 toques de etapa antes da foto.
- **Sugestão:** ao aceitar, já marcar "A caminho da loja". E sugerir "Cheguei na loja" automaticamente quando o GPS estiver a ~100 m da filial (o toque continua, mas o botão já fica destacado/pulsando).

### 5. Depois de escolher a foto, o "deslizar para concluir" fica escondido
- **Gravidade:** MÉDIA
- **O que acontece:** ao escolher a foto, o controle de deslizar aparece abaixo da barra inferior; é preciso rolar a tela para vê-lo (aconteceu na entrega individual e na 1ª entrega da rota).
- **Sugestão:** rolar automaticamente até o controle quando a foto é escolhida (ou mostrar o controle fixo acima da barra inferior).

### 6. Oferta individual não mostra distância nem tempo
- **Gravidade:** MÉDIA
- **O que acontece:** o cartão de "Nova entrega" mostra só o valor (R$ 8,50); a rota mostra km e minutos, a entrega individual não. O mini-mapa da oferta aparece como um quadro cinza vazio enquanto carrega e ocupa ~1/6 da tela.
- **Sugestão:** mostrar "Até a loja: X km · Loja → cliente: Y km · ~Z min" ao lado do valor; esconder o mini-mapa ou carregá-lo com prévia estática.

### 7. Cabeçalho ocupa um terço da tela durante a entrega
- **Gravidade:** BAIXA
- **O que acontece:** saudação "Olá, …", cartão online/offline e o aviso de notificações ocupam ~1/3 da altura do celular em todas as etapas.
- **Sugestão:** cabeçalho compacto (uma linha) quando há entrega em andamento; o aviso de notificações pode virar um ícone depois de visto.

### 8. Textos pequenos para ler em movimento
- **Gravidade:** BAIXA
- **O que acontece:** código do pedido (MM-…) e situação ("A caminho da unidade") em 10–11 px.
- **Sugestão:** mínimo de 13–14 px para o que o motoboy confere na rua.

## Não testado aqui
- Push com som/vibração chegando com o celular bloqueado (precisa de celular real).
- Uso com luva, sol forte e uma mão só (precisa de teste em campo).
- Câmera real (o teste anexa um arquivo; no celular abre a câmera traseira).
