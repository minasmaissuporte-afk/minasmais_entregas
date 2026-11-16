# Minas Mais Entregas — Relatório de testes pré-lançamento

**Data:** 16/11/2026 · **Ambiente:** painel em http://localhost:5173 e API local (banco Postgres local; Supabase `qgchinvenshmprdfccui` para login e fotos; Google Maps) · **Navegadores:** Chromium (desktop 1440×900 e celular 390×844)
**Contas:** somente contas de teste `e2e-*@example.com` (nenhuma conta pessoal, nenhum dado real de cliente).

## Resumo

| | |
|---|---|
| Testes automáticos executados | 311 (319 com o tour visual opcional) |
| Passaram | 305 |
| Falharam (todos por problemas reais do sistema) | 6 |
| Problemas reportados abaixo | 14 (2 BLOQUEIA, 4 ALTA, 5 MÉDIA, 3 BAIXA) |

A bateria fica em `e2e/` e roda com `pnpm --filter @workspace/e2e test`.

---

## Correções feitas depois do teste (16/11/2026)

| # | Problema | Situação |
|---|---|---|
| 1 | Foto de comprovação não abre | **Corrigido:** a foto é baixada com o login e aparece no próprio detalhe, com "Abrir foto em tamanho real" (`components/evidence-photo-viewer.tsx`). |
| 2 | "Entrar com Google" com erro cru | **Contornado:** o botão só aparece quando o provedor Google está ativo no Supabase. **Falta:** ativar o Google em Supabase → Authentication → Providers, se quiserem esse login. |
| 3 | Botão Google Maps leva para outro destino | **Corrigido:** na retirada, o painel mostra a loja (o mesmo destino da navegação). |
| 4 | Uma retirada por pedido na mesma loja | **Corrigido:** retiradas seguidas na mesma loja viram uma parada só, com uma chegada e uma saída para todos os pedidos, na API e na tela (lista, cartão e mapa). |
| 5 | "GPS bloqueado" para qualquer falha | **Corrigido:** uma mensagem para cada caso (bloqueado, indisponível, demorando) e aceite com posição de até 30 s. |
| 6 | Busca por CEP sem resultado | **Corrigido:** CEP (e buscas sem resultado no Places) usam a Geocoding API. |
| 7 | Complemento de outro estabelecimento | **Corrigido:** "sala/loja/andar" de empresas sai das sugestões; sugestões repetidas são removidas. |

Verificação: bateria de API 210/210 contra a API com as correções; testes de tela da foto, do botão do Google e da rota (painel da retirada, link de navegação e lista com retirada única) aprovados num painel com o código atual.

Para valer no painel da porta 5173: reiniciar a API (`pnpm dev:api`) e gerar o painel de novo (`pnpm --filter @workspace/minas-mais-entregas run build` + reiniciar o `vite preview`), porque hoje a 5173 serve uma versão compilada antiga.

## Problemas encontrados

### 1. Foto de comprovação não abre no detalhe da entrega
- **Gravidade:** BLOQUEIA
- **Onde:** `/deliveries/:id` → link da foto · perfil CENTRAL (e ADMIN)
- **Passos:**
  1. Motoboy conclui uma entrega com foto (pelo portal, funciona).
  2. Central abre o detalhe da entrega.
  3. Clica no link da foto de comprovação.
- **O que aconteceu:** abre uma aba nova com o texto `{"error":"Autenticação necessária."}`.
- **Esperado:** a foto aparecer.
- **Causa provável:** o link aponta direto para `/api/deliveries/:id/evidence`; a API agora só aceita o login pelo cabeçalho `Authorization` (Supabase), que uma aba nova não envia. A foto precisa ser baixada pelo app (fetch com o token) e exibida como imagem, ou a API precisa gerar uma URL assinada temporária do Storage.

### 2. "Entrar com Google" mostra erro técnico
- **Gravidade:** BLOQUEIA (para quem tentar entrar com Google) / ALTA
- **Onde:** `/sign-in` · sem login
- **Passos:**
  1. Abrir a tela de login.
  2. Clicar em "Entrar com Google".
- **O que aconteceu:** abre uma página do Supabase com `{"code":400,"error_code":"validation_failed","msg":"Unsupported provider: provider is not enabled"}`.
- **Esperado:** abrir o login do Google, ou o botão não existir.
- **Correção:** ativar o provedor Google no Supabase (Authentication → Providers) com o Client ID/Secret do Google Cloud, ou esconder o botão até lá.

### 3. Mapa da rota: cartão mostra um destino e o botão "Google Maps" leva para outro
- **Gravidade:** ALTA
- **Onde:** portal do motoboy → aba Mapa, com rota agrupada aceita · perfil MOTOBOY (celular)
- **Passos:**
  1. Central agrupa 2 entregas da mesma loja em uma rota.
  2. Motoboy aceita a rota e abre a aba Mapa.
- **O que aconteceu:** o cartão diz "PRÓXIMA PARADA · ENTREGA · Av. do Contorno, 6000…", mas o botão "Google Maps" abre `destination=-19.9365,-43.9351`, que é a **loja** (a retirada ainda pendente).
- **Esperado:** cartão e navegação apontarem para a mesma parada (a próxima de verdade).

### 4. Prévia promete "Retirada única", mas a rota aceita tem uma retirada por pedido
- **Gravidade:** ALTA
- **Onde:** portal do motoboy → oferta de rota e rota aceita · perfil MOTOBOY
- **Passos:**
  1. Central agrupa 2 ou 3 entregas da mesma filial.
  2. Motoboy vê a prévia ("Retirada única: E2E Drogaria Savassi") e aceita.
- **O que aconteceu:** a rota aceita lista "1. Retirada", "2. Retirada" (e uma terceira com 3 pedidos), todas na mesma loja; cada uma exige "chegar" e "confirmar saída".
- **Esperado:** uma única parada de retirada na loja para todos os pedidos dela, como a prévia mostra.

### 5. "GPS bloqueado" aparece para qualquer falha de localização
- **Gravidade:** ALTA
- **Onde:** portal do motoboy → "Aceitar e calcular rota" · perfil MOTOBOY
- **Passos:**
  1. Motoboy online, com o GPS funcionando, recebe uma rota.
  2. Toca em "Aceitar e calcular rota" em um lugar com sinal fraco (no teste, a leitura nova demorou mais de 15 s).
- **O que aconteceu:** mensagem "GPS bloqueado. Permita Localização nas configurações do navegador…". O erro real foi *tempo esgotado* (código 3) / *posição indisponível* (código 2), não bloqueio.
- **Esperado:** mensagem certa para cada caso ("Sem sinal de GPS, tente perto de uma janela" etc.) e usar a posição recente que o app já acompanha (por exemplo, `maximumAge` de 30 s) antes de exigir uma leitura nova.
- **Onde no código:** `pages/courier-routes-section.tsx`, função `requestCurrentLocation`.

### 6. Busca de endereço por CEP não traz nenhuma sugestão
- **Gravidade:** ALTA
- **Onde:** formulário "Registrar entrega" e cadastro de filial (`/filiais`) · perfis CENTRAL e ADMIN
- **Passos:**
  1. No campo "Endereço de entrega", digitar `30130-151`.
- **O que aconteceu:** nenhuma sugestão (a API devolve lista vazia).
- **Esperado:** sugestões do CEP — o próprio campo diz "Digite rua, número, bairro ou CEP".

### 7. Sugestões de endereço trazem complemento de outro estabelecimento
- **Gravidade:** MÉDIA
- **Onde:** formulário "Registrar entrega" · perfil CENTRAL
- **Passos:**
  1. Digitar "Rua Pernambuco, 1000, Belo Horizonte" e escolher a 1ª sugestão.
- **O que aconteceu:** o endereço salvo da entrega ficou "R. Pernambuco, 1000 - **loja 01/05** - Funcionários…". Outros exemplos: "Av. Afonso Pena, 1500 - **15° andar**", "R. Pernambuco, 1000 - **sala 26**".
- **Esperado:** sugerir o endereço da rua (sem sala/andar/loja de empresas que estão no mesmo número); o complemento é do cliente.

### 8. Ativar notificações: erro do navegador aparece em inglês
- **Gravidade:** MÉDIA
- **Onde:** sino no topo do painel · perfil CENTRAL
- **Passos:**
  1. Com notificações permitidas, clicar no sino cortado quando o navegador não consegue registrar o push.
- **O que aconteceu:** mensagem "Registration failed - permission denied".
- **Esperado:** mensagem em português explicando o que fazer.
- **Observação:** o envio e o recebimento reais de push não puderam ser confirmados no navegador automatizado; ver "Não testado".

### 9. Mapa da prévia da rota mostra o estado inteiro
- **Gravidade:** MÉDIA
- **Onde:** portal do motoboy → oferta de rota agrupada · perfil MOTOBOY (celular)
- **O que aconteceu:** o mini-mapa da prévia abre com zoom de estado (aparecem Uberlândia, Espírito Santo, Rio de Janeiro) e os pinos ficam empilhados sobre BH.
- **Esperado:** enquadrar a loja e as entregas da rota.

### 10. Cadastro manda link de confirmação, não código de 6 dígitos
- **Gravidade:** MÉDIA (diferença entre o roteiro e o sistema)
- **Onde:** `/sign-up` · sem login
- **O que aconteceu:** após "Solicitar acesso", a tela diz "Enviamos um link de confirmação…". O código de 6 dígitos existe só no login "Sem senha" (e funciona).
- **Esperado (pelo roteiro):** código de 6 dígitos por e-mail no cadastro. Decidir qual é o comportamento certo e alinhar tela, e-mail do Supabase e roteiro.

### 11. Não existe opção de editar uma entrega
- **Gravidade:** MÉDIA (diferença entre o roteiro e o sistema)
- **Onde:** `/entregas` e `/deliveries/:id` · perfil CENTRAL e ADMIN
- **O que aconteceu:** não há botão nem rota de API para editar endereço, telefone ou observações de uma entrega registrada; só criar, cancelar e excluir.
- **Esperado (pelo roteiro):** "Criar, editar, cancelar e excluir entrega".

### 12. Detalhe da entrega não tem mapa
- **Gravidade:** BAIXA (diferença entre o roteiro e o sistema)
- **Onde:** `/deliveries/:id` · perfil CENTRAL
- **O que aconteceu:** o detalhe mostra o texto "O painel não dispõe de mapa…". O roteiro pede conferir "o mapa dentro de cada entrega".

### 13. Sugestões de endereço demoram a aparecer
- **Gravidade:** BAIXA
- **Onde:** formulário de entrega e prévia de rota
- **O que aconteceu:** sugestões de endereço apareceram de 2,7 s a 3,2 s depois de começar a digitar (a API responde em 0,4–0,9 s; há 400 ms de espera de digitação; a 1ª busca do dia levou 2,4 s). Prévia de rota otimizada: 1,5–1,8 s.
- **Esperado:** aceitável, mas vale um indicador "Buscando…" visível desde a primeira letra.

### 14. Logins de teste criados no projeto Supabase novo
- **Gravidade:** BAIXA (limpeza antes de publicar)
- **O que aconteceu:** a bateria cria 6 logins `e2e-*@example.com` no Supabase `qgchinvenshmprdfccui` (login e fotos). Remover antes de ir para o ar:
  `pnpm --filter @workspace/e2e run clean -- --auth`

---

## O que foi testado e está funcionando

- **Login e conta:** e-mail + senha; e-mail em maiúsculas/com espaços; senha errada com mensagem em português; "Sem senha" com código de **6 dígitos** (código errado → "Código inválido ou expirado. Peça um novo código."); tela "Criar nova senha" (valida mínimo de 8 e troca a senha); validações do cadastro; sair e entrar de novo; F5 em todas as telas mantém o login e a tela.
- **Permissões:** matriz completa papel × rota da API (6 perfis × 45 rotas); LOJA, MOTOBOY e PENDENTE não abrem nenhuma página da Central digitando o endereço; CENTRAL não abre `/access` nem `/filiais`; loja só vê a própria filial; nenhum vazamento entre filiais encontrado.
- **Mapa (Google):** `/mapa` carrega sem erro de chave, com filiais e motoboy; zoom e arrasto funcionam; no celular a rolagem da página passa por cima do mapa (não prende).
- **Endereços:** rua com número, sem número, bairro de BH (Savassi, Pampulha), Contagem, Betim e Nova Lima — 1ª sugestão a menos de 1,5 km do lugar certo; sem acentos/minúsculas funciona; cadastro de filial preenche rua, número, bairro, cidade, UF e CEP e salva as coordenadas certas.
- **Rotas:** otimização pelo Google funciona (prévia 1,5–1,8 s, aceite 0,7–1,3 s); coleta antes da entrega; trajeto desenhado no mapa; botões Google Maps/Waze; recálculo após ocorrência mantém as outras entregas; ordem das entregas faz sentido.
- **Fotos:** envio pelo celular e conclusão em 2,5 s; foto grande (7,5 MB) aceita; internet lenta (3G simulado) conclui em ~5 s porque o app comprime a foto; arquivo que não é imagem, foto de outra entrega e foto não enviada são recusados; a exclusão da entrega apaga a foto.
- **Básico:** criar, cancelar (Central) e excluir (só Admin) pela tela; lista, filtros, busca; relatórios batem com o banco.

## Não testado (precisa de pessoa com e-mail e celular reais)

- Chegada dos e-mails (código, confirmação de cadastro, redefinição de senha): tempo de entrega e se cai no spam.
- Código vencido e o botão "pedir um código novo" (evitamos disparar e-mails reais).
- Link de redefinição aberto em **outro aparelho**: o login usa PKCE, então o link do e-mail só funciona no mesmo navegador que pediu a redefinição — testar pedindo no computador e abrindo no celular.
- Ativação real do sino e recebimento da notificação quando outro usuário cancela uma entrega (o navegador automatizado não consegue registrar push).
- Aceitar a rota tocando no botão em um celular real com GPS (validado pela API; ver item 5).
