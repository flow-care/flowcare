# Flowcare — Contrato da API

**Status:** Contrato de planejamento vNext (implementação parcial)
**Backlog:** [Flowcare - Delivery](https://github.com/orgs/Flowcare-team/projects/2)
**Fontes:** Issues [#191](https://github.com/Flowcare-team/flowcare-monorepo/issues/191)–[#199](https://github.com/Flowcare-team/flowcare-monorepo/issues/199) e tarefas do board
**Base URL:** `https://<environment>/api`

Este documento é a fonte de verdade para o contrato HTTP entre a API (`apps/api`) e seus consumidores (`apps/web`, integrações). Schemas Elysia/TypeBox e a documentação OpenAPI gerada devem seguir estas especificações estritamente.

---

## 1. Regras Globais e Padrões Arquiteturais

| Tópico | Regra |
|---|---|
| **Formato e Codificação** | JSON UTF-8 e nomenclatura `camelCase`. Uploads de arquivos utilizam `multipart/form-data` ou fluxo de presigned URLs privadas. |
| **Identificadores** | Strings opacas imutáveis (UUID v4 / CUID2). |
| **Datas e Horários** | Formato ISO 8601 em UTC (`YYYY-MM-DDTHH:mm:ss.sssZ`). Agregações de calendário utilizam o fuso horário configurado na clínica. |
| **Paginação** | Orientada a cursor: `?cursor=<string>&limit=20` (máximo 100). Respostas paginadas retornam `{ data: [...], pageInfo: { nextCursor: string | null, hasNextPage: boolean } }`. |
| **Escopo Organizacional (Multi-tenancy)** | Rotas relativas à organização exigem o parâmetro de caminho `/organizations/:orgSlug/...`. O servidor resolve o escopo e valida a pertinência do `Membership` ativo antes de executar a ação. |
| **Isolamento entre Organizações** | O `organizationId` é obrigatoriamente injetado em todas as queries no servidor a partir da sessão/membership. Parâmetros passados pelo cliente jamais autorizam acesso a recursos de outro tenant. |
| **Controle de Concorrência** | Recursos mutáveis expõem o atributo inteiro `version`. Atualizações desatualizadas retornam erro `409 VERSION_CONFLICT`. |
| **Idempotência** | Operações de criação e mutação crítica exigem o cabeçalho HTTP `Idempotency-Key`. Reenvios com a mesma chave retornam o resultado original sem duplicar trabalho ou dados. |
| **Privacidade e Redação** | CPF, telefones, tokens, áudios, transcrições e dados clínicos sensíveis jamais aparecem em URLs, parâmetros de consulta (query string) ou logs abertos. |
| **Tipagem e Contrato** | Os tipos de entrada e saída são derivados estritamente dos schemas Elysia/TypeBox e OpenAPI gerados. |

> [!NOTE]
> **Decisão #192 para o MVP:** A API usa `Authorization: Bearer <JWT>`. O JWT expira em 12 horas e exige uma `Session` ativa no banco. O Next.js guarda o token em cookie `HttpOnly`, `SameSite=Lax` e `Secure` em produção. Não há renovação automática; depois de 12 horas a pessoa faz login novamente. Logout da API e revogação manual ainda estão pendentes.

### Contexto Organizacional Ativo

* A sessão autentica a pessoa globalmente e não concede, por si só, acesso a nenhuma organização.
* A URL é a fonte canônica do contexto ativo no frontend e na API: `/app/:orgSlug/...` no Next.js e `/organizations/:orgSlug/...` no Elysia.
* `orgSlug` é um identificador público de roteamento, não um segredo nem uma credencial. O backend nunca o aceita como prova de autorização.
* Rotas organizacionais não aceitam `organizationId` nem um slug alternativo no payload para selecionar o tenant. Cabeçalhos como `X-Org-Slug` e claims de organização no token não substituem o parâmetro de caminho nem a validação do vínculo.
* Para cada requisição organizacional, o backend autentica a sessão, resolve o slug, valida o `Membership` e somente então disponibiliza o `organizationId` tipado para a rota.
* Toda consulta ou mutação de dados clínicos, cadastrais, financeiros, operacionais e de auditoria inclui o `organizationId` resolvido pelo servidor. IDs recebidos do cliente são apenas identificadores de recursos dentro desse escopo.

---

## 2. Envelope Padronizado de Resposta e Erros

Em caso de falha (códigos HTTP 4xx e 5xx), a API responde com a seguinte estrutura:

```json
{
  "error": {
    "code": "PERMISSION_DENIED",
    "message": "Você não possui permissão para realizar esta ação.",
    "details": {
      "requiredPermission": "patients:read"
    },
    "requestId": "req_8f9a2b1c"
  }
}
```

### Matriz de Códigos HTTP e Códigos Estáveis

| HTTP | Código Estável | Descrição / Aplicação |
|---|---|---|
| **400** | `VALIDATION_ERROR` | Parâmetros de requisição inválidos ou fora do schema. |
| **400** | `INVALID_TOKEN` | Token de verificação de e-mail ou redefinição de senha inválido/expirado. |
| **401** | `UNAUTHENTICATED` | Credenciais ausentes, inválidas ou sessão encerrada. |
| **401** | `ACCOUNT_NOT_VERIFIED` | Tentativa de login ou uso da API antes da confirmação do e-mail. |
| **403** | `PERMISSION_DENIED` | Usuário autenticado sem a permissão necessária no RBAC. |
| **403** | `MEMBERSHIP_INACTIVE` | Vínculo com a organização está suspenso ou ainda não foi ativado (`INVITED`). |
| **404** | `NOT_FOUND` | Recurso não encontrado (usado também para ocultar existência de recursos de outros tenants). |
| **409** | `VERSION_CONFLICT` | Concorrência otimista violada (o recurso foi modificado por outro usuário). |
| **409** | `IDEMPOTENCY_CONFLICT` | A chave de idempotência está em uso por uma requisição concorrente ainda em processamento. |
| **409** | `ALREADY_EXISTS` | Conflito de duplicidade de chave única (ex: e-mail já cadastrado, slug já utilizado). |
| **409** | `SLOT_CONFLICT` | Horário de agendamento já reservado por outro paciente. |
| **409** | `LAST_ADMIN_REQUIRED` | Tentativa de remover ou rebaixar o último administrador da organização. |
| **409** | `MESSAGE_STATE_CONFLICT` | Tentativa de reenviar mensagem fora do estado permitido. |
| **409** | `DOCUMENT_STATE_CONFLICT` | Tentativa de editar, emitir ou anular documento fora do estado permitido. |
| **410** | `INVITE_EXPIRED` | O convite para a equipe expirou ou foi revogado. |
| **422** | `BUSINESS_RULE_VIOLATION` | Violação de regra de negócio com estado válido (ex: campos clínicos obrigatórios ausentes para emissão). |
| **429** | `RATE_LIMITED` | Limite de requisições excedido. |
| **500** | `INTERNAL` | Erro interno do servidor. Não exibe stack traces nem detalhes de infraestrutura em produção. |

---

## 3. Especificação dos Módulos da API

---

### Módulo 1: Autenticação & Sessões
*(Ref: Issues [#192](https://github.com/Flowcare-team/flowcare-monorepo/issues/192), [#207](https://github.com/Flowcare-team/flowcare-monorepo/issues/207), [#208](https://github.com/Flowcare-team/flowcare-monorepo/issues/208), [#209](https://github.com/Flowcare-team/flowcare-monorepo/issues/209))*

**Implementado:** JWT com `sid`/`sub` e sessão persistida, TTL de 12 horas sem renovação automática; verificação de e-mail em 24 horas, reset em 30 minutos e até 3 emissões de token de verificação por conta a cada hora (incluindo o token inicial). Senhas usam Argon2id e aceitam 8 a 72 caracteres. Tokens enviados por e-mail são de uso único e persistidos somente como SHA-256. Proteção por IP, uniformização de latência e invalidação de tokens anteriores ao reenvio estão na [#356](https://github.com/flow-care/flowcare/issues/356).

#### `POST /auth/register`
* **Descrição:** Cria uma nova conta pessoal e dispara e-mail de verificação.
* **Permissão:** Pública.
* **Body:**
  ```json
  {
    "fullName": "Dra. Maria Silva",
    "email": "maria.silva@exemplo.com",
    "password": "<senha_segura>"
  }
  ```
* **Respostas:** `201 Created` (`{ "message": "Conta criada com sucesso. Verifique seu e-mail para continuar." }`), `400 VALIDATION_ERROR`. E-mails já cadastrados recebem a mesma resposta; contas já verificadas não recebem outro link.

#### `POST /auth/verify-email`
* **Descrição:** Confirma o endereço de e-mail com o token recebido.
* **Permissão:** Pública.
* **Body:** `{ "token": "<token_verificacao>" }`
* **Respostas:** `200 OK` com o mesmo DTO de sessão de `POST /auth/login` (`token`, `user`, `availableOrganizations`, `onboardingCompleted`), `400 INVALID_TOKEN`. O token de verificação é consumido uma única vez; o frontend guarda a sessão em cookie HttpOnly e segue para o onboarding ou clínica disponível.

#### `POST /auth/resend-verification`
* **Descrição:** Solicita outro link de confirmação para uma conta ainda pendente. A resposta é igual para e-mail inexistente, já confirmado ou temporariamente limitado, para não revelar o estado da conta.
* **Permissão:** Pública.
* **Body:** `{ "email": "maria.silva@exemplo.com" }`
* **Respostas:** `200 OK` (`{ "message": "Se a conta estiver pendente, um novo link será enviado." }`), `400 VALIDATION_ERROR`.

#### `POST /auth/login`
* **Descrição:** Autentica com e-mail e senha e inicia a sessão do usuário.
* **Permissão:** Pública.
* **Body:** `{ "email": "maria.silva@exemplo.com", "password": "<senha_segura>" }`
* **Respostas:** `200 OK` (`{ "user": { "id": "usr_1", "email": "...", "fullName": "..." }, "availableOrganizations": [ { "id", "name", "slug", "role", "isOwner" } ], "token": "...", "onboardingCompleted": false, "onboardingCurrentStep": "PROFILE_SETUP" }`), `401 INVALID_CREDENTIALS`, `401 ACCOUNT_NOT_VERIFIED`.

> `isOwner` = `true` quando a clínica foi criada pelo próprio usuário (ele é o pagador da assinatura); membros convidados recebem `isOwner: false` e não pagam.

#### `POST /auth/forgot-password`
* **Descrição:** Solicita redefinição de senha. Retorna resposta indistinguível para evitar enumeração de contas.
* **Permissão:** Pública.
* **Body:** `{ "email": "maria.silva@exemplo.com" }`
* **Respostas:** `200 OK` (`{ "message": "Se o e-mail estiver cadastrado, as instruções serão enviadas." }`).

#### `POST /auth/reset-password`
* **Descrição:** Redefine a senha utilizando o token e encerra todas as sessões anteriores por segurança.
* **Permissão:** Pública.
* **Body:** `{ "token": "<token_redefinicao>", "newPassword": "<nova_senha>" }`
* **Respostas:** `200 OK` (`{ "message": "Senha alterada com sucesso. Todas as sessões anteriores foram encerradas." }`), `400 INVALID_TOKEN`.

#### `POST /auth/logout`
* **Descrição:** Encerra a sessão ativa do usuário.
* **Permissão:** Autenticado.
* **Respostas:** `200 OK` (`{ "message": "Sessão encerrada." }`).
* **Estado:** Planejado; ainda não implementado na API.

---

### Módulo 2: Onboarding & Primeira Clínica
*(Ref: Issues [#193](https://github.com/Flowcare-team/flowcare-monorepo/issues/193), [#215](https://github.com/Flowcare-team/flowcare-monorepo/issues/215)–[#218](https://github.com/Flowcare-team/flowcare-monorepo/issues/218))*

**Decisão #193 para o MVP:** Depois de confirmar o e-mail, quem cria uma clínica precisa informar apenas os dados mínimos da clínica para entrar no dashboard. Nome pessoal já vem do cadastro; telefone, título profissional e registro profissional são opcionais ou exigidos somente para a função clínica correspondente. Horários e convites podem ser configurados depois. Quem entra por convite confirma o e-mail, autentica-se com a conta do endereço convidado e aceita o convite; não cria clínica. Convites expiram após 7 dias, têm uso único, podem ser revogados e o reenvio substitui o token anterior. As rotas implementadas são `/onboarding/progress` e `/onboarding/organization`; `/onboarding/status` e `/onboarding/clinic` não foram adotadas. Perfil complementar, horários, conclusão e convites seguem planejados.

#### `GET /onboarding/progress`
* **Descrição:** Recupera o estado atual do assistente de primeiro acesso.
* **Permissão:** Autenticado.
* **Respostas:** `200 OK` (`{ "currentStep": "PROFILE_SETUP" | "ORGANIZATION_SETUP" | string, "completed": false, "draftData": { ... }, "version": 0 }`). Contas sem perfil concluído recebem `PROFILE_SETUP`. A conclusão é calculada pela última etapa registrada; quando uma nova etapa obrigatória é adicionada após a última concluída, contas existentes passam a receber essa etapa como pendente. Consulte `docs/ONBOARDING_STEPS.md`.

#### `GET /onboarding/profile`
* **Descrição:** Carrega o perfil da própria conta para o primeiro acesso, sem depender de clínica ativa.
* **Permissão:** Autenticado.
* **Resposta:** `200 OK` com `fullName`, `phone`, `professionalRole`, `professionalTitle`, `registrationNumber` e `completed`. Campos ainda não preenchidos são `null`.

#### `PATCH /onboarding/profile`
* **Descrição:** Salva um rascunho do perfil em `OnboardingProgress.draftData.profile` sem concluir a etapa. Os valores são restaurados por `GET /onboarding/profile` após recarregar.
* **Permissão:** Autenticado.
* **Body:** Mesmos campos de `POST /onboarding/profile`, aceitando valores vazios; os limites de tamanho e o papel profissional continuam validados.
* **Resposta:** `200 OK` com o DTO de `GET /onboarding/profile` e `completed: false`; `409 STEP_ALREADY_COMPLETED` se a etapa já foi concluída.

#### `POST /onboarding/profile`
* **Descrição:** Salva o perfil pessoal e avança o progresso para `ORGANIZATION_SETUP` numa transação. Repetir a operação atualiza a mesma conta e não cria outro progresso.
* **Permissão:** Autenticado.
* **Body:** `{ "fullName": "Ana Oliveira", "phone": "85999990000", "professionalRole": "CLINICAL", "professionalTitle": "Médica Cardiologista", "registrationNumber": "CRM/CE 123456" }`. `professionalRole` aceita `MANAGEMENT`, `CLINICAL` ou `RECEPTION`; título e registro são obrigatórios apenas para `CLINICAL`.
* **Respostas:** `200 OK` com o DTO de `GET /onboarding/profile`, `400 VALIDATION_ERROR`, `409 STEP_ALREADY_COMPLETED` se a etapa já foi concluída.

#### `POST /onboarding/organization`
* **Descrição:** Cria a primeira clínica do usuário e o vincula como administrador. Cria também a assinatura da clínica (R$ 89/mês, status `PENDING_PAYMENT` até o fluxo de cobrança ativar). Clínica, vínculo e assinatura nascem na mesma transação — falha em qualquer parte não deixa clínica órfã.
* **Permissão:** Autenticado.
* **Cabeçalho Obrigatório:** `Idempotency-Key`
* **Body:**
  ```json
  {
    "name": "Clínica Vida & Saúde",
    "slug": "vida-e-saude",
    "phone": "(11) 98765-4321",
    "address": {
      "street": "Av. Paulista",
      "number": "1000",
      "city": "São Paulo",
      "state": "SP",
      "zipCode": "01310-100"
    }
  }
  ```
  `slug` é opcional: ausente, é derivado do `name` (normalizado). Os dados institucionais e o endereço são salvos na etapa #222.
* **Respostas:** `201 Created` (`{ "organization": { "id": "org_1", "name": "...", "slug": "vida-e-saude", "role": "ADMIN", "isOwner": true } }`), `409 ALREADY_EXISTS`.
* **Estado:** Implementado para `name` e `slug`. `phone`, `address` e `Idempotency-Key` ainda não são processados; ver #217 e #303.

#### `POST /onboarding/schedule-rules`
* **Descrição:** Configura opcionalmente os dias e horários padrão de atendimento da clínica durante o onboarding ou depois dele.
* **Permissão:** Autenticado (Administrador).
* **Body:**
  ```json
  {
    "weeklySchedule": [
      { "dayOfWeek": "MONDAY", "startTime": "08:00", "endTime": "18:00", "slotDurationMinutes": 30 }
    ]
  }
  ```
* **Respostas:** `200 OK`.

#### `POST /onboarding/complete`
* **Descrição:** Finaliza a jornada de onboarding após confirmação de e-mail e criação da clínica. Perfil complementar, horários e convites não bloqueiam a conclusão.
* **Permissão:** Autenticado.
* **Respostas:** `200 OK` (`{ "redirectUrl": "/app/vida-e-saude/dashboard" }`).

---

### Módulo 3: Organizações & Alternância de Contexto
*(Ref: Issues [#191](https://github.com/Flowcare-team/flowcare-monorepo/issues/191), [#227](https://github.com/Flowcare-team/flowcare-monorepo/issues/227), [#228](https://github.com/Flowcare-team/flowcare-monorepo/issues/228))*

> [!NOTE]
> A issue #191 cita um arquivo `PRODUCT_SCOPE.md`, mas esse arquivo não existe no estado atual nem no histórico disponível do repositório. Até que uma fonte substituta seja indicada, a lista de módulos e rotas desta seção é o inventário canônico para validar a cobertura multi-tenant.

#### `GET /organizations`
* **Descrição:** Lista somente as clínicas nas quais a pessoa possui `Membership` ativo. Vínculos suspensos ou ainda `INVITED` não autorizam acesso e não aparecem na seleção.
* **Permissão:** Autenticado.
* **Respostas:** `200 OK` (`{ "data": [ { "id": "org_1", "name": "...", "slug": "vida-e-saude", "role": "ADMIN", "status": "ACTIVE" } ] }`), `401 UNAUTHENTICATED`. A lista retorna no máximo 100 vínculos ativos, em ordem de criação; uma conta sem vínculos recebe `data: []`.

#### `GET /organizations/:orgSlug`
* **Descrição:** Obtém os dados e preferências da clínica especificada pelo slug.
* **Permissão:** Autenticado + Pertencer à clínica (`organizations:read`).
* **Respostas:** `200 OK`, `401 UNAUTHENTICATED`, `403 MEMBERSHIP_INACTIVE`, `403 PERMISSION_DENIED`, `404 NOT_FOUND`.

#### `GET /organizations/:orgSlug/onboarding-details`
* **Descrição:** Carrega dados legais, contato, endereço, versão e estado de conclusão da clínica para a etapa #222.
* **Permissão:** `Membership` ativo com papel `ADMIN` na clínica indicada pelo slug.
* **Respostas:** `200 OK` com `name`, `slug`, `version`, `completed`, `legalName`, `taxId`, `contactEmail`, `contactPhone`, `postalCode`, `state`, `city`, `district`, `street`, `streetNumber` e `addressComplement`; `404 NOT_FOUND` para vínculo inexistente ou sem permissão.

#### `PUT /organizations/:orgSlug/onboarding-details`
* **Descrição:** Salva os dados institucionais e conclui `CLINIC_DETAILS` no progresso do onboarding. `version` deve corresponder à versão carregada; cada atualização a incrementa para impedir perda de alterações simultâneas.
* **Body:** Os campos do GET, exceto `name`, `slug` e `completed`. `legalName`, e-mail, telefone e endereço são obrigatórios; `taxId` e complemento podem ficar vazios. `postalCode` contém oito dígitos e `state` contém a sigla de duas letras.
* **Respostas:** `200 OK` com os dados atualizados, `400 VALIDATION_ERROR`, `404 NOT_FOUND`, `409 CONFLICT` quando outra sessão já salvou uma versão mais recente.

#### `POST /organizations/:orgSlug/switch-context`
* **Descrição:** Valida a seleção feita no frontend e pode registrar a última clínica escolhida como preferência de navegação. A URL continua sendo a fonte canônica do contexto e a preferência nunca autoriza acesso.
* **Permissão:** Autenticado + Pertencer à clínica.
* **Entrada:** Sem `organizationId` ou slug no corpo; a organização é indicada exclusivamente por `:orgSlug`.
* **Respostas:** `200 OK` (`{ "activeOrganization": { "id": "org_1", "slug": "vida-e-saude" } }`), `401 UNAUTHENTICATED`, `403 MEMBERSHIP_INACTIVE`, `404 NOT_FOUND`.

#### Resolução e autorização do contexto no Elysia

As rotas organizacionais usam um plugin reutilizável, registrado antes dos módulos protegidos. Na versão 1.x do Elysia adotada pelo projeto, a resolução por requisição ocorre após a validação de `params`, por meio de `resolve` ou de uma macro que o encapsule, preservando a inferência de tipos.

O fluxo obrigatório é:

1. Validar a sessão global e obter o `userId`. Sessão ausente, expirada, revogada ou inválida encerra o fluxo com `401 UNAUTHENTICATED`.
2. Validar e normalizar `params.orgSlug` para letras minúsculas antes da consulta. Um slug sintaticamente inválido é tratado como não encontrado.
3. Buscar `Organization` pelo `slug` globalmente único. Se não existir, retornar `404 NOT_FOUND`.
4. Buscar `Membership` pela chave composta (`userId`, `organizationId`). Se não existir, retornar `404 NOT_FOUND` para não revelar a existência da clínica a terceiros.
5. Se o vínculo existir, mas estiver `SUSPENDED` ou `INVITED`, retornar `403 MEMBERSHIP_INACTIVE`.
6. Validar a permissão exigida pela rota. Ausência de permissão retorna `403 PERMISSION_DENIED`.
7. Disponibilizar para o handler, com tipos explícitos, no mínimo `organizationId`, `membershipId`, `role` e as permissões efetivas.
8. Executar services e queries sempre com o `organizationId` resolvido. O handler não pode substituí-lo por valores de `body`, `query`, cabeçalhos ou identificadores de recursos.

| Situação | HTTP | Código estável | Regra de exposição |
|---|---:|---|---|
| Sessão válida, organização existente, vínculo ativo e permissão suficiente | `200` | — | A operação pode usar o contexto injetado. |
| Sessão ausente ou inválida | `401` | `UNAUTHENTICATED` | Nenhuma resolução organizacional é realizada. |
| Vínculo conhecido, porém suspenso ou ainda convidado | `403` | `MEMBERSHIP_INACTIVE` | Informa o estado apenas à pessoa que possui o vínculo. |
| Vínculo ativo, mas sem a permissão exigida | `403` | `PERMISSION_DENIED` | Não executa a consulta de domínio protegida. |
| Slug inexistente ou organização sem vínculo com a pessoa | `404` | `NOT_FOUND` | Os dois casos são indistinguíveis para evitar enumeração de clínicas. |

#### Troca de clínica entre Next.js e Elysia

1. O Next.js carrega `GET /organizations` na tela `/select-organization` e apresenta apenas vínculos ativos.
2. Ao selecionar uma clínica, o frontend chama `POST /organizations/:orgSlug/switch-context` sem enviar `organizationId`.
3. Após `200 OK`, o frontend invalida dados e caches associados ao tenant anterior e navega para `/app/:orgSlug/...`.
4. A sessão global permanece ativa; ela não é recriada nem passa a carregar autorização permanente para a clínica escolhida.
5. Cada chamada subsequente usa o mesmo `orgSlug` na rota da API e o Elysia repete a validação do vínculo. As permissões efetivas são sempre as do `Membership` daquela organização.
6. Respostas `403` ou `404` durante a seleção ou navegação fazem o frontend limpar o estado organizacional em memória, redirecionar para `/select-organization` e apresentar uma mensagem de acesso indisponível sem revelar dados da clínica.

#### Casos conceituais de validação

| Caso | Resultado esperado |
|---|---|
| Pessoa com uma clínica e vínculo ativo | A listagem retorna uma organização; a seleção e as rotas dessa clínica respondem normalmente. |
| Pessoa com várias clínicas e vínculos ativos | A listagem retorna todas; cada troca revalida o vínculo e substitui permissões e caches do contexto anterior. |
| Pessoa autenticada sem clínica | `GET /organizations` retorna `200` com `data: []`; a interface permanece em `/select-organization`. |
| Slug inexistente | A rota organizacional retorna `404 NOT_FOUND`. |
| Slug de uma clínica de terceiro | A rota retorna o mesmo `404 NOT_FOUND`, sem confirmar que a clínica existe. |
| Vínculo suspenso ou ainda `INVITED` | A rota retorna `403 MEMBERSHIP_INACTIVE` e não injeta `organizationId`. |
| Tentativa de enviar outro `organizationId` no payload | O valor não participa da autorização e não altera o tenant resolvido pela URL; payload incompatível com o schema é rejeitado. |
| ID de recurso pertencente a outra clínica | A consulta filtrada pelo `organizationId` ativo não encontra o recurso e retorna `404 NOT_FOUND`. |

---

### Módulo 4: Equipe, Convites & Papéis Fixos
*(Ref: Issues [#194](https://github.com/Flowcare-team/flowcare-monorepo/issues/194), [#314](https://github.com/Flowcare-team/flowcare-monorepo/issues/314)–[#319](https://github.com/Flowcare-team/flowcare-monorepo/issues/319))*

**Decisão de produto do MVP:** a [matriz de papéis e capacidades](RBAC_MVP.md) define quatro papéis fixos: `ADMIN`, `ADMIN_PROFESSIONAL`, `PROFESSIONAL` e `RECEPTIONIST`. Papéis personalizados e `roles:manage` ficam fora do MVP. O schema atual ainda contém três papéis e precisa ser migrado antes de aplicar a matriz em produção. Habilitações específicas de ações clínicas exigem revisão por responsável clínico antes da ativação.

#### `GET /organizations/:orgSlug/members`
* **Descrição:** Lista os membros da equipe da clínica com seus respectivos papéis.
* **Permissão:** `team:read`.
* **Respostas:** `200 OK` (`{ "data": [ { "id": "mem_1", "userName": "Dra. Maria", "role": "ADMIN", "status": "ACTIVE" } ] }`).

#### `POST /organizations/:orgSlug/invites`
* **Descrição:** Envia convite por e-mail para integrar uma pessoa à equipe com um papel específico.
* **Permissão:** `team:invite`.
* **Cabeçalho Obrigatório:** `Idempotency-Key`
* **Body:** `{ "email": "recepcao@exemplo.com", "role": "RECEPTIONIST" }`
* **Respostas:** `201 Created` (`{ "invite": { "id": "inv_1", "email": "...", "expiresAt": "..." } }`), `409 ALREADY_EXISTS`.

#### `POST /invites/:token/accept`
* **Descrição:** Aceita um convite de equipe enviado por e-mail e cria o vínculo de Membership na clínica.
* **Permissão:** Autenticado, e-mail verificado e igual ao destinatário do convite.
* **Body:** `{ "token": "inv_token_999" }`
* **Respostas:** `200 OK` (`{ "organizationSlug": "vida-e-saude" }`), `410 INVITE_EXPIRED`.
* **Regras:** Convite válido por 7 dias, uso único e vinculado a e-mail, clínica e papel. Revogação ou reenvio invalidam o token anterior. Aceite repetido não cria outro vínculo.

#### `PATCH /organizations/:orgSlug/members/:memberId/role`
* **Descrição:** Altera o papel de um membro. Valida obrigatoriamente a proteção do último administrador.
* **Permissão:** `team:manage`.
* **Body:** `{ "role": "PROFESSIONAL", "version": 1 }`
* **Respostas:** `200 OK`, `409 LAST_ADMIN_REQUIRED`, `409 VERSION_CONFLICT`.

#### `DELETE /organizations/:orgSlug/members/:memberId`
* **Descrição:** Remove um membro da clínica, desativando seu vínculo e preservando a trilha de auditoria.
* **Permissão:** `team:manage`.
* **Respostas:** `200 OK`, `409 LAST_ADMIN_REQUIRED`.

#### `GET /organizations/:orgSlug/roles`
* **Descrição:** Lista os quatro papéis fixos com suas capacidades e a contagem de membros da clínica em cada papel.
* **Permissão:** `roles:read`.
* **Respostas:** `200 OK`.

> `POST` e `PATCH /organizations/:orgSlug/roles` não fazem parte do MVP; criação e edição de papéis personalizados foram adiadas.

---

### Módulo 5: Pacientes & Prontuário
*(Ref: Issues [#250](https://github.com/Flowcare-team/flowcare-monorepo/issues/250)–[#254](https://github.com/Flowcare-team/flowcare-monorepo/issues/254))*

#### `GET /organizations/:orgSlug/patients`
* **Descrição:** Consulta e filtra a lista de pacientes da clínica por nome, CPF ou telefone.
* **Permissão:** `patients:read`.
* **Query Params:** `?search=joao&cursor=xxx&limit=20`
* **Respostas:** `200 OK` (`{ "data": [...], "pageInfo": { ... } }`).

#### `POST /organizations/:orgSlug/patients`
* **Descrição:** Cadastra um novo paciente. Executa verificação prévia de duplicidade por CPF.
* **Permissão:** `patients:write`.
* **Cabeçalho Obrigatório:** `Idempotency-Key`
* **Body:** `{ "fullName": "João Souza", "cpf": "123.456.789-00", "birthDate": "1985-05-20", "phone": "(11) 97777-6666" }`
* **Respostas:** `201 Created`, `409 ALREADY_EXISTS`.

#### `PATCH /organizations/:orgSlug/patients/:patientId`
* **Descrição:** Atualiza os dados cadastrais do paciente com controle de concorrência.
* **Permissão:** `patients:write`.
* **Body:** `{ "phone": "(11) 98888-5555", "version": 2 }`
* **Respostas:** `200 OK`, `409 VERSION_CONFLICT`.

#### `GET /organizations/:orgSlug/patients/:patientId/timeline`
* **Descrição:** Retorna a linha do tempo cronológica com consultas, documentos emitidos e anexos do paciente.
* **Permissão:** `patients:read_history`.
* **Respostas:** `200 OK` (`{ "events": [ { "type": "CONSULTATION", "date": "...", "title": "Anamnese Cardiologia" } ] }`).

#### `POST /organizations/:orgSlug/patients/:patientId/attachments`
* **Descrição:** Upload de arquivo/exame privado para o prontuário do paciente.
* **Permissão:** `patients:attachments:write`.
* **Body:** `multipart/form-data` (`file`, `category`, `description`).
* **Respostas:** `201 Created` (`{ "attachmentId": "att_123", "fileName": "exame_sangue.pdf" }`), `413 FILE_TOO_LARGE`.

---

### Módulo 6: Agendamentos & Recepção
*(Ref: Issues [#237](https://github.com/Flowcare-team/flowcare-monorepo/issues/237)–[#241](https://github.com/Flowcare-team/flowcare-monorepo/issues/241))*

#### `GET /organizations/:orgSlug/appointments`
* **Descrição:** Lista os agendamentos da clínica filtrados por intervalo de datas, profissional ou status.
* **Permissão:** `appointments:read`.
* **Query Params:** `?startDate=2026-09-01&endDate=2026-09-30&doctorId=doc_1`
* **Respostas:** `200 OK`.

#### `POST /organizations/:orgSlug/appointments`
* **Descrição:** Reserva um horário na agenda para um paciente. Valida disponibilidade para prevenir overlapping.
* **Permissão:** `appointments:write`.
* **Cabeçalho Obrigatório:** `Idempotency-Key`
* **Body:** `{ "patientId": "pat_1", "doctorId": "doc_1", "scheduledAt": "2026-10-05T14:00:00Z", "notes": "Consulta de rotina" }`
* **Respostas:** `201 Created`, `409 SLOT_CONFLICT`.

#### `POST /organizations/:orgSlug/appointments/:appointmentId/cancel`
* **Descrição:** Cancela um agendamento. Exige justificativa motivada obrigatória.
* **Permissão:** `appointments:write`.
* **Body:** `{ "cancellationReason": "Paciente informou imprevisto de trabalho", "version": 1 }`
* **Respostas:** `200 OK` (`{ "status": "CANCELLED" }`), `422 BUSINESS_RULE_VIOLATION`.

#### `GET /organizations/:orgSlug/reception/queue`
* **Descrição:** Lista os pacientes na recepção aguardando atendimento no dia.
* **Permissão:** `reception:read`.
* **Respostas:** `200 OK` (`{ "queue": [ { "appointmentId": "app_1", "patientName": "...", "status": "WAITING" } ] }`).

#### `POST /organizations/:orgSlug/appointments/:appointmentId/reception-status`
* **Descrição:** Atualiza o fluxo da recepção (`ARRIVED`, `IN_SERVICE`, `COMPLETED`, `ABSENT`).
* **Permissão:** `reception:write`.
* **Body:** `{ "status": "ARRIVED", "version": 1 }`
* **Respostas:** `200 OK`.

---

### Módulo 7: Consultas Clínicas, Áudio & Anamnese
*(Ref: Issues [#195](https://github.com/Flowcare-team/flowcare-monorepo/issues/195), [#262](https://github.com/Flowcare-team/flowcare-monorepo/issues/262)–[#267](https://github.com/Flowcare-team/flowcare-monorepo/issues/267))*

#### `POST /organizations/:orgSlug/consultations`
* **Descrição:** Inicia uma nova consulta clínica vinculada a um agendamento prévio e paciente.
* **Permissão:** `consultations:write`.
* **Body:** `{ "appointmentId": "app_100", "patientId": "pat_1" }`
* **Respostas:** `201 Created` (`{ "consultationId": "con_55", "status": "IN_PROGRESS" }`).

#### `POST /organizations/:orgSlug/consultations/:consultationId/audio`
* **Descrição:** Envia o arquivo de áudio gravado da consulta após obtenção explícita do consentimento do paciente.
* **Permissão:** `consultations:write`.
* **Body:** `multipart/form-data` (`audioFile`, `consentConfirmed=true`).
* **Respostas:** `200 OK` (`{ "audioId": "aud_77", "status": "UPLOADED" }`), `422 BUSINESS_RULE_VIOLATION`.

#### `POST /organizations/:orgSlug/consultations/:consultationId/transcribe`
* **Descrição:** Dispara o processamento da transcrição e geração automática da minuta de anamnese por IA.
* **Permissão:** `consultations:write`.
* **Cabeçalho Obrigatório:** `Idempotency-Key`
* **Respostas:** `202 Accepted` (`{ "jobId": "job_tx_88", "status": "PROCESSING" }`).

#### `PATCH /organizations/:orgSlug/consultations/:consultationId/draft`
* **Descrição:** Salva edições no rascunho da anamnese médica com controle de versão.
* **Permissão:** `consultations:write`.
* **Body:** `{ "chiefComplaint": "Dor de cabeça persistente", "clinicalNotes": "...", "version": 3 }`
* **Respostas:** `200 OK`, `409 VERSION_CONFLICT`.

#### `POST /organizations/:orgSlug/consultations/:consultationId/approve`
* **Descrição:** Conclui e aprova a versão final da anamnese com registro formal de autoria médica.
* **Permissão:** `consultations:approve`.
* **Body:** `{ "version": 4 }`
* **Respostas:** `200 OK` (`{ "status": "APPROVED", "signedBy": "CRM/SP 123456", "approvedAt": "..." }`).

---

### Módulo 8: Documentos Clínicos, Versionamento & Anulação
*(Ref: Issues [#195](https://github.com/Flowcare-team/flowcare-monorepo/issues/195), [#273](https://github.com/Flowcare-team/flowcare-monorepo/issues/273)–[#278](https://github.com/Flowcare-team/flowcare-monorepo/issues/278))*

**Decisão do MVP:** ver [ciclo de vida e snapshot](DOCUMENTS_MVP.md). Receitas controladas e assinatura eletrônica não fazem parte do MVP. `ISSUED` indica PDF final para impressão e assinatura manuscrita, não documento eletrônico assinado. Todas as rotas deste módulo ainda são planejadas.

#### `GET /organizations/:orgSlug/documents`
* **Descrição:** Lista documentos da clínica com paginação e filtros, sem conteúdo clínico completo na listagem.
* **Permissão:** `documents:read`.

#### `GET /organizations/:orgSlug/documents/:documentId`
* **Descrição:** Consulta detalhe, estado e vínculo de versões de um documento.
* **Permissão:** `documents:read`.

#### `POST /organizations/:orgSlug/documents`
* **Descrição:** Cria rascunho de receita simples, atestado, pedido de exame ou laudo. Receita controlada e documento livre/personalizado são recusados no MVP.
* **Permissão:** `documents:write`.
* **Body:** `{ "patientId": "pat_1", "type": "PRESCRIPTION", "title": "Receita Simples", "content": "..." }`
* **Respostas:** `201 Created` (`{ "documentId": "doc_99", "status": "DRAFT", "version": 1 }`).

#### `PATCH /organizations/:orgSlug/documents/:documentId`
* **Descrição:** Edita o conteúdo de um documento **enquanto ele for RASCUNHO** (`DRAFT`).
* **Permissão:** `documents:write`.
* **Body:** `{ "content": "Novo texto...", "version": 1 }`
* **Respostas:** `200 OK`, `409 DOCUMENT_STATE_CONFLICT` (se não estiver em `DRAFT`), `409 VERSION_CONFLICT`.

#### `POST /organizations/:orgSlug/documents/:documentId/issue`
* **Descrição:** Finaliza o documento com snapshot imutável e PDF para impressão e assinatura manuscrita; não assina eletronicamente.
* **Permissão:** `documents:issue`.
* **Body:** `{ "version": 2 }`
* **Respostas:** `200 OK` (`{ "status": "ISSUED", "issuedAt": "...", "snapshotHash": "sha256_..." }`), `409 DOCUMENT_STATE_CONFLICT`, `422 BUSINESS_RULE_VIOLATION` (campos obrigatórios ausentes). Uma falha de PDF não conclui a emissão.

#### `POST /organizations/:orgSlug/documents/:documentId/rectify`
* **Descrição:** Cria novo rascunho vinculado a um documento `ISSUED`, preservando o original. A emissão do novo rascunho recebe a próxima versão da cadeia.
* **Permissão:** `documents:write`.
* **Respostas:** `201 Created` (`{ "documentId": "doc_100", "status": "DRAFT", "replacesDocumentId": "doc_99" }`), `409 DOCUMENT_STATE_CONFLICT`.

#### `GET /organizations/:orgSlug/documents/:documentId/pdf`
* **Descrição:** Após autorização, transmite o PDF privado gerado a partir do snapshot imutável, identificado como arquivo para impressão e assinatura manuscrita.
* **Permissão:** `documents:read`.
* **Respostas:** `200 OK` (`Content-Type: application/pdf`).

#### `POST /organizations/:orgSlug/documents/:documentId/void`
* **Descrição:** Anula formalmente um documento emitido. Exige justificativa motivada e mantém histórico de versões.
* **Permissão:** `documents:void`.
* **Body:** `{ "reason": "Erro na dosagem do medicamento prescrevido", "version": 3 }`
* **Respostas:** `200 OK` (`{ "status": "VOIDED", "voidedAt": "...", "voidReason": "..." }`), `409 DOCUMENT_STATE_CONFLICT`.

#### `GET /organizations/:orgSlug/documents/:documentId/versions`
* **Descrição:** Retorna a trilha de histórico de todas as alterações e snapshots do documento.
* **Permissão:** `documents:read`.
* **Respostas:** `200 OK` (`{ "versions": [ { "version": 1, "status": "DRAFT" }, { "version": 2, "status": "ISSUED" } ] }`).

#### `GET /organizations/:orgSlug/documents/:documentId/versions/:versionId`
* **Descrição:** Consulta um snapshot histórico imutável autorizado.
* **Permissão:** `documents:read`.

---

### Módulo 9: Modelos de Documentos
*(Ref: Issues [#287](https://github.com/Flowcare-team/flowcare-monorepo/issues/287)–[#290](https://github.com/Flowcare-team/flowcare-monorepo/issues/290))*

#### `GET /organizations/:orgSlug/document-templates`
* **Descrição:** Lista os modelos de receitas e atestados configurados na clínica.
* **Permissão:** `templates:read`.
* **Respostas:** `200 OK`.

#### `POST /organizations/:orgSlug/document-templates`
* **Descrição:** Cria um modelo de documento com campos dinâmicos (ex: `{paciente_nome}`).
* **Permissão:** `templates:write`.
* **Body:** `{ "title": "Atestado 3 Dias", "type": "CERTIFICATE", "bodyTemplate": "Atesto para os devidos fins que {paciente_nome}..." }`
* **Respostas:** `201 Created`.

#### `POST /organizations/:orgSlug/document-templates/:templateId/archive`
* **Descrição:** Arquiva um modelo sem afetar ou alterar os documentos emitidos no passado.
* **Permissão:** `templates:write`.
* **Respostas:** `200 OK` (`{ "archived": true }`).

---

### Módulo 10: Comunicações & Integração WhatsApp (WAHA)
*(Ref: Issues [#196](https://github.com/Flowcare-team/flowcare-monorepo/issues/196), [#295](https://github.com/Flowcare-team/flowcare-monorepo/issues/295)–[#298](https://github.com/Flowcare-team/flowcare-monorepo/issues/298))*

**Decisão do MVP:** ver [catálogo, consentimento e estados de mensagens](MESSAGING_MVP.md). Apenas confirmação de agendamento, cancelamento e lembrete 24 horas antes são enviados por WhatsApp, com opt-in ativo do paciente. Mensagens de autenticação e convite usam e-mail. As rotas abaixo ainda são planejadas.

#### `GET /organizations/:orgSlug/communications/whatsapp/status`
* **Descrição:** Consulta o status da sessão do WhatsApp (conectado, desconectado, QR code pendente).
* **Permissão:** `communications:read`.
* **Respostas:** `200 OK` (`{ "status": "CONNECTED", "phoneNumber": "5511999998888" }`).

#### `GET /organizations/:orgSlug/communications/messages`
* **Descrição:** Lista o histórico paginado de mensagens operacionais com filtros por estado e período; telefone mascarado.
* **Permissão:** `communications:read`.
* **Respostas:** `200 OK` (`{ "items": [{ "id": "msg_1", "type": "APPOINTMENT_REMINDER", "status": "QUEUED", "phoneMasked": "(11) 98765-****" }], "nextCursor": null }`). Estados: `QUEUED`, `SENT`, `DELIVERED`, `READ`, `FAILED`.

#### `PATCH /organizations/:orgSlug/patients/:patientId/communication-preferences`
* **Descrição:** Registra opt-in ou opt-out de WhatsApp informado pelo paciente, com origem, autor e horário auditáveis. Opt-out cancela disparos pendentes quando possível.
* **Permissão:** `patients:write`.
* **Body:** `{ "whatsappOptIn": false, "source": "PATIENT_REQUEST" }`.

#### `GET /organizations/:orgSlug/communications/whatsapp/templates`
* **Descrição:** Lista os textos de confirmação, cancelamento e lembrete, com variáveis permitidas.
* **Permissão:** `communications:read`.

#### `PUT /organizations/:orgSlug/communications/whatsapp/templates/:type`
* **Descrição:** Atualiza um texto operacional, recusando variáveis desconhecidas. O texto deve passar por revisão da clínica antes da ativação para impedir conteúdo clínico.
* **Permissão:** `communications:write`.

#### `POST /webhooks/whatsapp/status`
* **Descrição:** Recebe atualização de entrega do WAHA após validar segredo configurado; evento repetido é idempotente e atualização fora de ordem não regride o estado.
* **Permissão:** segredo do webhook, sem sessão de usuário.

#### `POST /organizations/:orgSlug/communications/messages/:messageId/resend`
* **Descrição:** Solicita reenvio apenas de mensagem `FAILED`, após verificar novamente opt-in, telefone e agendamento; registra o operador. Mensagens `SENT`, `DELIVERED` e `READ` não são reenviadas.
* **Permissão:** `communications:write`.
* **Cabeçalho Obrigatório:** `Idempotency-Key`
* **Respostas:** `200 OK` (`{ "status": "QUEUED" }`), `409 MESSAGE_STATE_CONFLICT` se não for elegível. Repetir a chave retorna o resultado original.

---

### Módulo 11: Painel & Indicadores da Clínica
*(Ref: Issues [#197](https://github.com/Flowcare-team/flowcare-monorepo/issues/197), [#229](https://github.com/Flowcare-team/flowcare-monorepo/issues/229), [#230](https://github.com/Flowcare-team/flowcare-monorepo/issues/230))*

**Decisão do MVP:** ver [dicionário de métricas](METRICS_MVP.md). O painel mostra contagens de agenda e taxa de faltas; consumo de transcrição mostra volume, sem custo estimado em R$ ou cota inventada. As rotas abaixo ainda são planejadas.

#### `GET /organizations/:orgSlug/dashboard/metrics`
* **Descrição:** Retorna indicadores operacionais da clínica no período e fuso configurados, sem cruzar organizações.
* **Permissão:** `dashboard:read`.
* **Query Params:** `?period=today|week|month` ou `?startDate=YYYY-MM-DD&endDate=YYYY-MM-DD`. Padrão: `today`.
* **Respostas:** `200 OK` (`{ "periodStart": "...", "periodEnd": "...", "timeZone": "America/Fortaleza", "totalAppointments": 10, "scheduledAppointments": 2, "completedAppointments": 5, "cancelledAppointments": 2, "noShowAppointments": 1, "noShowRate": 0.1667 }`). `noShowRate` é `null` sem atendimentos concluídos ou faltas.

#### `GET /organizations/:orgSlug/settings/usage`
* **Descrição:** Consulta o consumo mensal de transcrição da clínica, com detalhamento por profissional e falhas sem consumo.
* **Permissão:** `usage:read`.
* **Query Params:** `?month=YYYY-MM`.
* **Respostas:** `200 OK` (`{ "month": "2026-10", "timeZone": "America/Fortaleza", "processedSeconds": 120, "processedMinutes": 2, "successfulAudioCount": 2, "transcribedConsultations": 2, "failedAudioCount": 1, "byProfessional": [] }`). Sem campo de custo em R$ ou cota até aprovação da regra comercial.

---

### Módulo 12: Configurações da Clínica & Horários
*(Ref: Issues [#303](https://github.com/Flowcare-team/flowcare-monorepo/issues/303)–[#306](https://github.com/Flowcare-team/flowcare-monorepo/issues/306))*

#### `GET /organizations/:orgSlug/settings`
* **Descrição:** Consulta as configurações institucionais, dados cadastrais e logotipo da clínica.
* **Permissão:** `settings:read`.
* **Respostas:** `200 OK`.

#### `PATCH /organizations/:orgSlug/settings`
* **Descrição:** Atualiza os dados cadastrais da clínica.
* **Permissão:** `settings:write`.
* **Body:** `{ "phone": "(11) 98888-0000", "version": 2 }`
* **Respostas:** `200 OK`.

#### `PUT /organizations/:orgSlug/settings/schedule-rules`
* **Descrição:** Define os horários de funcionamento recorrentes e exceções/bloqueios na agenda.
* **Permissão:** `settings:write`.
* **Body:** `{ "rules": [...], "blockedDates": ["2026-12-25"] }`
* **Respostas:** `200 OK`.

---

### Módulo 13: Auditoria & Logs de Segurança
*(Ref: Issues [#327](https://github.com/Flowcare-team/flowcare-monorepo/issues/327), [#328](https://github.com/Flowcare-team/flowcare-monorepo/issues/328))*

#### `GET /organizations/:orgSlug/audit-logs`
* **Descrição:** Consulta os registros de auditoria da clínica (quem acessou, alterou ou excluiu dados).
* **Permissão:** `audit:read`.
* **Query Params:** `?startDate=2026-09-01&action=DOCUMENT_VOIDED`
* **Respostas:** `200 OK` (`{ "data": [ { "id": "log_1", "actorName": "Dra. Maria", "action": "DOCUMENT_VOIDED", "timestamp": "..." } ] }`).

---

### Módulo 14: Conta Pessoal & Gerenciamento de Sessões
*(Ref: Issues [#331](https://github.com/Flowcare-team/flowcare-monorepo/issues/331)–[#335](https://github.com/Flowcare-team/flowcare-monorepo/issues/335))*

#### `GET /me/profile`
* **Descrição:** Consulta os dados da conta pessoal do usuário logado.
* **Permissão:** Autenticado.
* **Respostas:** `200 OK` (`{ "id": "usr_1", "fullName": "Dra. Maria Silva", "email": "maria@exemplo.com" }`).

#### `PATCH /me/profile`
* **Descrição:** Atualiza o nome completo ou foto de perfil pessoal.
* **Permissão:** Autenticado.
* **Body:** `{ "fullName": "Dra. Maria Silva Santos" }`
* **Respostas:** `200 OK`.

#### `POST /me/change-password`
* **Descrição:** Altera a senha do usuário solicitando a senha atual como confirmação de segurança. Revoga atomicamente as outras sessões; a sessão atual permanece ativa.
* **Permissão:** Autenticado.
* **Body:** `{ "currentPassword": "<senha_atual>", "newPassword": "<nova_senha>" }`
* **Respostas:** `200 OK`.

#### `GET /me/sessions`
* **Descrição:** Lista todas as sessões ativas do usuário com IP, navegador e última atividade.
* **Permissão:** Autenticado.
* **Respostas:** `200 OK` (`{ "sessions": [ { "id": "sess_current", "isCurrent": true, "ipAddress": "201.20.1.5", "userAgent": "Chrome/macOS", "lastActiveAt": "2026-10-05T14:30:00.000Z" } ] }`). A atividade é atualizada com resolução de até 5 minutos para evitar uma escrita no banco a cada requisição.

#### `DELETE /me/sessions/:sessionId`
* **Descrição:** Revoga uma sessão específica.
* **Permissão:** Autenticado.
* **Respostas:** `200 OK`.

#### `DELETE /me/sessions/other`
* **Descrição:** Revoga todas as outras sessões ativas, exceto a atual.
* **Permissão:** Autenticado.
* **Respostas:** `200 OK` (`{ "revokedCount": 2 }`).

---

## 4. Modelo de Dados Relacional & Prisma Schema

A definição completa e o schema Prisma oficial para o banco PostgreSQL são mantidos na issue de consolidação de dados:

👉 **[Issue #199 — Consolidar o modelo de dados relacional e schema do Prisma](https://github.com/Flowcare-team/flowcare-monorepo/issues/199)**

### Principais Entidades e Vínculos:
* **`User` / `Account`**: Usuário global e credenciais da conta pessoal. Nenhum papel global: toda permissão nasce de um `Membership` em uma clínica.
* **`Session`**: Sessões ativas de login com data de expiração e IP/User-Agent. Autenticação via `Authorization: Bearer <JWT>` cujo payload carrega o ID da `Session` — revogação imediata no banco.
* **`VerificationToken`**: Tokens de uso único (verificação de e-mail, reset de senha) armazenados **apenas como SHA-256**, com TTL e `usedAt`.
* **`Organization`**: Clínicas do sistema com `slug` único, `ownerId` (o criador — pagador da assinatura) e fuso horário.
* **`Subscription`**: Assinatura por clínica: R$ 89/mês, status `PENDING_PAYMENT`/`ACTIVE`/`PAST_DUE`/`CANCELED`. Somente o dono paga; membros convidados não pagam.
* **`Membership`**: Vínculo entre `User` e `Organization` com `role` (ADMIN/PROFESSIONAL/RECEPTIONIST) e status.
* **`OnboardingProgress`**: Estado do assistente de primeiro acesso, persistido por conta.
* **`Role` & `Permission`**: Papéis e permissões granulares por clínica.
* **`Patient`**: Cadastros de pacientes isolados por `organizationId`.
* **`Appointment`**: Agendamentos ligados a `Patient`, `User` (profissional) e `Organization`.
* **`Consultation`**: Atendimento clínico ligado a `Appointment` e `Patient`.
* **`Document` & `DocumentVersion`**: Documentos médicos com histórico de versões e snapshots imutáveis.
* **`AuditLog`**: Trilha imutável de eventos de auditoria da organização.

#### `User`, `Organization` e `Membership`

O relacionamento que permite a uma pessoa acessar várias clínicas é `User` 1-N `Membership` N-1 `Organization`. A identidade é global; papel, estado e permissões pertencem ao vínculo organizacional.

| Entidade | Campo | Regra contratual |
|---|---|---|
| `User` | `id` | Chave primária opaca e imutável (UUID v4 ou CUID2). Nunca é reutilizada. |
| `User` | `email` | Identificador global de login, normalizado e único conforme o contrato de autenticação. |
| `Organization` | `id` | Chave primária interna, opaca e imutável. É o valor usado nas chaves estrangeiras e no isolamento das queries. |
| `Organization` | `name` | Nome de exibição da clínica; sua alteração não muda automaticamente o slug. |
| `Organization` | `slug` | Identificador público, globalmente único e adequado para URL. Não é usado como chave estrangeira. |
| `Organization` | `ownerId` | Chave estrangeira obrigatória para o `User` responsável pela clínica e pela assinatura. Não substitui o `Membership` do proprietário. |
| `Organization` | `timezone` | Fuso IANA usado para calendário e apresentação; timestamps persistidos continuam em UTC. |
| `Membership` | `id` | Chave primária opaca e imutável do vínculo. |
| `Membership` | `userId` | Chave estrangeira obrigatória para `User(id)`. |
| `Membership` | `organizationId` | Chave estrangeira obrigatória para `Organization(id)`. |
| `Membership` | `role` | Papel da pessoa nessa organização: `ADMIN`, `PROFESSIONAL` ou `RECEPTIONIST`. |
| `Membership` | `status` | Estado do vínculo: `ACTIVE`, `SUSPENDED` ou `INVITED`. Somente `ACTIVE` autoriza acesso. |

Regras e restrições:

* A combinação (`userId`, `organizationId`) é única: uma pessoa possui no máximo um `Membership` por organização.
* `User` não contém `organizationId`, `role` ou permissões globais de clínica. A mesma pessoa pode ter papéis diferentes em organizações diferentes.
* Credenciais pertencem à conta pessoal; sessão pertence a `Session`; um vínculo `INVITED` ainda não autoriza acesso. Nenhum deles substitui um `Membership` ativo.
* Dados clínicos e operacionais referenciam `Organization(id)`, nunca `Organization(slug)`.
* Remover ou suspender um vínculo revoga o acesso organizacional sem encerrar as sessões globais da pessoa em outras clínicas; `INVITED` não concede acesso até a ativação.

#### Política de `orgSlug`

* O slug é derivado do nome na criação, convertido para minúsculas, sem acentos e limitado a letras ASCII, números e hífens, no formato `^[a-z0-9]+(?:-[a-z0-9]+)*$`.
* A unicidade é global. Em colisões, o backend acrescenta um sufixo numérico (`clinica-2`, `clinica-3`, ...), confirmado por constraint única no banco para também cobrir concorrência.
* Alterar o nome da clínica não altera o slug automaticamente. Uma futura alteração explícita de slug deverá tratar redirecionamentos e links existentes em contrato próprio.
* Conhecer um slug não concede acesso. O backend sempre o converte em `Organization.id` e valida o `Membership` antes de fornecer `organizationId` à rota.
