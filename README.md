# Minas Mais Entregas

Sistema de entregas da Rede Minas Mais (Drogarias Minas Mais). Reúne num só lugar:

- **Painel da central**: acompanha os pedidos ao vivo, despacha motoboys, monta rotas agrupadas e mostra relatórios.
- **Painel das filiais**: a loja registra o pedido (valor e destino) e acompanha a entrega.
- **Portal do motoboy**: PWA e app Android para receber ofertas, seguir a rota no mapa, confirmar coletas e entregas (com foto) e ver os repasses.
- **API**: regras de negócio, permissões por papel, notificações push e integração com mapas.

## Tecnologias

| Camada | Stack |
|---|---|
| Monorepo | pnpm workspaces, Node.js 24, TypeScript 5.9 |
| API | Express 5, Drizzle ORM, PostgreSQL, Zod, Pino |
| Painel e PWA | React 19, Vite 7, Tailwind CSS 4, shadcn/ui, TanStack Query, Wouter |
| App Android | Capacitor (empacota o painel web) |
| Login | Supabase Auth (e-mail e senha, código por e-mail e Google) |
| Mapas | Google Maps Platform (Maps JavaScript, Places, Geocoding, Routes e Route Optimization) |
| Notificações | Web Push (VAPID) e Firebase Cloud Messaging (Android) |
| Contrato da API | OpenAPI com geração de código pelo Orval (hooks React Query e schemas Zod) |
| Testes | Playwright (API e interface, desktop e celular) |

## Estrutura

```
artifacts/
  api-server/            API Express (src/routes, src/lib, src/middlewares)
  minas-mais-entregas/   Painel web, PWA do motoboy e projeto Android (Capacitor)
  minas-mais-motoboy/    App Expo antigo (ainda com scripts do Replit; fora do build padrão)
lib/
  api-spec/              openapi.yaml: contrato da API (fonte da verdade)
  api-zod/               Schemas Zod gerados a partir do contrato (usados pela API)
  api-client-react/      Hooks React Query gerados a partir do contrato (usados pelo painel)
  db/                    Schema do banco (Drizzle) e migrações SQL
e2e/                     Testes ponta a ponta com Playwright
scripts/                 Scripts auxiliares (banco local, verificação do pnpm)
```

### Papéis de acesso

| Papel | O que faz |
|---|---|
| `ADMIN` | Tudo, inclusive gerenciar acessos e filiais |
| `CENTRAL` | Despacho, rotas, acompanhamento e relatórios |
| `STORE_MANAGER` / `STORE_STAFF` | Pedidos e acompanhamento da própria filial |
| `COURIER` | Portal do motoboy |
| `PENDING` | Conta criada, aguardando aprovação de um administrador |

Os e-mails em `INITIAL_ADMIN_EMAIL(S)` viram `ADMIN` no primeiro acesso, desde que ainda não exista nenhum administrador.

## Como rodar localmente

Requisitos: **Node.js 24**, **pnpm 10** e **PostgreSQL** (16 ou mais recente).

1. **Variáveis de ambiente:** copie `.env.example` para `.env`, na raiz do projeto, e preencha. O mínimo para abrir o sistema:
   - `DATABASE_URL`
   - `SUPABASE_URL` e `SUPABASE_SECRET_KEY`
   - `VITE_SUPABASE_URL` e `VITE_SUPABASE_PUBLISHABLE_KEY`
   - `VITE_GOOGLE_MAPS_API_KEY` e `GOOGLE_MAPS_API_KEY`, para os mapas
2. **Banco:** crie um banco vazio `minas_mais_entregas` em qualquer Postgres.
   Neste computador de desenvolvimento já existe uma instância só do projeto (porta 5433, sem precisar de administrador). Ela não liga sozinha depois de reiniciar o computador:
   ```bash
   pnpm db:start
   ```
   `pnpm db:stop` desliga e `pnpm db:status` mostra se está ligada.
3. **Dependências e tabelas:**
   ```bash
   pnpm install
   pnpm db:push
   ```
4. **Subir o sistema**, cada comando num terminal:
   ```bash
   pnpm dev:api
   ```
   ```bash
   pnpm dev:web
   ```
   Abra http://localhost:5173. Em desenvolvimento, o Vite encaminha `/api` para a API em http://localhost:8080.

## Comandos úteis

| Comando | O que faz |
|---|---|
| `pnpm dev:api` | Compila e sobe a API (porta 8080) |
| `pnpm dev:web` | Sobe o painel com recarga automática (porta 5173) |
| `pnpm db:push` | Aplica o schema do Drizzle no banco (só desenvolvimento) |
| `pnpm db:start` / `db:stop` / `db:status` | Liga, desliga ou mostra o banco local do projeto |
| `pnpm run typecheck` | Verifica os tipos de todo o monorepo |
| `pnpm run build` | Typecheck e build da API e do painel |
| `pnpm --filter @workspace/api-spec run codegen` | Gera de novo os schemas Zod e os hooks a partir do `openapi.yaml` |
| `pnpm --filter @workspace/e2e test` | Roda os testes Playwright (API e interface) |

### Alterando a API

1. Edite o contrato em `lib/api-spec/openapi.yaml`.
2. Rode o codegen (comando acima).
3. Implemente a rota em `artifacts/api-server/src/routes/`, validando com os schemas de `@workspace/api-zod`.
4. No painel, use os hooks de `@workspace/api-client-react`.

## Integrações externas

### Supabase Auth (login)

- **Banco:** aplique `lib/db/migrations/0001_supabase_auth.sql` antes de subir a API. Ela renomeia `clerk_user_id` para `auth_user_id` e limpa os IDs antigos.
- **Usuários antigos:** as senhas do Clerk não podem ser levadas. Cada pessoa entra com **código por e-mail** ou **Esqueci minha senha**. A API reconhece o e-mail e mantém papel, filial e histórico.
- **No painel do Supabase (Authentication):**
  - **URL Configuration:** em `Site URL`, o endereço do sistema. Em `Redirect URLs`, adicione `https://SEU-DOMINIO/user-portal`, `https://SEU-DOMINIO/redefinir-senha` e `http://localhost:5173/**`.
  - **Email Templates → Magic Link:** inclua `{{ .Token }}` no texto, para o e-mail trazer o código de 6 dígitos.
  - **Providers:** ative Email (com confirmação) e Google.
  - **SMTP:** em produção, use um SMTP próprio. O envio padrão do Supabase manda poucos e-mails por hora.

### Google Maps Platform

**APIs a ativar no Google Cloud:**
- Maps JavaScript API
- Places API (New)
- Geocoding API
- Routes API
- Route Optimization API

**Variáveis:**

| Variável | Uso |
|---|---|
| `VITE_GOOGLE_MAPS_API_KEY` | Chave do navegador (mapa). Restrinja por domínio. |
| `VITE_GOOGLE_MAPS_MAP_ID` | Map ID do Google Cloud. Sem ele o mapa usa `DEMO_MAP_ID`, que só serve para desenvolvimento. |
| `GOOGLE_MAPS_API_KEY` | Chave do servidor: busca de endereços, geocodificação e traçado. |
| `GOOGLE_SERVICE_ACCOUNT_JSON` | Conta de serviço com o papel *Route Optimization Editor*, para otimizar as rotas agrupadas. Essa API não aceita chave. |

**Observação de termos de uso:** o Google só permite guardar coordenadas da Geocoding e da Places por até 30 dias. Hoje o sistema grava coordenadas nas entregas e filiais; isso precisa ser revisto antes de ir para produção.

### Notificações

- **Web Push:** use as mesmas `VAPID_PUBLIC_KEY` e `VAPID_PRIVATE_KEY` da versão anterior. Chaves novas invalidam as inscrições de todos os aparelhos.
- **Android:** `FIREBASE_SERVICE_ACCOUNT_JSON`, a conta de serviço do projeto Firebase.

## App Android

O app é o painel web empacotado com o Capacitor (`artifacts/minas-mais-entregas/android`). O workflow `.github/workflows/android-apk.yml` gera o APK assinado. Os secrets do GitHub necessários estão descritos em `.github/ANDROID_APK_SETUP.md`.

**Atenção:** o APK atual carrega `https://minas-mais-entregas.replit.app`. Ao trocar de domínio, atualize `capacitor.config.ts` e `VITE_NATIVE_API_BASE_URL` e gere um APK novo.

## Status da migração do Replit

- [x] Fase 1: roda localmente no Windows (sem plugins do Replit, `.env` na raiz, proxy `/api` no Vite)
- [x] Login trocado do Clerk (gerenciado pelo Replit) para o Supabase Auth
- [x] Mapas trocados do Mapbox para o Google Maps
- [ ] Fase 2: trocar o Object Storage do Replit (as fotos de comprovante só funcionam lá) e remover a URL `replit.app` fixa no código
- [ ] Fase 3: infraestrutura própria (hospedagem, Postgres, armazenamento, domínio)
- [ ] Fase 4: virada (dump do banco, cópia das fotos, DNS)
- [ ] Fase 5: novo APK Android e desligamento do Replit
