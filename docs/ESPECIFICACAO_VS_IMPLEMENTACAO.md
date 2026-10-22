# Especificação × Implementação

*Onde o sistema construído difere dos dois documentos de referência (especificação de requisitos e contrato de API, ambos de 22/10/2026). Serve para decidir, item por item, se o documento é atualizado ou se o código volta atrás.*

**Regra de leitura:** divergência não é erro automaticamente. Há três casos — **evolução** (decidida e melhor), **dívida** (documento e código precisam se encontrar) e **contradição** (as fontes se contradizem entre si).

---

## 1. Resumo

| # | Tema | Especificação | Implementação | Tipo |
|---:|---|---|---|---|
| 1 | Nome do produto | MedFlow | **Flowcare** | Evolução (marca) |
| 2 | Frontend | React + Vite (SPA) | **Next.js 16 + React 19** (App Router) | Dívida (doc) |
| 3 | Banco | "SQlite" em RF-A7, RNF-1 e §14 | **PostgreSQL** + Prisma | Contradição + dívida |
| 4 | Editor de documentos | BlockNote (JSON de blocos) | `bodyTemplate` como texto; sem dependência BlockNote | Dívida |
| 5 | Papéis | `medico` / `recepcionista` | **ADMIN, ADMIN_PROFESSIONAL, PROFESSIONAL, RECEPTIONIST** | Evolução |
| 6 | Multi-clínica | "1 clínica por deploy"; `Clinic` singleton | **Organization + Membership + convites + alternância** | Evolução |
| 7 | Sessão | "JWT sem expiração" | Sessão com TTL (12h) + revogação + auditoria | Evolução |
| 8 | E-mail | "não haverá e-mail no MVP" | SES: verificação de conta, recuperação, convites | Evolução |
| 9 | Arquivos | "volume local, nada de S3" | **S3/R2** privado + URL assinada | Evolução |
| 10 | Documento clínico | Emitir e arquivar (snapshot) | + versionamento, **retificação e anulação com justificativa** | Evolução |
| 11 | Receita de controlados | RF-C4 = Must | Fora do MVP (#281) | Dívida |
| 12 | Cobrança | Fora do MVP; só medição | Modelo `Subscription` existe, sem gateway | Consistente (parcial) |
| 13 | Integração Sintesy | `POST /sintesy/assistant/transcribe/` (síncrono, multipart) | **`/b2b/v1/jobs/` assíncrono** + `Idempotency-Key` + polling | Evolução |
| 14 | Envio do áudio ao Sintesy | Upload multipart do backend | **URL assinada** do storage privado | Evolução |
| 15 | Dinheiro | "string decimal, nunca float" (§1) × "Int centavos" (§14) | `Int` centavos | Contradição (na fonte) |
| 16 | Concorrência | Trava de slot no banco | Trava de slot **+** `version` otimista em recursos mutáveis | Evolução |

---

## 2. Detalhe

### 2.1 Frontend: Next.js, não Vite

A especificação registra a mudança "Next.js → React (Vite SPA)" justificando que o app é interno e não precisa de SSR. O repositório usa **Next.js 16 com App Router** (`apps/web/package.json`), com Server Actions e rotas por `orgSlug`.

**Impacto:** o documento de especificação descreve uma stack que não é a real. A justificativa de "não precisamos de SSR" continua válida como princípio, mas o ganho que motivou a escolha (build mais simples) não se materializou.
**Ação:** atualizar a tabela de stack da especificação para "Next.js (App Router) + React" e registrar o motivo real (roteamento por clínica, Server Actions, deploy único).

### 2.2 Banco: PostgreSQL (a especificação se contradiz)

A especificação diz "SQlite" em RF-A7, RNF-1 e §14 ("1 clínica por deploy … `Clinic`"). O próprio contrato, no §14, exige recursos que **não existem em SQLite**: `CREATE EXTENSION unaccent`, `pg_trgm` com índice GIN, `EXCLUDE USING gist` com `tstzrange` e índice único parcial.

O código usa **PostgreSQL** (`provider = "postgresql"` em `apps/api/prisma/schema.prisma`).

**Conclusão:** o SQLite era resquício de uma versão anterior do texto; a decisão real sempre foi Postgres. É contradição na fonte, não escolha em aberto.

### 2.3 Editor de documentos: sem BlockNote

A especificação desenha o editor como BlockNote, com JSON de blocos persistido e render BlockNote → HTML → PDF. No código, `DocumentTemplate.bodyTemplate` é `String` e não há dependência de BlockNote no front nem no back; o PDF é renderizado pelo serviço `document-pdf` a partir do conteúdo textual.

**Impacto:** os requisitos C1/C2/C9 ficam **parcialmente** atendidos — existe modelo, preview e snapshot, mas não o editor visual de blocos com chips arrastáveis.
**Ação:** decidir explicitamente: (a) adotar BlockNote; (b) manter texto e reescrever C1/C2 para "editor assistido com catálogo de campos". Hoje o documento promete mais do que o produto entrega.

### 2.4 Papéis: quatro, com capacidade clínica no ADMIN

A especificação tinha dois papéis. O sistema tem quatro (`MembershipRole`), com histórico de decisão registrado em `RBAC_MVP.md`: em 22/10/2026 o `ADMIN` passou a acumular as capacidades clínicas, porque o criador da clínica nascia sem acesso ao próprio prontuário — e o menu escondia Consultas e Documentos.

**Impacto:** a matriz de permissões da especificação (§2.1) está obsoleta. A matriz válida é a de `RBAC_MVP.md`.
**Ação:** substituir a seção 2 da especificação por uma referência ao `RBAC_MVP.md`.

### 2.5 Multi-clínica: a maior evolução em relação ao documento

A especificação assume **uma clínica por deploy** (`Clinic` singleton, sem tenant). O sistema tem `Organization` + `Membership` + `OrganizationInvite` + `OnboardingProgress` + alternância de contexto por `orgSlug`, e o plano de testes trata **isolamento multi-tenant** como invariante obrigatório.

**Impacto:** é a mudança de maior alcance — afeta autorização, URLs, armazenamento, auditoria e todos os contratos. O backlog tem 28 issues só nessa área.
**Ação:** a especificação precisa de uma seção de multi-tenancy; hoje ela descreve um produto diferente do construído.

### 2.6 Sessão: TTL e revogação no lugar de "JWT sem expiração"

A especificação decidiu "JWT sem expiração" por simplicidade de consultório. O código usa token com TTL (padrão de 12h em `app.ts`), `Session`, `tokenVersion`, `SessionRevocationAudit` e revogação de sessões comprometidas.

**Impacto:** melhor postura de segurança; pior ergonomia (o profissional pode precisar relogar no meio do dia).
**Ação:** documentar o TTL real e avaliar "lembrar este dispositivo" em vez de voltar ao token eterno.

### 2.7 Arquivos em nuvem, não em volume local

Especificação: "arquivos ficam em volume local (path), servidos por stream — nada de S3 no MVP". Código: `@aws-sdk/client-s3`, variáveis `STORAGE_*`, `StorageObject` e documentação em `docs/infra/STORAGE_R2.md`.

**Impacto:** viabiliza múltiplas instâncias e backup fora do servidor; cria dependência de provedor e custo de egress.
**Ação:** atualizar §14 da especificação (modelo de dados) — hoje ela contradiz o código em três pontos.

### 2.8 Documentos: ciclo de vida maior que o previsto

A especificação previa emitir, arquivar e nunca alterar. O sistema tem `DocumentVersion`, `DocumentTemplateVersion`, retificação, **anulação com justificativa obrigatória** e trilha de auditoria — e o QA valida esse ciclo (#283, #285, #286).

**Impacto:** escopo clínico mais realista (erro médico acontece e precisa de anulação rastreável), mas RF-C10 ("imutabilidade") precisa ser lido como "imutável por versão", não "sem correção".

### 2.9 Receita de controlados saiu do MVP

A especificação marca RF-C4 como Must. O backlog registra "Pós-MVP: escolher modelo de receita controlada" (#281) e não há tipo de documento de controlados no código.

**Impacto:** é o único requisito **Must** declarado na especificação que ficou de fora. Para a banca (AV2), isso precisa estar justificado no registro de mudanças pós-AV1 — como a especificação já exige para toda mudança.

### 2.10 Integração Sintesy: contrato assíncrono por jobs

O contrato descrevia `POST /sintesy/assistant/transcribe/` síncrono, multipart, com `{transcription}` na resposta. O código fala com **`/b2b/v1/jobs/`**: cria job com `externalId`, recebe `sourceUrl` (URL assinada do áudio no storage), envia `Idempotency-Key` e faz polling até `completed`/`failed`.

**Impacto:** a transcrição de 10–15 min de consulta não cabe numa resposta síncrona — o desenho assíncrono é o correto. O áudio continua sem passar pelo navegador (o backend gera a URL assinada).
**Ação:** atualizar o mapa técnico (§5.2 da especificação) e o ADR-002, que ainda descrevem o endpoint síncrono.

### 2.11 Money e envelope: a fonte se contradiz

O contrato diz "valores monetários: string decimal com 2 casas, nunca float" (§1) e, no mesmo documento, "dinheiro em centavos (Int), nunca Float" (§14). O código usa `Int` de centavos (`priceCents`, `costCents`).

**Ação:** corrigir o §1 do contrato — hoje um integrador que leia só a primeira seção implementa o tipo errado.

---

## 3. O que a especificação acerta e não pode regredir

Estes pontos são a razão de o produto existir; se a documentação for reescrita, eles precisam sobreviver:

1. **IA redatora, nunca diagnóstica** — proibição explícita no prompt e validação de saída (RF-D6).
2. **Descarte do áudio** após a transcrição (RF-D12) — é o argumento de LGPD do produto.
3. **Trava de sobreposição no banco**, não na aplicação (RF-A7).
4. **Snapshot do documento emitido** — editar modelo não altera documento (RF-C10).
5. **Nenhuma sintaxe técnica** visível ao profissional (RNF-10).
6. **Medir sem bloquear** o uso da transcrição no MVP (RF-D10/§5.5).
7. **Mensagem ambígua nunca fica em estado indefinido** — vai para a fila manual (§3.1).
8. **PDF fiel ao preview** (RNF-11).

---

## 4. Ações sugeridas

| Prioridade | Ação | Dono sugerido |
|---|---|---|
| Alta | Atualizar stack (Next.js), banco (Postgres) e modelo de dados (§14) na especificação | Produto |
| Alta | Reescrever §2 (papéis) e adicionar seção de multi-tenancy | Produto |
| Alta | Atualizar mapa técnico da integração Sintesy (§5.2) e ADR-002 para o contrato de jobs | Backend |
| Alta | Justificar formalmente a saída da receita de controlados (RF-C4) no relatório pós-AV1 | Produto |
| Média | Decidir BlockNote × editor assistido e ajustar C1/C2/C9 | Produto + Frontend |
| Média | Corrigir o tipo de valor monetário no §1 do contrato | Backend |
| Média | Documentar o TTL de sessão real e avaliar "lembrar dispositivo" | Backend |
| Baixa | Renomear referências remanescentes a "MedFlow" nos documentos | Todos |
