# EcomZero Ads Audit

Produto multi-tenant para conectar lojas Shopee, sincronizar anúncios e gerar auditorias com IA. A Fase 1 é estritamente read-only na Shopee: nenhuma rota chama `update_item` ou outro endpoint de escrita.

## Stack

| Camada | Tecnologia |
|---|---|
| Backend | Node.js 20, Express 4, Prisma 6, PostgreSQL 16 |
| Filas | BullMQ e Redis |
| IA | Anthropic Messages API |
| Frontend | React 19, Vite 6, Tailwind CSS 4 |

## Segurança

- Tokens Shopee são criptografados com AES-256-GCM e sempre começam com `enc:v1:`.
- `decrypt()` rejeita texto puro e ciphertext inválido; não existe fallback silencioso.
- OAuth é vinculado ao usuário por JWT de propósito único e duração de 10 minutos, transferido para cookie HttpOnly durante o redirect.
- Uma loja já vinculada nunca pode ser assumida por outro usuário.
- Todas as consultas de loja, anúncio e auditoria filtram pelo `userId` autenticado.
- JWT de login usa somente HS256 e expira em 7 dias.
- Login e registro possuem rate limit; a comparação de senha usa bcrypt válido mesmo para e-mail inexistente.
- CORS usa allowlist e a API envia headers de segurança com Helmet.
- Chaves, tokens e payloads de autenticação nunca são registrados em logs.

## Configuração local

### 1. PostgreSQL

```bash
docker compose up -d postgres
```

O PostgreSQL fica em `localhost:5433`. O Compose não sobe Redis: use o Redis local já existente em `localhost:6379`.

### 2. Backend

```bash
cd backend
npm install
cp .env.example .env
npx prisma migrate deploy
npm start
```

Gere segredos diferentes para cada ambiente:

```bash
openssl rand -hex 32
```

Use o resultado em `JWT_SECRET` e gere outro para `TOKEN_ENCRYPTION_KEY`.

Variáveis externas obrigatórias para o fluxo real:

- `SHOPEE_PARTNER_KEY`
- `SHOPEE_REDIRECT_URL`, cadastrada na Shopee e terminando em `/api/shopee/callback`
- `ANTHROPIC_API_KEY`
- `REDIS_URL`

`WORKERS_ENABLED=false` inicia somente a API, útil para diagnóstico. Em operação normal deixe `true` para iniciar os workers de sync e auditoria junto do backend.

### 3. Frontend

```bash
cd frontend
npm install
cp .env.example .env
npm run dev
```

Frontend local: `http://localhost:5174`. Backend local: `http://localhost:4000`.

## Fluxo implementado

1. Usuário cria conta ou entra.
2. Frontend cria uma sessão OAuth curta e redireciona para a Shopee.
3. Callback troca o `code` por tokens, cifra os dois e salva a loja.
4. Sincronização é enfileirada, pagina todos os anúncios ativos e consulta base info e extra info em lotes adaptativos.
5. Auditoria cria um job BullMQ por anúncio, com concorrência e RPM configuráveis.
6. Frontend mostra score, issues, dados atuais, sugestões e histórico.

## API

| Método | Rota | Descrição |
|---|---|---|
| GET | `/api/health` | Healthcheck |
| POST | `/api/auth/register` | Cadastro |
| POST | `/api/auth/login` | Login |
| POST | `/api/auth/logout` | Logout local |
| GET | `/api/me` | Usuário atual |
| POST | `/api/shopee/authorize-session` | Estado OAuth curto |
| GET | `/api/shopee/authorize` | Redirect assinado para Shopee |
| GET | `/api/shopee/callback` | Callback OAuth |
| GET | `/api/stores` | Lojas do usuário |
| POST | `/api/stores/:id/sync` | Enfileira sincronização |
| GET | `/api/stores/:id/sync-status` | Progresso da sincronização |
| POST | `/api/stores/:id/audit` | Enfileira auditoria |
| GET | `/api/stores/:id/audit-status?runId=...` | Progresso da auditoria |
| GET | `/api/stores/:id/items` | Anúncios e score mais recente |
| GET | `/api/items/:id` | Detalhes do anúncio |
| GET | `/api/items/:id/audits` | Histórico de auditorias |

Falhas seguem `{ "error": "...", "code": "..." }`; detalhes internos e stacks ficam somente no servidor.

## Sincronização Shopee

- `product/get_item_list` usa `offset`, `page_size` e `has_next_page` até esgotar.
- `product/get_item_base_info` e `product/get_item_extra_info` usam lote configurável.
- Se a Shopee acusar limite de lote, o lote é dividido recursivamente.
- O primeiro retorno de extra info é logado para confirmação do contrato antes do mapeamento.
- Payload desconhecido falha explicitamente; nenhum nome de campo é inventado.
- Anúncios antigos são marcados inativos somente depois que a coleta completa termina com sucesso.

## Auditoria Anthropic

- Um anúncio por job, `concurrency=3` por padrão.
- Limite global configurado por `ANTHROPIC_REQUESTS_PER_MINUTE`.
- Resposta precisa ser JSON puro e passa por validação Zod.
- JSON inválido falha somente o item atual e não interrompe os demais.
- Conteúdo do anúncio é delimitado como dado não confiável para reduzir prompt injection.
- A Fase 1 somente sugere mudanças; nunca publica na Shopee.

## Testes e validação

```bash
cd backend
npm test

RUN_LOCAL_INTEGRATION=1 node --test test/api.integration.test.js
RUN_FULL_MOCK_E2E=1 node --test test/full-flow.mock.integration.test.js

cd ../frontend
npm run build
```

O E2E simulado percorre OAuth, criptografia, sync, auditoria, persistência e leitura sem usar credenciais reais. O teste integrado local cria dados temporários e os remove ao terminar.

### Advisory conhecido do React Router

`react-router-dom@7.18.2` mantém o advisory de RSC Mode CSRF Bypass. Este frontend é um SPA Vite e não usa RSC. Não execute `npm audit fix --force`: atualmente ele sugere downgrade para `7.11.0`, uma mudança quebrável com um conjunto de advisories pior. Reavaliar quando houver versão corrigida fora da faixa afetada.

## Fora do escopo atual

- Escrita ou aplicação automática de sugestões na Shopee.
- Geração e publicação de imagens.
- Billing, planos ou limites comerciais.
- Auditoria de concorrentes.

A Fase 2 só deve começar depois que esta fase for validada em produção por alguns dias.
