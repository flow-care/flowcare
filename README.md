# Flowcare

Monorepo do Flowcare com API Elysia/Bun em `apps/api` e frontend Next.js em `apps/web`.

## Estrutura

```text
apps/
  api/   API, testes e Dockerfile
  web/   interface Next.js e Dockerfile
docker/  inicialização do Postgres local
infra/   deploy e monitoramento
stacks/  stack de produção
docs/    contratos, decisões e operação
```

## Desenvolvimento local

Requer Bun e Docker. Instale as dependências do workspace na raiz:

```bash
bun install --frozen-lockfile
bun run db:dev
bun run dev
```

Antes de iniciar, crie `apps/api/.env` com `JWT_SECRET` e `DATABASE_URL` apontando para o Postgres local; veja [SECRETS.md](docs/infra/SECRETS.md). `bun run dev` inicia API em `http://localhost:3001/api/health` e web em `http://localhost:3000`. Também é possível executá-las separadamente com `bun run dev:api` e `bun run dev:web`.

## Validação

```bash
bun run lint
bun run typecheck
bun run test
bun run build
```

`build` gera `apps/api/dist` e `apps/web/.next`. Os Dockerfiles de cada aplicação continuam com contextos separados para manter apenas suas dependências no build. O código de servidor não é importado pela web.

Consulte [`docs/README.md`](docs/README.md) para o mapa completo da documentação e, a partir dele, [PROJETO_VISAO_GERAL.md](docs/PROJETO_VISAO_GERAL.md) (visão de produto e arquitetura), [API_CONTRACT.md](docs/API_CONTRACT.md) para o contrato HTTP, [BACKLOG.md](docs/BACKLOG.md) para as tarefas por área, [TEST_PLAN_AND_TRACEABILITY.md](docs/TEST_PLAN_AND_TRACEABILITY.md) para a estratégia de testes e [DEPLOY.md](docs/infra/DEPLOY.md) para produção. O trabalho de preparação do monorepo é acompanhado na [issue #200](https://github.com/Flowcare-team/flowcare-monorepo/issues/200).
