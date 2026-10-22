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
> **Decisão #192 para o MVP:** A API usa `Authorization: Bearer <JWT>`. O JWT expira em 12 horas e exige uma `Session` ativa no banco. O Next.js guarda o token em cookie `HttpOnly`, `SameSite=Lax` e `Secure` em produção. Não há renovação automática; depois de 12 horas a pessoa faz login novamente. Logout da API ainda está pendente; revogação manual está disponível em `/me/sessions`.

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
| **409** | `POSSIBLE_DUPLICATE` | O cadastro de paciente corresponde a outro paciente da mesma clínica e requer confirmação explícita. |
| **409** | `ALREADY_EXISTS` | Conflito de duplicidade de chave única (ex: e-mail já cadastrado, slug já utilizado). |
| **409** | `SLOT_CONFLICT` | Horário de agendamento já reservado por outro paciente. |
| **409** | `LAST_ADMIN_REQUIRED` | Tentativa de remover ou rebaixar o último administrador da organização. |
| **409** | `MESSAGE_STATE_CONFLICT` | Tentativa de reenviar mensagem fora do estado permitido. |
| **409** | `DOCUMENT_STATE_CONFLICT` | Tentativa de editar, emitir ou anular documento fora do estado permitido. |
| **409** | `INVALID_STATE_TRANSITION` | Tentativa de aplicar transição fora da máquina de estados permitida para o recurso. |
| **410** | `INVITE_EXPIRED` | O convite para a equipe expirou ou foi revogado. |
| **422** | `BUSINESS_RULE_VIOLATION` | Violação de regra de negócio com estado válido (ex: campos clínicos obrigatórios ausentes para emissão). |
| **422** | `CLINICAL_QUALIFICATION_REQUIRED` | Dados profissionais exigidos ausentes para atribuição de papel clínico (`registrationNumber` e `professionalTitle`). |
| **422** | `INVALID_TEMPLATE_STRUCTURE` | Estrutura de modelo de documento inválida (ex: título/conteúdo vazio, chaves desbalanceadas ou placeholder malformado). |
| **422** | `INVALID_TEMPLATE_VARIABLE` | Variável automática fora do catálogo homologado (`APPROVED_TEMPLATE_VARIABLES`). |
| **429** | `RATE_LIMITED` | Limite de requisições excedido. |
| **503** | `COMMUNICATION_PROVIDER_UNAVAILABLE` | Provedor de comunicação indisponível ou retornou uma resposta inválida. |
| **500** | `INTERNAL` | Erro interno do servidor. Não exibe stack traces nem detalhes de infraestrutura em produção. |

---

## 3. Especificação dos Módulos da API

---

### Módulo 1: Autenticação & Sessões
*(Ref: Issues [#192](https://github.com/Flowcare-team/flowcare-monorepo/issues/192), [#207](https://github.com/Flowcare-team/flowcare-monorepo/issues/207), [#208](https://github.com/Flowcare-team/flowcare-monorepo/issues/208), [#209](https://github.com/Flowcare-team/flowcare-monorepo/issues/209))*

**Implementado:** JWT com `sid`/`sub` e sessão persistida, TTL de 12 horas sem renovação automática; verificação de e-mail em 24 horas, reset em 30 minutos e até 3 emissões de token de verificação por conta a cada hora (incluindo o token inicial). Senhas usam Argon2id e aceitam 8 a 72 caracteres. Tokens enviados por e-mail são de uso único e persistidos somente como SHA-256; uma nova emissão invalida atomicamente tokens anteriores ainda válidos do mesmo tipo.

#### Proteção contra abuso e enumeração (#356)

Os contadores usam janelas fixas persistidas no PostgreSQL. Identificadores de origem, e-mail e token são armazenados somente como HMAC-SHA256; o valor completo não é gravado no limitador nem nos metadados de auditoria. Falha de leitura/escrita do limitador interrompe a requisição, sem liberar o envio de e-mail ou a autenticação.

| Fluxo | Limite por origem | Limite por conta/token | Janela |
|---|---:|---:|---:|
| Login | 20 | 5 por e-mail normalizado | 15 minutos |
| Cadastro e reenvio de verificação (contador compartilhado) | 10 | 3 por e-mail normalizado | 1 hora |
| Solicitação de redefinição | 10 | 3 por e-mail normalizado | 1 hora |
| Confirmação de e-mail | 20 | 5 por token | 15 minutos |
| Consumo de token de redefinição | 10 | 5 por token | 15 minutos |

O excesso por origem ou nos fluxos de login/consumo de token retorna `429 RATE_LIMITED`. No cadastro, reenvio e recuperação, o excesso por conta mantém a mesma resposta neutra de sucesso e apenas suprime novo token/e-mail, evitando revelar se a conta existe. Login executa Argon2id também para conta inexistente; cadastro executa o hash nos dois caminhos; cadastro, reenvio, login e recuperação observam tempo mínimo uniforme de 500 ms fora do ambiente de teste.

Quando `TRUST_PROXY=true`, a API aceita `X-Forwarded-For` somente para extração de um IP sintaticamente válido, usando o último elemento da cadeia; sem essa opção usa exclusivamente o endereço do peer. Sob a mesma configuração explícita, as Server Actions do Next.js encaminham ao backend apenas esse último IP validado, nunca a cadeia arbitrária recebida. Com `TRUST_PROXY=false`, o Next.js não encaminha o cabeçalho.

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
* **Respostas:** `201 Created` (`{ "message": "Conta criada com sucesso. Verifique seu e-mail para continuar." }`), `400 VALIDATION_ERROR`, `429 RATE_LIMITED` por origem. E-mails já cadastrados e limites por conta recebem a mesma resposta `201`; contas já verificadas não recebem outro link.

#### `POST /auth/verify-email`
* **Descrição:** Confirma o endereço de e-mail com o token recebido.
* **Permissão:** Pública.
* **Body:** `{ "token": "<token_verificacao>" }`
* **Respostas:** `200 OK` com o mesmo DTO de sessão de `POST /auth/login` (`token`, `user`, `availableOrganizations`, `onboardingCompleted`), `400 INVALID_TOKEN`, `429 RATE_LIMITED`. O token de verificação é consumido uma única vez; o frontend guarda a sessão em cookie HttpOnly e segue para o onboarding ou clínica disponível.

#### `POST /auth/resend-verification`
* **Descrição:** Solicita outro link de confirmação para uma conta ainda pendente. A resposta é igual para e-mail inexistente, já confirmado ou temporariamente limitado, para não revelar o estado da conta.
* **Permissão:** Pública.
* **Body:** `{ "email": "maria.silva@exemplo.com" }`
* **Respostas:** `200 OK` (`{ "message": "Se a conta estiver pendente, um novo link será enviado." }`), `400 VALIDATION_ERROR`, `429 RATE_LIMITED` por origem. Limite por conta mantém a resposta `200`.

#### `POST /auth/login`
* **Descrição:** Autentica com e-mail e senha e inicia a sessão do usuário.
* **Permissão:** Pública.
* **Body:** `{ "email": "maria.silva@exemplo.com", "password": "<senha_segura>" }`
* **Respostas:** `200 OK` (`{ "user": { "id": "usr_1", "email": "...", "fullName": "..." }, "availableOrganizations": [ { "id", "name", "slug", "role", "isOwner" } ], "token": "...", "onboardingCompleted": false, "onboardingCurrentStep": "PROFILE_SETUP" }`), `401 INVALID_CREDENTIALS`, `401 ACCOUNT_NOT_VERIFIED`, `429 RATE_LIMITED`.

> `isOwner` = `true` quando a clínica foi criada pelo próprio usuário (ele é o pagador da assinatura); membros convidados recebem `isOwner: false` e não pagam.

#### `POST /auth/forgot-password`
* **Descrição:** Solicita redefinição de senha. Retorna resposta indistinguível para evitar enumeração de contas.
* **Permissão:** Pública.
* **Body:** `{ "email": "maria.silva@exemplo.com" }`
* **Respostas:** `200 OK` (`{ "message": "Se o e-mail estiver cadastrado, as instruções serão enviadas." }`), `429 RATE_LIMITED` por origem. E-mail inexistente e limite por conta mantêm a mesma resposta `200`.

#### `POST /auth/reset-password`
* **Descrição:** Redefine a senha utilizando o token e encerra todas as sessões anteriores por segurança.
* **Permissão:** Pública.
* **Body:** `{ "token": "<token_redefinicao>", "newPassword": "<nova_senha>" }`
* **Respostas:** `200 OK` (`{ "message": "Senha alterada com sucesso. Todas as sessões anteriores foram encerradas." }`), `400 INVALID_TOKEN`, `429 RATE_LIMITED`.

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

#### `GET /onboarding/schedule-rules`
* **Descrição:** Recupera o fuso horário da clínica e sua grade semanal salva. Exige vínculo ADMIN ativo com a clínica criada no onboarding.
* **Resposta:** `200 OK` com `{ "timezone": "America/Sao_Paulo", "weeklySchedule": [...] }`.

#### `POST /onboarding/schedule-rules`
* **Descrição:** Configura os dias e horários padrão de atendimento da clínica. O envio durante a etapa de horários marca `WEEKLY_SCHEDULE` como concluída.
* **Permissão:** Autenticado (Administrador).
* **Body:**
  ```json
  {
    "timezone": "America/Sao_Paulo",
    "weeklySchedule": [
      { "dayOfWeek": "MONDAY", "startTime": "08:00", "endTime": "18:00", "slotDurationMinutes": 30 }
    ]
  }
  ```
* **Respostas:** `200 OK` com `{ "timezone": "...", "weeklySchedule": [...] }`; `400 VALIDATION_ERROR` para fuso ou intervalos inválidos ou sobrepostos; `403 ACCOUNT_NOT_VERIFIED`; `409 ONBOARDING_INCOMPLETE` sem clínica criada e vínculo ADMIN ativo. A lista vazia remove os horários iniciais. O envio substitui os horários da clínica. `timezone` é opcional para clientes antigos; nesse caso, o fuso da clínica é preservado.

#### `POST /onboarding/complete`
* **Descrição:** Finaliza a jornada após a última etapa obrigatória, incluindo a configuração de horários. A grade pode ser vazia quando não houver horários de atendimento definidos.
* **Permissão:** Autenticado.
* **Respostas:** `200 OK` (`{ "redirectUrl": "/app/vida-e-saude/dashboard" }`), inclusive em chamadas repetidas; `403 ACCOUNT_NOT_VERIFIED`; `409 ONBOARDING_INCOMPLETE` sem clínica criada e vínculo ADMIN ativo.

---

### Módulo 3: Organizações & Alternância de Contexto
*(Ref: Issues [#191](https://github.com/Flowcare-team/flowcare-monorepo/issues/191), [#227](https://github.com/Flowcare-team/flowcare-monorepo/issues/227), [#228](https://github.com/Flowcare-team/flowcare-monorepo/issues/228))*

> [!NOTE]
> A issue #191 cita um arquivo `PRODUCT_SCOPE.md`, mas esse arquivo não existe no estado atual nem no histórico disponível do repositório. Até que uma fonte substituta seja indicada, a lista de módulos e rotas desta seção é o inventário canônico para validar a cobertura multi-tenant.

#### `GET /organizations`
* **Descrição:** Lista somente as clínicas nas quais a pessoa possui `Membership` ativo. Vínculos suspensos ou ainda `INVITED` não autorizam acesso e não aparecem na seleção.
* **Permissão:** Autenticado.
* **Respostas:** `200 OK` (`{ "data": [ { "id": "org_1", "name": "...", "slug": "vida-e-saude", "role": "ADMIN", "status": "ACTIVE" } ] }`), `401 UNAUTHENTICATED`. A lista retorna no máximo 100 vínculos ativos, em ordem de criação; uma conta sem vínculos recebe `data: []`.

#### `POST /organizations`
* **Descrição:** Cria uma clínica adicional após o onboarding. O nome é normalizado; o slug é derivado do nome e colisões recebem sufixo numérico (`-2`, `-3`, ...). A criação da clínica, do vínculo `ADMIN` ativo do proprietário, da assinatura pendente e da preferência ativa é transacional. No modelo atual, `Organization.ownerId` identifica o proprietário; `MembershipRole` não possui `OWNER`.
* **Body:** `{ "name": "Pet Saúde" }`.
* **Respostas:** `201 Created` com `{ "organization": { "id": "...", "name": "Pet Saúde", "slug": "pet-saude", "role": "ADMIN", "isOwner": true }, "activeOrganization": { "id": "...", "slug": "pet-saude" } }`; `400 VALIDATION_ERROR`; `401 UNAUTHENTICATED`; `409 ALREADY_EXISTS` se não for possível reservar um slug após as tentativas permitidas.

#### `PATCH /account/active-organization`
* **Descrição:** Guarda a última clínica escolhida pela conta. A preferência é usada apenas para navegação, nunca como prova de autorização; toda rota organizacional continua validando o vínculo. Vínculo suspenso, convidado, inexistente ou de terceiro não pode ser selecionado.
* **Body:** `{ "orgSlug": "pet-saude" }`.
* **Respostas:** `200 OK` com `{ "activeOrganization": { "id": "...", "slug": "pet-saude" } }`; `400 VALIDATION_ERROR`; `401 UNAUTHENTICATED`; `403 FORBIDDEN` quando não há vínculo ativo.
* **Restauração:** A resposta de login inclui `activeOrganization` com `id` e `slug` quando a última clínica salva ainda possui vínculo ativo; caso contrário retorna `null`. O frontend pode usar esse valor para restaurar a navegação, mas deve continuar validando cada chamada pelo `orgSlug` da URL.

#### `GET /account/active-organization`
* **Descrição:** Retorna a última clínica escolhida somente enquanto o vínculo da conta com ela estiver ativo. É uma preferência de navegação, sem substituir a autorização por clínica.
* **Respostas:** `200 OK` com `{ "activeOrganization": { "id": "...", "slug": "pet-saude" } }` ou `{ "activeOrganization": null }`; `401 UNAUTHENTICATED`.

#### `GET /account/notifications/preferences`
* **Descrição:** Lista somente as combinações de evento e canal disponíveis para a própria conta. No MVP atual, retorna `ACCOUNT_SECURITY` por `EMAIL`, com `enabled: true` e `required: true`. O evento cobre e-mails de verificação de conta e recuperação de senha. Canais de aplicativo e WhatsApp pessoal não são anunciados, pois não há entrega implementada. Preferências de WhatsApp para pacientes pertencem ao fluxo separado de comunicação por clínica.
* **Respostas:** `200 OK` com `{ "preferences": [{ "event": "ACCOUNT_SECURITY", "channel": "EMAIL", "enabled": true, "required": true }] }`; `401 UNAUTHENTICATED`.

#### `PUT /account/notifications/preferences`
* **Descrição:** Substitui a lista de preferências da própria conta. O corpo deve conter exatamente as combinações oferecidas pelo GET, sem duplicatas. A preferência obrigatória deve permanecer habilitada.
* **Body:** `{ "preferences": [{ "event": "ACCOUNT_SECURITY", "channel": "EMAIL", "enabled": true }] }`.
* **Respostas:** `200 OK` com o mesmo formato do GET; `400 VALIDATION_ERROR` para combinação desconhecida ou lista incompleta; `400 REQUIRED_NOTIFICATION` ao tentar desabilitar um evento obrigatório; `401 UNAUTHENTICATED`.

#### `GET /organizations/:orgSlug`
* **Descrição:** Obtém os dados e preferências da clínica especificada pelo slug.
* **Permissão:** Autenticado + Pertencer à clínica (`organizations:read`).
* **Respostas:** `200 OK`, `401 UNAUTHENTICATED`, `403 MEMBERSHIP_INACTIVE`, `403 PERMISSION_DENIED`, `404 NOT_FOUND`.

#### `GET /organizations/:orgSlug/onboarding-details`
* **Descrição:** Carrega dados legais, contato, endereço, versão e estado de conclusão da clínica para a etapa #222.
* **Permissão:** `Membership` ativo com papel `ADMIN` na clínica indicada pelo slug.
* **Respostas:** `200 OK` com `name`, `slug`, `version`, `completed`, `legalName`, `taxId`, `contactEmail`, `contactPhone`, `postalCode`, `state`, `city`, `district`, `street`, `streetNumber` e `addressComplement`; `404 NOT_FOUND` para vínculo inexistente ou sem permissão.

#### `PUT /organizations/:orgSlug/onboarding-contact`
* **Descrição:** Salva os dados institucionais e o contato, concluindo `CLINIC_DETAILS` no progresso do onboarding.
* **Body:** `{ "version": 0, "legalName": "Clínica Exemplo Ltda", "taxId": "", "contactEmail": "contato@exemplo.com", "contactPhone": "85999999999" }`. `taxId` pode ficar vazio; quando informado, deve ser um CNPJ válido.
* **Respostas:** `200 OK` com o mesmo DTO do GET; `400 VALIDATION_ERROR` com `error.details.field` quando um campo é inválido; `404 NOT_FOUND` para clínica sem vínculo administrativo ativo; `409 VERSION_CONFLICT` para versão desatualizada; `409 STEP_ALREADY_COMPLETED` se a etapa já foi concluída.

#### `PUT /organizations/:orgSlug/onboarding-address`
* **Descrição:** Salva o endereço e conclui `CLINIC_ADDRESS` no progresso do onboarding.
* **Body:** `{ "version": 1, "postalCode": "60000000", "state": "CE", "city": "Fortaleza", "district": "Centro", "street": "Rua Exemplo", "streetNumber": "10", "addressComplement": "" }`. `postalCode` contém oito dígitos; `state` contém duas letras. O complemento pode ficar vazio.
* **Respostas:** Os mesmos códigos da atualização de contato. Cada atualização bem-sucedida incrementa `version`; a comparação de versão e a gravação ocorrem na mesma transação.

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

**Decisão de produto do MVP:** a [matriz de papéis e capacidades](RBAC_MVP.md) define quatro papéis fixos: `ADMIN`, `ADMIN_PROFESSIONAL`, `PROFESSIONAL` e `RECEPTIONIST`. Papéis personalizados e `roles:manage` ficam fora do MVP. Habilitações específicas de ações clínicas exigem revisão por responsável clínico antes da ativação.

#### `GET /organizations/:orgSlug/members`
* **Descrição:** Lista os membros da equipe da clínica com seus respectivos papéis.
* **Permissão:** `team:read`.
* **Respostas:** `200 OK` (`{ "data": [ { "id": "mem_1", "userId": "user_1", "userName": "Dra. Maria", "email": "maria@exemplo.com", "role": "ADMIN", "status": "ACTIVE", "version": 1, "createdAt": "2026-10-17T12:00:00.000Z" } ] }`). `version` deve ser enviado na alteração de papel e `createdAt` representa o ingresso na clínica.

#### `POST /organizations/:orgSlug/invites`
* **Descrição:** Envia convite por e-mail para integrar uma pessoa à equipe com um papel específico.
* **Permissão:** `team:invite`.
* **Cabeçalho Obrigatório:** `Idempotency-Key`
* **Body:** `{ "email": "recepcao@exemplo.com", "role": "RECEPTIONIST" }`
* **Respostas:** `201 Created` (`{ "id": "...", "email": "...", "expiresAt": "..." }`), `409 ALREADY_EXISTS` para vínculo ativo/convidado ou convite pendente ao mesmo e-mail na clínica.

#### `GET /organizations/:orgSlug/invites`
* **Descrição:** Lista até 100 convites pendentes e válidos da clínica, sem tokens.
* **Permissão:** Gestão de equipe (`ADMIN` ou `ADMIN_PROFESSIONAL`).
* **Resposta:** `200 OK` com `data` contendo `id`, `email`, `role` e `expiresAt`.

#### `DELETE /organizations/:orgSlug/invites/:inviteId`
* **Descrição:** Revoga um convite pendente da clínica imediatamente.
* **Permissão:** `team:manage`.
* **Respostas:** `200 OK` ou `404 NOT_FOUND` quando o convite não pertence à clínica ou já não está pendente.

#### `POST /organizations/:orgSlug/invites/:inviteId/resend`
* **Descrição:** Substitui o token anterior e inicia novo prazo de sete dias, inclusive para convite vencido ainda não revogado nem aceito.
* **Permissão:** `team:invite`.
* **Respostas:** `200 OK` com `id`, `email` e `expiresAt`; `404 NOT_FOUND` para convite inexistente, revogado ou aceito; `409 ALREADY_EXISTS` se a pessoa já tem vínculo ativo ou convidado na clínica.

#### `GET /organizations/:orgSlug/invites`
* **Descrição:** Lista até 100 convites pendentes e não expirados da clínica, junto com os papéis aceitos atualmente pela API.
* **Permissão:** Administrador ativo da clínica.
* **Resposta:** `200 OK` (`{ "data": [ { "id": "inv_1", "email": "...", "role": "PROFESSIONAL", "expiresAt": "..." } ], "roles": ["ADMIN", "PROFESSIONAL", "RECEPTIONIST"] }`). Tokens não são retornados.

#### `POST /invites/:token/accept`
* **Descrição:** Aceita um convite de equipe enviado por e-mail e cria o vínculo de Membership na clínica.
* **Permissão:** Autenticado, e-mail verificado e igual ao destinatário do convite.
* **Body:** Sem corpo obrigatório; o token é enviado na URL (`:token`).
* **Respostas:** `200 OK` (`{ "organizationSlug": "vida-e-saude" }`), `403 FORBIDDEN` (quando o e-mail autenticado não corresponde ao convite), `410 INVITE_EXPIRED` (para token inválido, expirado, revogado ou já utilizado por outro usuário).
* **Regras:** Convite válido por 7 dias, uso único e vinculado a e-mail, clínica e papel. Revogação ou reenvio invalidam o token anterior. Aceite repetido pelo mesmo usuário é idempotente e retorna o slug da clínica (`200 OK`) sem duplicar vínculos ou registros de auditoria.

#### `PATCH /organizations/:orgSlug/members/:memberId/role`
* **Descrição:** Altera o papel de outro membro ativo da clínica, aplicando controle de concorrência otimista (`version`), validação de habilitação clínica e proteção contra perda do último administrador.
* **Permissão:** `team:manage` (`ADMIN` ou `ADMIN_PROFESSIONAL`).
* **Body:**
  ```json
  {
    "role": "PROFESSIONAL",
    "version": 1
  }
  ```
  `role` aceita os papéis fixos do sistema (`ADMIN`, `ADMIN_PROFESSIONAL`, `PROFESSIONAL`, `RECEPTIONIST`). `version` é o número da versão atual do `Membership` a ser incrementado atomicamente.
* **Validações e regras:**
  * **Isolamento multi-tenant:** Se `memberId` não pertencer à clínica resolvida por `:orgSlug`, responde `404 NOT_FOUND` sem revelar dados.
  * **Proibição de autoalteração:** Administrador não pode alterar o próprio papel por esta rota (`auth.userId === membership.userId`), retornando `403 FORBIDDEN` (`"Não é permitido alterar o próprio papel por esta rota."`).
  * **Vínculo ativo:** Vínculos inativos (`SUSPENDED` ou `INVITED`) retornam `403 MEMBERSHIP_INACTIVE`.
  * **Proteção do último administrador:** Rebaixar membro de papel administrativo (`ADMIN` ou `ADMIN_PROFESSIONAL`) para não administrativo (`PROFESSIONAL` ou `RECEPTIONIST`) exige que a clínica mantenha ao menos um outro administrador ativo (`status: "ACTIVE"`). Caso contrário, responde `409 LAST_ADMIN_REQUIRED` (`"A clínica deve manter ao menos um administrador ativo."`).
  * **Habilitação clínica:** Atribuição de papel clínico (`PROFESSIONAL` ou `ADMIN_PROFESSIONAL`) exige dados profissionais cadastrados (`registrationNumber` e `professionalTitle` no usuário alvo). Ausência desses dados retorna `422 CLINICAL_QUALIFICATION_REQUIRED` (`"Dados profissionais exigidos para atribuição de papel clínico."`).
  * **Concorrência otimista:** Se o `version` enviado for divergente da versão atual no banco, retorna `409 VERSION_CONFLICT`.
  * **Efeito imediato e auditoria:** O novo papel vale imediatamente na próxima requisição do membro. Registra evento de auditoria `MEMBER_ROLE_CHANGED` (`targetType: "MEMBERSHIP"`, `targetId: membership.id`, `metadata: { targetUserId, previousRole, newRole, version }`) na mesma transação.
* **Respostas:** `200 OK` com dados do membro atualizado (`id`, `userId`, `organizationId`, `role`, `status`, `version`, `createdAt`, `updatedAt`, `user`, `member`), `400 VALIDATION_ERROR`, `401 UNAUTHENTICATED`, `403 FORBIDDEN`, `403 MEMBERSHIP_INACTIVE`, `403 PERMISSION_DENIED`, `404 NOT_FOUND`, `409 LAST_ADMIN_REQUIRED`, `409 VERSION_CONFLICT`, `422 CLINICAL_QUALIFICATION_REQUIRED`.

#### `DELETE /organizations/:orgSlug/members/:memberId` (aliases: `DELETE /organizations/:orgSlug/settings/team/:memberId`, `DELETE /settings/team/:memberId`)
* **Descrição:** Remove um membro da clínica desativando seu vínculo (`status: "SUSPENDED"`) de forma segura, garantindo isolamento multi-tenant, bloqueio imediato de acesso à clínica com `403 MEMBERSHIP_INACTIVE`, preservação da integridade referencial dos registros clínicos históricos criados pelo profissional, proteção contra remoção do último administrador e gravação transacional na trilha de auditoria (`MEMBER_REMOVED`).
* **Permissão:** `team:manage` (`ADMIN` ou `ADMIN_PROFESSIONAL`).
* **Parâmetros:** `:orgSlug` (slug da clínica ativa) e `:memberId` (identificador do vínculo `Membership.id` ou `User.id`).
* **Respostas:**
  * `200 OK` (`{ "success": true, "message": "Membro removido da organização com sucesso.", "memberId": "mem_1" }`)
  * `401 UNAUTHENTICATED` (sessão ausente, expirada ou inválida)
  * `403 PERMISSION_DENIED` (usuário sem capacidade `team:manage`)
  * `403 MEMBERSHIP_INACTIVE` (vínculo do chamador inativo ou suspenso)
  * `404 NOT_FOUND` (membro não encontrado ou pertencente a outra clínica — isolamento estrito)
  * `409 LAST_ADMIN_REQUIRED` (tentativa de remover o único administrador remanescente da organização)
* **Regras de integridade e auditoria:**
  * Desativação lógica com `status = "SUSPENDED"` revoga o acesso imediatamente na próxima requisição do membro via `organizationAccessPlugin`.
  * A conta global do usuário e eventuais vínculos ativos em outras organizações permanecem intactos.
  * Prontuários, consultas, evoluções e documentos assinados pelo profissional continuam íntegros e legíveis na clínica.
  * Na mesma transação da desativação, registra `AuditLog` (`action: "MEMBER_REMOVED"`, `targetType: "MEMBERSHIP"`, `targetId: membership.id`, `metadata: { removedUserId: membership.userId, role: membership.role }`).

#### `GET /organizations/:orgSlug/roles/capabilities`
* **Descrição:** Retorna o catálogo estruturado de capacidades aprovadas disponíveis para criação de papéis personalizados no escopo da clínica ativa.
* **Permissão:** `roles:read`.
* **Respostas:** `200 OK` (`{ "capabilities": [ { "name": "patients:read", "group": "common", "description": "Visualização de dados cadastrais de pacientes" } ], "data": [...] }`), `401 UNAUTHENTICATED`, `403 PERMISSION_DENIED`, `404 NOT_FOUND`.

#### `GET /organizations/:orgSlug/roles`
* **Descrição:** Lista os papéis do sistema (`ADMIN`, `ADMIN_PROFESSIONAL`, `PROFESSIONAL`, `RECEPTIONIST`) com suas capacidades fixas e a contagem de membros ativos da clínica, além dos papéis personalizados criados para a clínica ativa (`id`, `name`, `description`, `capabilities`, `createdAt`, `updatedAt`, `isSystem: false`). Isolamento multi-tenant estrito: papéis de outra organização jamais aparecem na resposta.
* **Permissão:** `roles:read`.
* **Respostas:** `200 OK` (`{ "systemRoles": [ { "role": "ADMIN", "name": "Administrador", "description": "...", "capabilities": [...], "memberCount": 2, "isSystem": true } ], "customRoles": [ { "id": "...", "organizationId": "...", "name": "Coordenador", "description": "...", "capabilities": [...], "createdAt": "...", "updatedAt": "...", "isSystem": false } ], "roles": [...] }`), `401 UNAUTHENTICATED`, `403 PERMISSION_DENIED`, `404 NOT_FOUND`.

#### `POST /organizations/:orgSlug/roles`
* **Descrição:** Cria um novo papel personalizado com nome legível e capacidades homologadas dentro do escopo da clínica ativa. Grava `ROLE_CREATED` em `AuditLog` (`targetType: "ORGANIZATION_ROLE"`, `targetId: role.id`, `metadata: { name, capabilities }`) na mesma transação.
* **Permissão:** `team:manage`.
* **Body:**
  ```json
  {
    "name": "Coordenador de Atendimento",
    "description": "Supervisão da equipe de recepção e agendamentos",
    "capabilities": [
      "patients:read",
      "patients:write",
      "appointments:read",
      "appointments:write",
      "reception:read",
      "reception:write"
    ]
  }
  ```
* **Validações e regras:**
  * `name`: 2 a 50 caracteres (sem contar espaços nas bordas). Não pode coincidir com nomes reservados pelo sistema (`ADMIN`, `ADMIN_PROFESSIONAL`, `PROFESSIONAL`, `RECEPTIONIST`), retornando `409 ROLE_NAME_CONFLICT`.
  * Nome deve ser único dentro da mesma clínica (colisão retorna `409 ALREADY_EXISTS`), mas pode ser repetido em clínicas distintas (isolamento multi-tenant).
  * `capabilities`: array não vazio contendo apenas strings válidas do catálogo oficial de capacidades (`ALLOWED_CUSTOM_ROLE_CAPABILITIES`). Capacidades inválidas ou desconhecidas são rejeitadas com `400 INVALID_CAPABILITY` e `details.invalidCapabilities`.
* **Respostas:** `201 Created` (`{ "id": "...", "organizationId": "...", "name": "Coordenador de Atendimento", "description": "...", "capabilities": [...], "createdAt": "...", "updatedAt": "...", "isSystem": false, "role": { ... } }`), `400 VALIDATION_ERROR`, `400 INVALID_CAPABILITY`, `401 UNAUTHENTICATED`, `403 PERMISSION_DENIED`, `404 NOT_FOUND`, `409 ALREADY_EXISTS`, `409 ROLE_NAME_CONFLICT`.

#### `PATCH /organizations/:orgSlug/roles/:roleId` (aliases: `PUT /organizations/:orgSlug/roles/:roleId`, `PATCH /organizations/:orgSlug/settings/roles/:id`, `PATCH /settings/roles/:id`)
* **Descrição:** Atualiza o nome, a descrição ou as capacidades de um papel personalizado existente no escopo da clínica ativa. A alteração de capacidades entra em vigor imediatamente para todos os membros que possuem o papel atribuído. Grava `ROLE_UPDATED` em `AuditLog` (`targetType: "ORGANIZATION_ROLE"`, `targetId: role.id`, `metadata: { previousName, newName, previousCapabilities, newCapabilities, diff }`) na mesma transação.
* **Permissão:** `team:manage`.
* **Body:**
  ```json
  {
    "name": "Coordenador de Recepção e Atendimento",
    "description": "Supervisão da recepção, agendamentos e prontuários",
    "capabilities": [
      "patients:read",
      "patients:write",
      "appointments:read",
      "appointments:write",
      "reception:read",
      "reception:write",
      "consultations:read"
    ]
  }
  ```
* **Validações e regras:**
  * **Imutabilidade de papéis do sistema:** Papéis fixos do sistema (`ADMIN`, `ADMIN_PROFESSIONAL`, `PROFESSIONAL`, `RECEPTIONIST`) são imutáveis e não podem ser editados (`400 RESERVED_ROLE_IMMUTABLE`).
  * **Isolamento multi-tenant:** O papel deve pertencer à clínica resolvida pelo `orgSlug`. Tentativas de editar papéis de outra clínica ou papéis inexistentes retornam `404 NOT_FOUND`.
  * `name` (quando enviado): 2 a 50 caracteres após trim. Não pode coincidir com nomes reservados pelo sistema (`409 ROLE_NAME_CONFLICT`) nem colidir com outro papel personalizado na mesma clínica (`409 ALREADY_EXISTS`).
  * `capabilities` (quando enviado): array não vazio contendo apenas capacidades homologadas em `ALLOWED_CUSTOM_ROLE_CAPABILITIES`. Capacidades desconhecidas ou inválidas são rejeitadas com `400 INVALID_CAPABILITY` e `details.invalidCapabilities`. Lista vazia é rejeitada com `400 VALIDATION_ERROR`.
  * Atualização e gravação na trilha de auditoria (`AuditLog`) são executadas atomicamente na mesma transação.
* **Respostas:** `200 OK` (`{ "id": "...", "organizationId": "...", "name": "...", "description": "...", "capabilities": [...], "createdAt": "...", "updatedAt": "...", "isSystem": false, "role": { ... } }`), `400 VALIDATION_ERROR`, `400 INVALID_CAPABILITY`, `400 RESERVED_ROLE_IMMUTABLE`, `401 UNAUTHENTICATED`, `403 MEMBERSHIP_INACTIVE`, `403 PERMISSION_DENIED`, `404 NOT_FOUND`, `409 ALREADY_EXISTS`, `409 ROLE_NAME_CONFLICT`.

---

### Módulo 5: Pacientes & Prontuário
*(Ref: Issues [#250](https://github.com/Flowcare-team/flowcare-monorepo/issues/250)–[#254](https://github.com/Flowcare-team/flowcare-monorepo/issues/254))*

#### `GET /organizations/:orgSlug/patients`
* **Descrição:** Consulta e filtra a lista de pacientes da clínica ativa com normalização de acentos/caixa no nome (`normalizedName`) e normalização numérica para variações de formatação de telefone e CPF.
* **Permissão:** `patients:read`.
* **Query Params:** `?search=joao&cursor=<id>&limit=20` (`q` também aceito como alias de `search`; `limit` de 1 a 100, padrão 20).
* **Respostas:** `200 OK` (`{ "data": [ { "id", "fullName", "cpf", "birthDate", "phone", "email", "healthInsurance", "insuranceNumber", "version", "createdAt", "updatedAt" } ], "pageInfo": { "nextCursor": null, "hasNextPage": false } }`), `400 VALIDATION_ERROR` (limite ou cursor inválido).

#### `GET /organizations/:orgSlug/patients/:id`
* **Descrição:** Retorna os detalhes cadastrais e de contato do paciente dentro da clínica ativa.
* **Permissão:** `patients:read`.
* **Respostas:** `200 OK` (`{ "patient": { "id", "fullName", "cpf", "birthDate", "phone", "email", "healthInsurance", "insuranceNumber", "version", "createdAt", "updatedAt" } }`), `404 NOT_FOUND` (ID inexistente ou pertencente a outra clínica, sem revelar dados).

#### `GET /organizations/:orgSlug/patients/:id/overview`
* **Descrição:** Retorna o resumo executivo do paciente na clínica ativa, incluindo dados essenciais de contato (`contact`), convênio ativo (`activeInsurance`, `healthInsurance`, `insuranceNumber`) e próximos agendamentos ativos (`upcomingAppointments` com status `RESERVED` ou `CONFIRMED` ordenados por `scheduledAt` crescente). Alertas clínicos (`allergies`, `comorbidities`, `clinicalAlerts`), notas médicas (`medicalNotes`) e o bloco `clinicalSummary` são incluídos exclusivamente quando o papel autenticado possui prerrogativa assistencial (`patients:read_history`: `PROFESSIONAL` ou `ADMIN_PROFESSIONAL`) e são omitidos para papéis exclusivamente administrativos/recepção (`ADMIN` e `RECEPTIONIST`).
* **Permissão:** `patients:read` (com enriquecimento condicional por `patients:read_history`).
* **Respostas:** `200 OK`, `404 NOT_FOUND` (ID inexistente ou pertencente a outra clínica).

#### `POST /organizations/:orgSlug/patients`
* **Descrição:** Cadastra um novo paciente. Executa verificação prévia de duplicidade pelo CPF normalizado, sempre dentro da clínica resolvida pela URL e pelo vínculo autenticado.
* **Permissão:** `patients:write`.
* **Cabeçalho Obrigatório:** `Idempotency-Key`
* **Body:** `{ "fullName": "João Souza", "cpf": "529.982.247-25", "birthDate": "1985-05-20", "phone": "(11) 97777-6666", "distinctPersonConfirmed": false }`. `distinctPersonConfirmed` é opcional e deve ser enviado como `true` somente depois de a pessoa confirmar que o resultado sinalizado pertence a outro paciente.
* **Respostas:** `201 Created` (`{ "patient": { "id", "fullName", "cpf", "birthDate", "phone", "version", "createdAt" } }`); `409 POSSIBLE_DUPLICATE` com `details.existingPatientId` e `details.matchedOn`; `409 IDEMPOTENCY_CONFLICT` quando a mesma chave é reutilizada com dados diferentes. Repetir o mesmo payload e a mesma chave retorna `201` com o cadastro original e não cria outro registro.

#### `PATCH /organizations/:orgSlug/patients/:patientId` (alias: `PUT /organizations/:orgSlug/patients/:patientId`)
* **Descrição:** Atualiza os dados cadastrais permitidos do paciente (`fullName`, `cpf`, `birthDate`, `phone`) com controle de concorrência otimista (`version`) e registro em `AuditLog` (`PATIENT_UPDATED` com `actorUserId`, `changedFields`, `previousVersion`, `newVersion` e `updatedAt`) na mesma transação. Rejeita campos clínicos ou imutáveis no payload (`400 VALIDATION_ERROR`). Quando o `cpf` é alterado para o CPF de outro paciente da mesma clínica, exige `distinctPersonConfirmed: true` ou retorna `409 POSSIBLE_DUPLICATE`.
* **Permissão:** `patients:write`.
* **Body:** `{ "fullName": "João Carlos Souza", "cpf": "529.982.247-25", "birthDate": "1985-05-20", "phone": "(11) 98888-5555", "distinctPersonConfirmed": false, "version": 2 }` (ao menos um campo cadastral além de `version` é obrigatório).
* **Respostas:** `200 OK` (`{ "patient": { "id", "fullName", "cpf", "birthDate", "phone", "version", "createdAt", "updatedAt" } }`), `400 VALIDATION_ERROR`, `401 UNAUTHENTICATED`, `403 MEMBERSHIP_INACTIVE`, `403 PERMISSION_DENIED`, `404 NOT_FOUND`, `409 POSSIBLE_DUPLICATE`, `409 VERSION_CONFLICT`.

#### `GET /organizations/:orgSlug/patients/:patientId/timeline` (alias: `GET /organizations/:orgSlug/patients/:patientId/records`)
* **Descrição:** Retorna a linha do tempo cronológica unificada de prontuário do paciente (consultas, documentos clínicos, anexos e agendamentos) pertencentes à clínica ativa, ordenada estritamente de forma decrescente (`timestamp DESC`), com auditoria de acesso a dados clínicos sensíveis conforme a LGPD.
* **Permissão:** `patients:read_history` (`PROFESSIONAL` e `ADMIN_PROFESSIONAL`). Papéis exclusivamente administrativos ou de recepção (`ADMIN`, `RECEPTIONIST`) são rejeitados com `403 PERMISSION_DENIED`. Não autenticado retorna `401 UNAUTHENTICATED`.
* **Isolamento multi-tenant:** Se `patientId` não pertencer à clínica resolvida por `:orgSlug`, responde `404 NOT_FOUND` sem revelar dados.
* **Query Params:**
  * `type` / `eventType`: `"all"` | `"consultation"` | `"document"` | `"attachment"` | `"appointment"` (padrão: `"all"`).
  * `startDate` & `endDate`: datas de filtro no formato `YYYY-MM-DD` (opcional).
  * `limit`: inteiro entre 1 e 100 (padrão: 20).
  * `cursor`: identificador do evento para paginação por cursor.
  * `page`: número da página (inteiro >= 1, padrão: 1).
* **Trilha de Auditoria (LGPD):** Na mesma requisição, registra entrada em `AuditLog` (`action: "PATIENT_TIMELINE_ACCESSED"`, `targetType: "PATIENT"`, `targetId: patientId`, `actorUserId`, `organizationId`).
* **Respostas:**
  * `200 OK`:
    ```json
    {
      "data": [
        {
          "id": "uuid",
          "eventType": "CONSULTATION",
          "timestamp": "2026-10-13T14:00:00.000Z",
          "professional": {
            "id": "uuid",
            "name": "Dr. João",
            "registrationNumber": "CRM 12345",
            "professionalTitle": "Médico"
          },
          "summary": "Consulta de retorno",
          "status": "COMPLETED",
          "resourceId": "uuid-da-consulta",
          "metadata": {
            "appointmentId": null,
            "anamnesisStatus": "APPROVED",
            "startedAt": "2026-10-13T14:00:00.000Z",
            "completedAt": "2026-10-13T14:30:00.000Z"
          }
        }
      ],
      "pageInfo": {
        "limit": 20,
        "hasNextPage": false,
        "nextCursor": null
      }
    }
    ```
  * `400 VALIDATION_ERROR` (parâmetros de consulta inválidos, limites fora do intervalo ou datas invertidas).
  * `401 UNAUTHENTICATED` (sessão ausente, expirada ou inválida).
  * `403 MEMBERSHIP_INACTIVE` (vínculo do usuário inativo ou suspenso).
  * `403 PERMISSION_DENIED` (usuário sem prerrogativa clínica `patients:read_history`).
  * `404 NOT_FOUND` (clínica ou paciente não encontrado).

#### `POST /organizations/:orgSlug/patients/:id/attachments`
* **Descrição:** Envia exame ou arquivo clínico privado para o prontuário do paciente na clínica ativa. O servidor valida o tamanho (máx. **10 MiB**) e a assinatura binária real (magic bytes) do arquivo (`application/pdf`, `image/jpeg`, `image/png`, `image/webp`), rejeitando arquivos disfarçados, grava o objeto no armazenamento privado sob `organizations/{organizationId}/patients/{patientId}/attachments/` (sem expor a chave interna ou URL pública permanente) e registra `PATIENT_ATTACHMENT_UPLOADED` em `AuditLog`.
* **Permissão:** `patients:attachments:write` (`PROFESSIONAL` e `ADMIN_PROFESSIONAL`).
* **Body:** `multipart/form-data` (`file`, `category` opcional, `description` opcional).
* **Respostas:** `201 Created` (`{ "attachmentId": "...", "fileName": "exame_sangue.pdf", "contentType": "application/pdf", "sizeBytes": 1024, "category": "LAB_EXAM", "description": "...", "createdAt": "...", "attachment": { ... } }`), `400 VALIDATION_ERROR` (tipo ou assinatura inválida), `403 PERMISSION_DENIED`, `404 NOT_FOUND`, `413 FILE_TOO_LARGE`, `503 STORAGE_UNAVAILABLE`.

#### `GET /organizations/:orgSlug/patients/:id/attachments`
* **Descrição:** Lista os metadados dos anexos privados do paciente na clínica ativa, sem expor URL pública permanente nem chave interna de objeto. Por padrão lista apenas anexos `ACTIVE`; com `?includeArchived=true`, inclui anexos arquivados para consulta de histórico.
* **Permissão:** `patients:attachments:read` (`PROFESSIONAL` e `ADMIN_PROFESSIONAL`).
* **Query Params:** `?includeArchived=true&category=LAB_EXAM`.
* **Respostas:** `200 OK` (`{ "data": [ { "id": "...", "attachmentId": "...", "patientId": "...", "fileName": "...", "contentType": "...", "sizeBytes": 1024, "category": "...", "description": "...", "uploadedById": "...", "status": "ACTIVE", "archivedAt": null, "archivedById": null, "archiveReason": null, "createdAt": "..." } ], "attachments": [...] }`), `403 PERMISSION_DENIED`, `404 NOT_FOUND`.

#### `POST /organizations/:orgSlug/patients/:id/attachments/:attachmentId/download-url` (alias: `GET /organizations/:orgSlug/patients/:id/attachments/:attachmentId/download-url`)
* **Descrição:** Autoriza a leitura temporária de um anexo ativo do paciente da clínica ativa, registrando `PATIENT_ATTACHMENT_DOWNLOAD_AUTHORIZED` em `AuditLog` e retornando uma URL privada assinada de curta duração (15 minutos / 900 segundos). Anexos arquivados ou pertencentes a outro paciente/clínica retornam `404 NOT_FOUND`.
* **Permissão:** `patients:attachments:read` (`PROFESSIONAL` e `ADMIN_PROFESSIONAL`).
* **Respostas:** `200 OK` (`{ "attachmentId": "...", "downloadUrl": "...", "expiresInSeconds": 900, "expiresAt": "..." }`), `403 PERMISSION_DENIED`, `404 NOT_FOUND`, `503 STORAGE_UNAVAILABLE`.

#### `POST /organizations/:orgSlug/patients/:id/attachments/:attachmentId/archive` (alias: `DELETE /organizations/:orgSlug/patients/:id/attachments/:attachmentId`)
* **Descrição:** Realiza o arquivamento lógico do anexo (`archivedAt`, `archivedById`, `archiveReason`) e registra `PATIENT_ATTACHMENT_ARCHIVED` em `AuditLog` na mesma transação, preservando o registro histórico. Chamadas repetidas em anexo já arquivado são idempotentes.
* **Permissão:** `patients:attachments:write` (`PROFESSIONAL` e `ADMIN_PROFESSIONAL`).
* **Body (opcional):** `{ "reason": "Motivo do arquivamento" }`.
* **Respostas:** `200 OK` (`{ "archived": true, "attachment": { ... } }`), `403 PERMISSION_DENIED`, `404 NOT_FOUND`.

---

### Módulo 6: Agendamentos & Recepção
*(Ref: Issues [#237](https://github.com/Flowcare-team/flowcare-monorepo/issues/237)–[#241](https://github.com/Flowcare-team/flowcare-monorepo/issues/241))*

#### `GET /organizations/:orgSlug/appointments`
* **Descrição:** Lista os agendamentos da clínica filtrados por intervalo de datas, profissional ou status.
* **Permissão:** `appointments:read`.
* **Query Params:** `?startDate=2026-09-01&endDate=2026-09-30&professionalId=<uuid>&status=CONFIRMED&limit=50&cursor=<uuid>`. `startDate` e `endDate` são datas locais inclusivas no fuso IANA da clínica; o intervalo máximo é de 31 dias. `limit` varia de 1 a 100 (padrão 50).
* **Ordenação e paginação:** ordem estável por `scheduledAt` e `id`, ambos crescentes. `nextCursor` é `null` na última página.
* **Respostas:** `200 OK` (`{ "timeZone": "America/Fortaleza", "appointments": [{ "id": "...", "patientId": "...", "professionalId": "...", "scheduledAt": "2026-09-01T12:00:00.000Z", "localScheduledAt": "2026-09-01T09:00:00", "durationMinutes": 30, "status": "CONFIRMED" }], "nextCursor": null }`). Observações não são expostas nesta listagem operacional.
* Cada item inclui `version`, usada pelo cliente para alterações concorrentes.

#### `GET /organizations/:orgSlug/appointments/availability`
* **Descrição:** Lista slots livres do profissional na data local solicitada. Usa a grade semanal da clínica e exclui pausas do profissional e agendamentos `RESERVED` ou `CONFIRMED` que se sobreponham ao slot.
* **Permissão:** `appointments:read`.
* **Query Params:** `?date=2026-09-01&professionalId=<uuid>`.
* **Respostas:** `200 OK` (`{ "date": "2026-09-01", "professionalId": "...", "timeZone": "America/Fortaleza", "slots": [{ "startsAt": "2026-09-01T12:00:00.000Z", "endsAt": "2026-09-01T12:30:00.000Z", "localStartsAt": "2026-09-01T09:00:00", "localEndsAt": "2026-09-01T09:30:00" }] }`), `404 NOT_FOUND` para profissional sem vínculo clínico ativo na organização.

#### `POST /organizations/:orgSlug/appointments`
* **Descrição:** Reserva um horário na agenda para um paciente com proteção contra dupla reserva concorrente. Valida que o paciente pertence à clínica ativa, que o profissional possui vínculo clínico ativo (`PROFESSIONAL` ou `ADMIN_PROFESSIONAL`) na clínica, que o intervalo `[scheduledAt, scheduledAt + durationMinutes)` cabe na grade semanal (`WeeklyScheduleRule`) no fuso da clínica, e que não há sobreposição com pausas (`ProfessionalSchedulePause`) nem com agendamentos ativos (`RESERVED` ou `CONFIRMED`).
* **Permissão:** `appointments:write`.
* **Cabeçalho Obrigatório:** `Idempotency-Key`
* **Body:** `{ "patientId": "<uuid>", "professionalId": "<uuid>", "scheduledAt": "2026-10-12T11:00:00.000Z", "durationMinutes": 30, "notes": "Consulta de rotina" }` (`notes` é opcional).
* **Respostas:**
  * `201 Created`: `{ "timeZone": "America/Fortaleza", "appointment": { "id": "...", "patientId": "...", "professionalId": "...", "scheduledAt": "2026-10-12T11:00:00.000Z", "endsAt": "2026-10-12T11:30:00.000Z", "localScheduledAt": "2026-10-12T08:00:00", "localEndsAt": "2026-10-12T08:30:00", "durationMinutes": 30, "status": "RESERVED", "notes": "Consulta de rotina", "createdAt": "..." } }`. Repetir o mesmo payload com a mesma `Idempotency-Key` retorna o agendamento original sem duplicar.
  * `404 NOT_FOUND`: paciente ou profissional não pertence à clínica ativa (ou vínculo do profissional não é clínico ativo).
  * `409 SLOT_CONFLICT`: horário indisponível ou em conflito, com `details` contendo `reason` (`APPOINTMENT_OVERLAP`, `SCHEDULE_PAUSE` ou `OUTSIDE_WORKING_HOURS`), `professionalId`, `requestedStartsAt`, `requestedEndsAt` e os limites do bloqueio conflitante (`conflictingStartsAt`, `conflictingEndsAt`, `conflictingAppointmentId`).
  * `409 IDEMPOTENCY_CONFLICT`: reutilização da mesma `Idempotency-Key` com payload diferente.

#### `PATCH /organizations/:orgSlug/appointments/:appointmentId`
* **Descrição:** Atualiza parcialmente paciente, profissional, horário, duração ou observações de um agendamento `RESERVED` ou `CONFIRMED`. Revalida vínculo clínico, escala, pausas e colisões quando a agenda muda. A alteração e o registro de auditoria `APPOINTMENT_UPDATED` são atômicos.
* **Permissão:** `appointments:write`.
* **Body:** `{ "version": 0, "scheduledAt": "2026-10-12T12:00:00.000Z", "notes": "Retorno" }`. `version` e ao menos um campo alterado são obrigatórios; campos permitidos: `patientId`, `professionalId`, `scheduledAt`, `durationMinutes`, `notes` (inclusive `null`).
* **Respostas:** `200 OK` (`{ "appointment": { "id": "...", "patientId": "...", "professionalId": "...", "scheduledAt": "...", "durationMinutes": 30, "status": "RESERVED", "notes": "Retorno", "version": 1, "updatedAt": "..." } }`), `404 NOT_FOUND` para agendamento/paciente/profissional fora da clínica, `409 VERSION_CONFLICT` para versão obsoleta, `409 SLOT_CONFLICT` para horário indisponível, `409 INVALID_STATE_TRANSITION` para agendamento terminal.

#### `POST /organizations/:orgSlug/appointments/:appointmentId/cancel`
* **Descrição:** Cancela um agendamento ativo, preservando o registro e liberando imediatamente o horário. A justificativa (10 a 500 caracteres após remover espaços nas extremidades), o autor e o instante são persistidos com a mudança de status e a auditoria `APPOINTMENT_CANCELLED` na mesma transação. Agendamentos `CANCELLED`, `COMPLETED` ou `NO_SHOW` não aceitam cancelamento.
* **Permissão:** `appointments:write`.
* **Body:** `{ "cancellationReason": "Paciente informou imprevisto de trabalho", "version": 0 }`, com a versão atual do agendamento.
* **Respostas:** `200 OK` (`{ "status": "CANCELLED", "cancellationReason": "...", "cancelledAt": "...", "cancelledById": "...", "version": 1 }`), `400 VALIDATION_ERROR` para justificativa ausente/inválida, `404 NOT_FOUND` para outra clínica, `409 INVALID_STATE_TRANSITION` para status terminal, `409 VERSION_CONFLICT` para edição concorrente.

#### `GET /organizations/:orgSlug/reception/queue` (alias: `GET /organizations/:orgSlug/appointments/queue`)
* **Descrição:** Lista a fila operacional da recepção da clínica para uma data local no fuso configurado (padrão: hoje na clínica), ordenada por `scheduledAt` e `id`, excluindo agendamentos `CANCELLED`.
* **Permissão:** `reception:read` (`ADMIN`, `ADMIN_PROFESSIONAL`, `PROFESSIONAL`, `RECEPTIONIST`).
* **Query Params:** `?date=2026-10-12&professionalId=<uuid>&queueStatus=WAITING|ARRIVED|CALLED|IN_SERVICE|COMPLETED|NO_SHOW` (`status` aceito como alias de `queueStatus`).
* **Respostas:** `200 OK` (`{ "date": "2026-10-12", "timeZone": "America/Fortaleza", "queue": [ { "id": "...", "appointmentId": "...", "patientId": "...", "professionalId": "...", "scheduledAt": "2026-10-12T11:00:00.000Z", "localScheduledAt": "2026-10-12T08:00:00", "durationMinutes": 30, "status": "CONFIRMED", "queueStatus": "ARRIVED", "arrivedAt": "2026-10-12T10:50:00.000Z", "queueUpdatedAt": "2026-10-12T10:50:00.000Z", "queueUpdatedById": "...", "version": 1 } ] }`), `400 VALIDATION_ERROR`, `401 UNAUTHENTICATED`, `403 MEMBERSHIP_INACTIVE`, `403 PERMISSION_DENIED`, `404 NOT_FOUND`.

#### `PATCH /organizations/:orgSlug/reception/queue/:appointmentId` (aliases: `PATCH /organizations/:orgSlug/appointments/:appointmentId/queue`, `PATCH /organizations/:orgSlug/appointments/:appointmentId/arrival`, `PATCH|POST /organizations/:orgSlug/appointments/:appointmentId/reception-status`)
* **Descrição:** Registra a chegada e transiciona o estado operacional do agendamento na fila da recepção, gravando autor (`queueUpdatedById`), horário (`arrivedAt`, `queueUpdatedAt`), incremento de versão (`version`) e evento `RECEPTION_QUEUE_UPDATED` em `AuditLog` na mesma transação.
* **Máquina de estados:**
  * `WAITING` → `ARRIVED`, `NO_SHOW`
  * `ARRIVED` → `CALLED`, `IN_SERVICE`, `NO_SHOW`
  * `CALLED` → `IN_SERVICE`, `NO_SHOW`
  * `IN_SERVICE` → `COMPLETED`
  * `COMPLETED` e `NO_SHOW` são estados terminais (e sincronizam `Appointment.status` para `COMPLETED` ou `NO_SHOW`); agendamentos `CANCELLED` não aceitam transições na fila.
* **Permissão:** `reception:write` (`ADMIN`, `ADMIN_PROFESSIONAL`, `RECEPTIONIST`).
* **Body:** `{ "status": "ARRIVED", "version": 0 }` (ou `{ "queueStatus": "ARRIVED", "version": 0 }`).
* **Respostas:** `200 OK` com o item atualizado da fila e `version` incrementado; `400 VALIDATION_ERROR`; `403 MEMBERSHIP_INACTIVE`; `403 PERMISSION_DENIED`; `404 NOT_FOUND`; `409 INVALID_STATE_TRANSITION` (com `details: { from, to, allowedTransitions }`); `409 VERSION_CONFLICT` quando `version` estiver desatualizada ou houver atualização concorrente.

#### `GET /organizations/:orgSlug/confirmations/pending` (alias: `GET /organizations/:orgSlug/appointments/confirmations/pending`)
* **Descrição:** Lista as pendências de confirmação da clínica ativa que exigiram contato humano (ex: resposta ambígua no WhatsApp ou falta de resposta). Quando resolvidas como `CONFIRMED` ou `DECLINED`, saem imediatamente da fila padrão (`status=PENDING`).
* **Permissão:** `reception:read`.
* **Query Params:** `?status=PENDING|CONFIRMED|DECLINED&professionalId=<uuid>&limit=20&cursor=<uuid>` (padrão `status=PENDING`, `limit=20`).
* **Respostas:** `200 OK` (`{ "timeZone": "America/Fortaleza", "data": [{ "id": "...", "appointmentId": "...", "organizationId": "...", "patientId": "...", "professionalId": "...", "scheduledAt": "...", "localScheduledAt": "...", "durationMinutes": 30, "appointmentStatus": "RESERVED", "status": "PENDING", "decision": "PENDING", "origin": null, "source": null, "originalMessage": "...", "originalMessageId": "...", "originalMessageAt": "...", "note": null, "decidedById": null, "decidedAt": null, "createdAt": "...", "updatedAt": "..." }], "pageInfo": { "nextCursor": null, "hasNextPage": false } }`), `400 VALIDATION_ERROR`, `401 UNAUTHENTICATED`, `403 MEMBERSHIP_INACTIVE`, `403 PERMISSION_DENIED`, `404 NOT_FOUND`.

#### `POST /organizations/:orgSlug/confirmations/:appointmentId/decision` (aliases: `PATCH` e `POST /organizations/:orgSlug/appointments/:appointmentId/confirmation`)
* **Descrição:** Registra uma decisão manual de confirmação (`CONFIRMED`, `DECLINED` ou `PENDING`) com origem (`PHONE_CALL`, `WHATSAPP_MANUAL`, `IN_PERSON` ou `OTHER`), autor (`decidedById`), horário (`decidedAt`) e trilha de auditoria (`MANUAL_CONFIRMATION_DECIDED`) na mesma transação. Atualiza o `status` do agendamento vinculado (`CONFIRMED` ou `CANCELLED`), preserva o texto e metadados da mensagem original inalterados e não dispara nenhuma mensagem automática.
* **Permissão:** `reception:write` (`RECEPTIONIST`, `ADMIN` e `ADMIN_PROFESSIONAL`).
* **Cabeçalho Opcional:** `Idempotency-Key` (8 a 128 caracteres).
* **Body:** `{ "decision": "CONFIRMED" | "DECLINED" | "PENDING", "origin": "PHONE_CALL" | "WHATSAPP_MANUAL" | "IN_PERSON" | "OTHER", "note": "Confirmado por ligação" }` (`source` também é aceito como alias de `origin`).
* **Idempotência:** Repetir a mesma decisão (com a mesma `Idempotency-Key` ou já no mesmo estado) retorna `200 OK` com o registro existente sem criar outra decisão, sem duplicar `AuditLog` e sem enviar mensagens. Reutilizar a mesma `Idempotency-Key` com dados divergentes retorna `409 IDEMPOTENCY_CONFLICT`.
* **Respostas:** `200 OK` (`{ "confirmation": { ... } }`), `400 VALIDATION_ERROR`, `401 UNAUTHENTICATED`, `403 MEMBERSHIP_INACTIVE`, `403 PERMISSION_DENIED`, `404 NOT_FOUND`, `409 IDEMPOTENCY_CONFLICT`, `422 BUSINESS_RULE_VIOLATION`.

---

### Módulo 7: Consultas Clínicas, Áudio & Anamnese

#### `GET /organizations/:orgSlug/professionals/:professionalId/anamnesis-topics`
* **Descrição:** Lista a configuração de tópicos do próprio profissional, na ordem de apresentação. Antes da primeira configuração retorna `version: 0`, `revisionId: null` e `topics: []`.
* **Permissão:** Vínculo ativo `PROFESSIONAL` ou `ADMIN_PROFESSIONAL` do próprio `professionalId`. Administrador sem papel clínico e acesso a outro profissional recebem `403 PERMISSION_DENIED`.
* **Resposta:** `200 OK` com `{ "professionalId": "uuid", "version": 1, "revisionId": "uuid", "topics": [{ "key": "history", "label": "Histórico", "active": true, "required": false, "order": 0 }] }`.

#### `PUT /organizations/:orgSlug/professionals/:professionalId/anamnesis-topics`
* **Descrição:** Substitui a lista ordenada e cria uma revisão imutável. A posição no array define a ordem. Chaves novas são opcionais; tópicos marcados como obrigatórios em uma revisão anterior não podem ser removidos nem desativados. A classificação obrigatória é controlada pelo sistema, não pelo payload.
* **Permissão:** A mesma da leitura.
* **Body:** `{ "version": 1, "topics": [{ "key": "history", "label": "Histórico", "active": true }] }`. `version` é a versão atual esperada, para evitar perda de alterações concorrentes. Máximo de 50 tópicos, chaves únicas.
* **Respostas:** `200 OK` com a nova versão e `revisionId`; `400 VALIDATION_ERROR` para lista inválida ou retirada de obrigatório; `409 VERSION_CONFLICT` para versão desatualizada.

O identificador `revisionId` da versão vigente deve ser armazenado pela futura criação de anamnese. Esta rota de tópicos não altera anamneses existentes.
*(Ref: Issues [#195](https://github.com/Flowcare-team/flowcare-monorepo/issues/195), [#262](https://github.com/Flowcare-team/flowcare-monorepo/issues/262)–[#267](https://github.com/Flowcare-team/flowcare-monorepo/issues/267))*

#### `GET /organizations/:orgSlug/consultations`
* **Descrição:** Lista os atendimentos clínicos da clínica ativa com paginação (por cursor ou página) e filtros combináveis por período (`startDate`, `endDate` no fuso horário da clínica), profissional (`professionalId`), paciente (`patientId`), busca textual pelo nome do paciente (`search` ou `q`, insensível a caixa e acentuação), status do atendimento (`SCHEDULED`, `IN_PROGRESS`, `COMPLETED`, `CANCELLED`) e status da anamnese (`PENDING`, `DRAFT`, `APPROVED`), ordenados por `scheduledAt` e `id` decrescentes.
* **Permissão:** `consultations:read` (`PROFESSIONAL` e `ADMIN_PROFESSIONAL`). Papéis `RECEPTIONIST` e `ADMIN` sem atuação clínica recebem `403 PERMISSION_DENIED`.
* **Query Params:** `?startDate=2026-10-01&endDate=2026-10-31&professionalId=<uuid>&patientId=<uuid>&status=SCHEDULED|IN_PROGRESS|COMPLETED|CANCELLED&anamnesisStatus=PENDING|DRAFT|APPROVED&search=joao&limit=20&page=1&cursor=<uuid>` (`limit` de 1 a 100, padrão 20).
* **Respostas:** `200 OK` (`{ "timeZone": "America/Fortaleza", "data": [{ "id": "...", "appointmentId": "...", "patientId": "...", "professionalId": "...", "scheduledAt": "2026-10-12T13:00:00.000Z", "localScheduledAt": "2026-10-12T10:00:00", "startedAt": null, "completedAt": null, "status": "SCHEDULED", "anamnesisStatus": "PENDING", "patient": { "id": "...", "fullName": "João Carlos Oliveira" }, "professional": { "id": "...", "fullName": "Dr. Bruno Lima", "professionalTitle": "Médico Clínico", "registrationNumber": "CRM/CE 67890" }, "version": 0, "createdAt": "...", "updatedAt": "..." }], "items": [...], "pageInfo": { "limit": 20, "page": 1, "totalCount": 1, "hasNextPage": false, "nextCursor": null } }`), `400 VALIDATION_ERROR`, `401 UNAUTHENTICATED`, `403 MEMBERSHIP_INACTIVE`, `403 PERMISSION_DENIED`, `404 NOT_FOUND`.

#### `POST /organizations/:orgSlug/consultations` (alias: `POST /organizations/:orgSlug/consultations/start`)
* **Descrição:** Inicia uma nova consulta clínica vinculada a paciente e, opcionalmente, a um agendamento prévio (ou atendimento avulso/walk-in), prevenindo duplicidade de consultas para o mesmo agendamento e garantindo isolamento multi-tenant estrito. Caso já exista um atendimento ativo para o agendamento informado, a operação é idempotente e retorna o atendimento existente (`200 OK`) sem duplicar registros ou auditoria. Quando vinculado a um agendamento em estado `CONFIRMED` ou `RESERVED`, transiciona o agendamento para `IN_PROGRESS` (e fila para `IN_SERVICE`). Grava `CONSULTATION_STARTED` em `AuditLog` na mesma transação.
* **Permissão:** `consultations:write` (`PROFESSIONAL` e `ADMIN_PROFESSIONAL`). Papéis exclusivamente administrativos (`ADMIN` sem atuação clínica e `RECEPTIONIST`) são recusados com `403 PERMISSION_DENIED`.
* **Body:**
  ```json
  {
    "patientId": "<uuid>",
    "appointmentId": "<uuid opcional>",
    "scheduledAt": "2026-10-15T13:00:00.000Z",
    "notes": "Observações iniciais do atendimento",
    "professionalId": "<uuid opcional>"
  }
  ```
* **Validações e regras:**
  * O paciente deve pertencer à clínica ativa (`404 NOT_FOUND` se inexistente ou de outra clínica).
  * Se `appointmentId` for informado:
    * O agendamento deve pertencer à clínica ativa (`404 NOT_FOUND` se inexistente ou de outra clínica).
    * O `patientId` do agendamento deve coincidir com o `patientId` informado (`400 VALIDATION_ERROR` com `details.field: "patientId"`).
    * Se já existir consulta ativa para este agendamento, responde `200 OK` com o registro existente.
    * Agendamento em estado `CONFIRMED` ou `RESERVED` é atualizado para `status: "IN_PROGRESS"` (e `queueStatus: "IN_SERVICE"` caso esteja na fila).
  * O profissional responsável é o usuário autenticado (`auth.userId`), ou o profissional especificado caso possua vínculo clínico ativo na clínica.
  * Define `startedAt: new Date()`, `status: "IN_PROGRESS"`, `anamnesisStatus: "PENDING"`, `version: 0`.
  * Na mesma transação, registra `AuditLog` (`action: "CONSULTATION_STARTED"`, `targetType: "CONSULTATION"`, `targetId: consultation.id`, `metadata: { patientId, professionalId, appointmentId, notes }`).
* **Respostas:** `201 Created` (para novo atendimento) ou `200 OK` (caso já exista consulta ativa vinculada ao agendamento), `400 VALIDATION_ERROR`, `401 UNAUTHENTICATED`, `403 MEMBERSHIP_INACTIVE`, `403 PERMISSION_DENIED`, `404 NOT_FOUND`.

#### `GET /organizations/:orgSlug/consultations/:consultationId`
* **Descrição:** Retorna os detalhes completos do atendimento clínico na clínica ativa, incluindo identificadores, vínculos (`patient`, `professional`), status de atendimento e anamnese, versão, rascunho da anamnese (`chiefComplaint`, `clinicalNotes`, `anamnesisDraft`) e carimbos de data/hora no fuso da clínica.
* **Permissão:** `consultations:read` (`PROFESSIONAL` e `ADMIN_PROFESSIONAL`). Papéis `RECEPTIONIST` e `ADMIN` sem atuação clínica recebem `403 PERMISSION_DENIED`.
* **Respostas:** `200 OK` (`{ "id": "...", "consultationId": "...", "organizationId": "...", "appointmentId": "...", "patientId": "...", "professionalId": "...", "scheduledAt": "...", "localScheduledAt": "...", "startedAt": "...", "completedAt": null, "status": "IN_PROGRESS", "anamnesisStatus": "PENDING", "version": 0, "chiefComplaint": null, "clinicalNotes": null, "anamnesisDraft": {}, "draftSavedAt": null, "draftSavedById": null, "patient": { "id": "...", "fullName": "..." }, "professional": { "id": "...", "fullName": "...", "professionalTitle": "...", "registrationNumber": "..." }, "createdAt": "...", "updatedAt": "..." }`), `401 UNAUTHENTICATED`, `403 MEMBERSHIP_INACTIVE`, `403 PERMISSION_DENIED`, `404 NOT_FOUND` (atendimento inexistente ou de outra clínica).

#### `POST /organizations/:orgSlug/consultations/:consultationId/audio`
* **Descrição:** Registra o consentimento explícito e envia o áudio para armazenamento privado. Cria o processamento em estado `QUEUED` somente após o armazenamento concluir. O profissional deve ser o responsável pelo atendimento em andamento; paciente e atendimento pertencem à clínica ativa.
* **Permissão:** `consultations:write` e vínculo como profissional do atendimento.
* **Body:** `multipart/form-data` (`audioFile`, `consentConfirmed=true`). Aceita WebM, MPEG e MP4 até 50 MiB; assinatura real do arquivo e tipo declarado devem coincidir.
* **Respostas:** `200 OK` (`{ "audioId": "<uuid>", "status": "UPLOADED" }`), `400 VALIDATION_ERROR`, `403 PERMISSION_DENIED`, `404 NOT_FOUND`, `413 FILE_TOO_LARGE`, `422 BUSINESS_RULE_VIOLATION`, `503 STORAGE_UNAVAILABLE`.

#### `POST /organizations/:orgSlug/consultations/:consultationId/audio/upload-url`
* **Descrição:** Alternativa de envio direto ao armazenamento privado. Registra o consentimento e retorna URL PUT assinada por 600 segundos. Ainda não cria processamento. O cliente deve enviar o `Content-Type` e o tamanho declarados. A URL é sensível e não deve ser registrada em logs.
* **Body:** JSON `{ "contentType": "audio/webm", "sizeBytes": 1024, "consentConfirmed": true }`.
* **Respostas:** `200 OK` (`{ "audioId": "<uuid>", "uploadUrl": "<signed URL>", "expiresInSeconds": 600, "status": "PENDING_UPLOAD" }`).

#### `POST /organizations/:orgSlug/consultations/:consultationId/audio/:audioId/complete`
* **Descrição:** Confirma o envio privado. O servidor lê o objeto, confere tamanho, tipo declarado e assinatura real e o copia para uma chave privada distinta antes de marcar `UPLOADED` e criar um único processamento `QUEUED`. A URL PUT antiga não permite alterar o áudio confirmado. Sem objeto, arquivo inválido ou URL expirada não há processamento. Repetição após sucesso é idempotente.
* **Respostas:** `200 OK` (`{ "audioId": "<uuid>", "status": "UPLOADED" }`), `400 VALIDATION_ERROR`, `403 PERMISSION_DENIED`, `404 NOT_FOUND`, `422 BUSINESS_RULE_VIOLATION`.

#### `POST /organizations/:orgSlug/consultations/:consultationId/transcribe`
* **Descrição:** Dispara a transcrição do áudio e a estruturação automática da minuta de anamnese. O áudio é enviado ao provedor por URL assinada e temporária; o texto integral é persistido no job e os tópicos extraídos são gravados em `anamnesisDraft` (somente quando a anamnese ainda está `PENDING`, nunca sobre rascunho editado ou anamnese aprovada). Com `SINTESEY_MODE=mock` o provedor é simulado.
* **Permissão:** `consultations:write`.
* **Cabeçalho Obrigatório:** `Idempotency-Key`
* **Respostas:** `202 Accepted` (`{ "jobId": "job_tx_88", "status": "PROCESSING" }`), `403 PERMISSION_DENIED`, `404 NOT_FOUND`, `422 BUSINESS_RULE_VIOLATION` (sem áudio com consentimento).

#### `GET /organizations/:orgSlug/consultations/:consultationId/transcription`
* **Descrição:** Consulta o job de transcrição mais recente da consulta. É o endpoint de polling da interface: devolve o estado atual e, quando `COMPLETED`, o texto integral para conferência antes da aprovação da anamnese.
* **Permissão:** `consultations:read`.
* **Respostas:** `200 OK` (`{ "jobId": "<uuid>", "status": "QUEUED|PROCESSING|COMPLETED|FAILED", "text": "…"|null, "error": null|"motivo da falha" }`), `403 PERMISSION_DENIED`, `404 NOT_FOUND` (consulta inexistente ou nenhuma transcrição solicitada).

#### `PATCH /organizations/:orgSlug/consultations/:consultationId/draft`
* **Descrição:** Salva edições no rascunho da anamnese médica com controle de versão e concorrência otimista. Possui aliases em `PUT /organizations/:orgSlug/consultations/:consultationId/draft` e `PATCH`/`PUT /organizations/:orgSlug/consultations/:consultationId/anamnesis/draft`.
* **Permissão:** `consultations:write` (`ADMIN`, `ADMIN_PROFESSIONAL`, `PROFESSIONAL` autorizados/atribuídos).
* **Body:** `{ "version": 3, "chiefComplaint": "Dor de cabeça persistente", "clinicalNotes": "...", "topics": { "hda": "...", "antecedentes": "..." } }` (topics aceita objeto chave-valor ou lista `[{ "key": "...", "value": "..." }]`).
* **Respostas:** `200 OK` (dados da consulta atualizados com nova `version`, `anamnesisStatus: "DRAFT"`, `chiefComplaint`, `clinicalNotes`, `anamnesisDraft`), `400 VALIDATION_ERROR`, `401 UNAUTHENTICATED`, `403 PERMISSION_DENIED`, `404 NOT_FOUND`, `409 VERSION_CONFLICT`, `409 DOCUMENT_STATE_CONFLICT`.

#### `POST /organizations/:orgSlug/consultations/:consultationId/approve`
* **Descrição:** Conclui e aprova a versão final da anamnese com validação de tópicos obrigatórios, gerando snapshot imutável com carimbo de tempo, autoria clínica e hash SHA-256. Possui aliases em `PUT /organizations/:orgSlug/consultations/:consultationId/approve` e `POST`/`PUT /organizations/:orgSlug/consultations/:consultationId/anamnesis/approve`.
* **Permissão:** `consultations:approve` (`PROFESSIONAL` atribuído ou `ADMIN_PROFESSIONAL`).
* **Body:** `{ "version": 4, "chiefComplaint"?: "...", "clinicalNotes"?: "...", "topics"?: ... }`
* **Respostas:** `200 OK` (`{ "status": "APPROVED", "signedBy": "CRM/SP 123456", "approvedAt": "...", "consultationId": "...", "version": 5, "snapshotHash": "sha256_...", "snapshot": { ... }, "consultation": { ... } }`), `400 VALIDATION_ERROR` (se tópicos obrigatórios estiverem em branco), `401 UNAUTHENTICATED`, `403 PERMISSION_DENIED`, `404 NOT_FOUND`, `409 VERSION_CONFLICT`, `409 DOCUMENT_STATE_CONFLICT`.

---

### Módulo 8: Documentos Clínicos, Versionamento & Anulação
*(Ref: Issues [#195](https://github.com/Flowcare-team/flowcare-monorepo/issues/195), [#273](https://github.com/Flowcare-team/flowcare-monorepo/issues/273)–[#278](https://github.com/Flowcare-team/flowcare-monorepo/issues/278))*

**Decisão do MVP:** ver [ciclo de vida e snapshot](DOCUMENTS_MVP.md). Receitas controladas e assinatura eletrônica não fazem parte do MVP. `ISSUED` indica PDF final para impressão e assinatura manuscrita, não documento eletrônico assinado. As rotas de criação, leitura, edição de rascunho, histórico de revisões (`#273`) e preparação de snapshot de emissão (`#274`) estão implementadas. A transição de emissão e o início de retificação (`#275`) exigem a integração do renderizador e armazenamento privado de PDF (`#276`) para concluir uma emissão; sem essa integração a emissão retorna `503 STORAGE_UNAVAILABLE` e o documento continua `DRAFT`. A anulação formal de documento emitido com justificativa obrigatória e registro imutável (`#278`) está implementada.

#### `GET /organizations/:orgSlug/documents`
* **Descrição:** Lista documentos clínicos da clínica ativa com paginação e filtros combináveis, sem expor o conteúdo clínico completo na listagem. Documentos de outras clínicas nunca são retornados. Quando disponíveis, `chainVersion` e `replacesDocumentId` identificam a versão formal e o documento anterior da cadeia de retificação.
* **Permissão:** `documents:read` (`PROFESSIONAL` e `ADMIN_PROFESSIONAL`).
* **Query Params:** `?patientId=<uuid>&type=PRESCRIPTION|CERTIFICATE|REPORT|EXAM_REQUEST&status=DRAFT|ISSUED|VOIDED&authorId=<uuid>&search=amoxicilina&q=amoxicilina&startDate=2026-10-01&endDate=2026-10-31&limit=20&page=1&cursor=<uuid>&order=desc|asc` (`limit` de 1 a 100, padrão 20; ordenação decrescente por `updatedAt` / `createdAt` por padrão).
* **Respostas:** `200 OK` (`{ "data": [ { "id": "...", "documentId": "...", "organizationId": "...", "patientId": "...", "authorId": "...", "templateId": "...", "templateVersion": 1, "type": "PRESCRIPTION", "title": "Receita Simples", "status": "DRAFT", "version": 1, "revisionId": "...", "currentRevisionId": "...", "patient": { "id": "...", "fullName": "..." }, "author": { "id": "...", "fullName": "..." }, "issuedAt": null, "voidedAt": null, "createdAt": "...", "updatedAt": "..." } ], "documents": [...], "pageInfo": { "limit": 20, "page": 1, "totalCount": 10, "hasNextPage": false, "nextCursor": null } }`), `400 VALIDATION_ERROR`, `401 UNAUTHENTICATED`, `403 MEMBERSHIP_INACTIVE`, `403 PERMISSION_DENIED`.

#### `GET /organizations/:orgSlug/documents/:documentId`
* **Descrição:** Consulta detalhes completos, estado, metadados do modelo utilizado (`templateId`, `templateVersion`), versão atual (`version`, `revisionId`), versão formal (`chainVersion`) e documento anterior da cadeia (`replacesDocumentId`), resumo de paciente e autor (`patient`, `author`) e histórico de revisões (`versions`) de um documento clínico da clínica ativa. Quando o parâmetro opcional `?version=<number>` é informado, retorna o snapshot e conteúdo daquela versão histórica específica.
* **Permissão:** `documents:read` (`PROFESSIONAL` e `ADMIN_PROFESSIONAL`).
* **Query Params:** `?version=1` (opcional, para consultar snapshot da versão histórica).
* **Respostas:** `200 OK` (`{ "id", "documentId", "organizationId", "patientId", "authorId", "templateId", "templateVersion", "type", "title", "content", "variables", "status", "version", "revisionId", "currentRevisionId", "patient": { "id", "fullName" }, "author": { "id", "fullName" }, "issuedAt", "voidedAt", "createdAt", "updatedAt", "versions": [...], "document": { ... } }`), `400 VALIDATION_ERROR`, `401 UNAUTHENTICATED`, `403 MEMBERSHIP_INACTIVE`, `403 PERMISSION_DENIED`, `404 NOT_FOUND` (documento inexistente ou pertencente a outra clínica).

#### `POST /organizations/:orgSlug/documents` (alias: `POST /organizations/:orgSlug/documents/drafts`)
* **Descrição:** Cria rascunho (`status: "DRAFT"`, `version: 1`) de receita simples (`PRESCRIPTION`), atestado (`CERTIFICATE`), laudo (`REPORT`) ou solicitação de exame (`EXAM_REQUEST`) vinculado a paciente da clínica ativa, autor (`authorId`) e opcionalmente a um modelo ativo (`templateId`, registrando `templateVersion`). Persiste a revisão inicial em `DocumentVersion` (`version: 1`) e registra `DOCUMENT_DRAFT_CREATED` em `AuditLog`. Receita controlada, documento livre/personalizado e modelos arquivados são recusados (`400 VALIDATION_ERROR`).
* **Permissão:** `documents:write` (`PROFESSIONAL` e `ADMIN_PROFESSIONAL`).
* **Body:** `{ "patientId": "<uuid>", "type": "PRESCRIPTION", "templateId": "<uuid opcional>", "title": "Receita Simples", "content": "...", "variables": { ... } }` (`body` também é aceito como alias de `content`; quando `templateId` é informado, `title` e `content` herdam o padrão do modelo caso omitidos).
* **Respostas:** `201 Created` (mesmo DTO de `GET /organizations/:orgSlug/documents/:documentId` com `status: "DRAFT"` e `version: 1`), `400 VALIDATION_ERROR`, `403 PERMISSION_DENIED`, `404 NOT_FOUND` (paciente ou modelo de outra clínica/inexistente).

#### `PATCH /organizations/:orgSlug/documents/:documentId` (aliases: `PUT /organizations/:orgSlug/documents/:documentId`, `PATCH/PUT .../documents/:documentId/draft`)
* **Descrição:** Atualiza um documento **enquanto ele estiver em rascunho** (`DRAFT`) com controle de concorrência otimista (`version`). Cada salvamento incrementa `version`, persiste uma nova revisão intermediária imutável em `DocumentVersion` (`revisionId`) e registra `DOCUMENT_DRAFT_UPDATED` em `AuditLog`. Documentos `ISSUED` ou `VOIDED` são rejeitados sem alteração.
* **Permissão:** `documents:write` (`PROFESSIONAL` e `ADMIN_PROFESSIONAL`).
* **Body:** `{ "version": 1, "title": "...", "content": "Novo texto...", "templateId": "<uuid|null>", "variables": { ... } }` (exige `version` e ao menos um campo editável).
* **Respostas:** `200 OK` (DTO atualizado com `version: 2`, novo `revisionId` e lista `versions` atualizada), `400 VALIDATION_ERROR`, `403 PERMISSION_DENIED`, `404 NOT_FOUND`, `409 DOCUMENT_STATE_CONFLICT` (quando `status !== "DRAFT"`), `409 VERSION_CONFLICT` (quando `version` diverge da versão atual).

#### `POST /organizations/:orgSlug/documents/:documentId/snapshot` (alias: `POST /organizations/:orgSlug/documents/:documentId/prepare`)
* **Descrição:** Valida os campos e variáveis dinâmicas contra o catálogo homologado (`APPROVED_TEMPLATE_VARIABLES`), resolve as variáveis automáticas da clínica (`clinica_nome`, `clinica_cnpj`, `clinica_endereco`, `clinica_telefone`), paciente (`paciente_nome`, `paciente_cpf`, `paciente_data_nascimento`), profissional (`profissional_nome`, `profissional_registro`, `profissional_crm`, `medico_nome`, `medico_crm`, `profissional_titulo`) e data de emissão (`data_emissao`, `data_atual`, `data_hora_emissao`), congela o conteúdo renderizado e o dicionário de variáveis em uma nova revisão imutável em `DocumentVersion`, incrementa a versão do documento (`version + 1`) e registra `DOCUMENT_SNAPSHOT_PREPARED` em `AuditLog` na mesma transação. Alterações futuras no paciente, na clínica ou no modelo de documento não alteram o snapshot congelado. Variáveis opcionais vazias não aparecem no snapshot e seus marcadores são removidos do texto. Documentos fora de `DRAFT` não aceitam novo snapshot (`409 DOCUMENT_NOT_EDITABLE`). Receita controlada e documento livre/personalizado são recusados (`422 BUSINESS_RULE_VIOLATION`).
* **Permissão:** `documents:write` (`PROFESSIONAL` e `ADMIN_PROFESSIONAL`).
* **Body (opcional):** `{ "version": 1, "type": "PRESCRIPTION", "variables": { ... } }` (quando informado, `version` é validado contra a versão atual do documento para proteção de concorrência).
* **Respostas:** `200 OK` (DTO do documento contendo o bloco `snapshot: { documentId, version, revisionId, type, title, content, variables, preparedAt }`, lista `versions` atualizada e `version` incrementado), `400 VALIDATION_ERROR`, `403 PERMISSION_DENIED`, `404 NOT_FOUND` (documento ou paciente inexistente ou pertencente a outra clínica), `409 DOCUMENT_NOT_EDITABLE` (quando `status !== "DRAFT"`), `409 VERSION_CONFLICT` (quando `version` enviada diverge da versão atual), `422 VALIDATION_ERROR` (campos obrigatórios ausentes com `details.missingFields`), `422 INVALID_VARIABLES` (variáveis fora do catálogo homologado com `details.invalidVariables`), `422 BUSINESS_RULE_VIOLATION` (tipo de documento não suportado no MVP de emissão com `details.reason: "UNSUPPORTED_DOCUMENT_TYPE"`).

#### `POST /organizations/:orgSlug/documents/:documentId/issue`
* **Descrição:** Finaliza o documento preparado com snapshot imutável e PDF confirmado para impressão e assinatura manuscrita; não assina eletronicamente. A repetição de uma emissão já concluída devolve a mesma emissão, sem nova versão ou auditoria. Exige que a revisão atual seja a revisão preparada; qualquer edição posterior exige nova preparação. `chainVersion` identifica a versão formal da cadeia documental e não a revisão intermediária do rascunho.
* **Permissão:** `documents:issue`.
* **Body:** `{ "version": 2 }`
* **Respostas:** `200 OK` (`{ "status": "ISSUED", "issuedAt": "...", "snapshotHash": "sha256_...", "chainVersion": 1, "replacesDocumentId": null }`), `409 DOCUMENT_STATE_CONFLICT`, `422 BUSINESS_RULE_VIOLATION` (snapshot obrigatório ausente), `503 STORAGE_UNAVAILABLE` (PDF indisponível). Uma falha de PDF não conclui a emissão.

#### `POST /organizations/:orgSlug/documents/:documentId/rectify`
* **Descrição:** Cria novo rascunho vinculado a um documento `ISSUED`, clonando o snapshot preparado e preservando o original. A emissão do novo rascunho recebe a próxima versão da cadeia. O rascunho retificador deve passar pela preparação de snapshot antes da emissão. Só uma retificação direta por documento é permitida.
* **Permissão:** `documents:write`.
* **Respostas:** `201 Created` (`{ "documentId": "...", "status": "DRAFT", "replacesDocumentId": "...", "chainVersion": 2 }`), `409 DOCUMENT_STATE_CONFLICT`.

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
* **Descrição:** Retorna a trilha de histórico ordenada de todas as revisões intermediárias e versões salvas do documento (`DocumentVersion`) com dados de autoria de salvamento (`savedBy`) e indicação da versão ativa (`isActiveVersion`).
* **Permissão:** `documents:read` (`PROFESSIONAL` e `ADMIN_PROFESSIONAL`).
* **Query Params:** `?order=asc|desc` (ordenação cronológica ascendente por padrão ou descendente `desc`), `?version=<number>` (filtro opcional por versão).
* **Respostas:** `200 OK` (`{ "documentId": "...", "currentVersion": 3, "currentRevisionId": "...", "status": "DRAFT", "data": [ { "id": "...", "revisionId": "...", "documentId": "...", "version": 1, "title": "...", "content": "...", "variables": {}, "templateId": "...", "templateVersion": 1, "savedById": "...", "savedBy": { "id": "...", "fullName": "..." }, "isActiveVersion": false, "createdAt": "..." } ], "versions": [...] }`), `403 PERMISSION_DENIED`, `404 NOT_FOUND`.

#### `GET /organizations/:orgSlug/documents/:documentId/versions/:versionId`
* **Descrição:** Consulta o snapshot histórico imutável autorizado de uma revisão específica por UUID da revisão (`revisionId`) ou pelo número da versão (`1`, `2`, `3`...). Garante que o conteúdo e variáveis congelados na revisão histórica permaneçam íntegros mesmo após edições subsequentes do documento.
* **Permissão:** `documents:read` (`PROFESSIONAL` e `ADMIN_PROFESSIONAL`).
* **Respostas:** `200 OK` (`{ "id": "...", "revisionId": "...", "documentId": "...", "organizationId": "...", "version": 1, "title": "...", "content": "...", "variables": {}, "templateId": "...", "templateVersion": 1, "savedById": "...", "savedBy": { "id": "...", "fullName": "..." }, "isActiveVersion": false, "createdAt": "...", "snapshot": { "version": 1, "title": "...", "content": "...", "variables": {}, "templateId": "...", "templateVersion": 1, "savedBy": { ... }, "createdAt": "..." } }`), `403 PERMISSION_DENIED`, `404 NOT_FOUND` (documento ou versão inexistente ou pertencente a outra clínica).

---

### Módulo 9: Modelos de Documentos
*(Ref: Issues [#287](https://github.com/Flowcare-team/flowcare-monorepo/issues/287)–[#290](https://github.com/Flowcare-team/flowcare-monorepo/issues/290))*

#### `GET /organizations/:orgSlug/templates` (alias: `GET /organizations/:orgSlug/document-templates`)
* **Descrição:** Lista os modelos de documentos clínicos pertencentes à clínica ativa e os modelos globais homologados (`organizationId: null`), com filtros por tipo, estado, versão, busca textual e seleção para novas emissões. Modelos de outras clínicas nunca são retornados.
* **Permissão:** `templates:read` (`PROFESSIONAL` e `ADMIN_PROFESSIONAL`).
* **Query Params:** `?type=PRESCRIPTION|CERTIFICATE|REPORT|EXAM_REQUEST&status=ACTIVE|ARCHIVED&version=1&selectableOnly=true&includeArchived=true&search=atestado&limit=20&cursor=<uuid>`
  * Quando `selectableOnly=true` ou `includeArchived=false`, modelos `ARCHIVED` são excluídos para impedir seu uso em novas emissões.
  * Na listagem geral/histórico, modelos `ARCHIVED` permanecem visíveis com `selectable: false` e `archivedAt` preenchido.
* **Respostas:**
  * `200 OK`:
    ```json
    {
      "data": [
        {
          "id": "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2",
          "organizationId": "11111111-1111-4111-8111-111111111111",
          "scope": "ORGANIZATION",
          "isGlobal": false,
          "title": "Atestado 3 Dias",
          "type": "CERTIFICATE",
          "bodyTemplate": "Atesto para os devidos fins que {paciente_nome}...",
          "status": "ACTIVE",
          "version": 1,
          "selectable": true,
          "archivedAt": null,
          "createdAt": "2026-10-02T10:00:00.000Z",
          "updatedAt": "2026-10-02T10:00:00.000Z"
        }
      ],
      "pageInfo": {
        "nextCursor": null,
        "hasNextPage": false
      }
    }
    ```
  * `400 VALIDATION_ERROR`, `401 UNAUTHENTICATED`, `403 MEMBERSHIP_INACTIVE`, `403 PERMISSION_DENIED`, `404 NOT_FOUND`.

#### `GET /organizations/:orgSlug/templates/variables` e `GET /templates/variables`
* **Descrição:** Retorna o catálogo estruturado de variáveis dinâmicas homologadas suportadas pela aplicação (ex: `{paciente_nome}`, `{paciente_cpf}`, `{clinica_nome}`, `{profissional_nome}`, `{data_atual}`), com chave, placeholder, rótulo, descrição, tipo, categoria (`PATIENT`, `CLINIC`, `PROFESSIONAL`, `DOCUMENT`), obrigatoriedade, origem e exemplo.
* **Permissão:** `templates:read` na rota organizacional (`/organizations/:orgSlug/templates/variables`) e sessão autenticada na rota global (`/templates/variables`).
* **Respostas:** `200 OK` (`{ "data": [ { "key": "paciente_nome", "placeholder": "{paciente_nome}", "label": "Nome do paciente", "description": "...", "type": "string", "category": "PATIENT", "required": true, "source": "patient.fullName", "example": "Maria da Silva" } ] }`), `401 UNAUTHENTICATED`, `403 PERMISSION_DENIED`, `404 NOT_FOUND`.

#### `GET /organizations/:orgSlug/templates/:templateId` (alias: `GET /organizations/:orgSlug/document-templates/:templateId`) e `GET /organizations/:orgSlug/templates/:templateId/versions/:version`
* **Descrição:** Consulta o modelo de documento clínico atual da clínica ativa (ou global homologado) ou uma versão histórica específica (`?version=<number>` ou `/versions/:version`) preservada em `DocumentTemplateVersion`, garantindo que versões antigas em uso por documentos existentes permaneçam imutáveis e legíveis após novas edições.
* **Permissão:** `templates:read` (`PROFESSIONAL` e `ADMIN_PROFESSIONAL`).
* **Respostas:** `200 OK` (objeto do modelo contendo `id`, `organizationId`, `scope`, `isGlobal`, `title`, `type`, `bodyTemplate`, `status`, `version`, `selectable`, `archivedAt`, `createdAt`, `updatedAt`, `variables` e `template`), `404 NOT_FOUND`.

#### `GET /organizations/:orgSlug/templates/:templateId/versions` (alias: `GET /organizations/:orgSlug/document-templates/:templateId/versions`)
* **Descrição:** Lista todas as versões históricas imutáveis (`DocumentTemplateVersion`) de um modelo de documento em ordem crescente de `version`.
* **Permissão:** `templates:read` (`PROFESSIONAL` e `ADMIN_PROFESSIONAL`).
* **Respostas:** `200 OK` (`{ "data": [...], "versions": [ { "id": "...", "templateId": "...", "organizationId": "...", "version": 1, "title": "...", "type": "CERTIFICATE", "bodyTemplate": "...", "variables": ["paciente_nome"], "createdById": "...", "createdAt": "..." } ] }`), `404 NOT_FOUND`.

#### `POST /organizations/:orgSlug/templates/preview` (alias: `POST /organizations/:orgSlug/document-templates/preview`)
* **Descrição:** Valida um modelo ainda não salvo e renderiza título e conteúdo apenas com os exemplos fictícios do catálogo de variáveis. A resposta traz `isExample: true`, marca `EXEMPLO — SEM VALIDADE CLÍNICA`, `variables` e `missingPlaceholders`. Não consulta pacientes, não gera PDF, não cria documento clínico ou evento de emissão e não persiste o modelo.
* **Permissão:** `templates:write` (`PROFESSIONAL` e `ADMIN_PROFESSIONAL`).
* **Body:** `{ "title": "Atestado para {paciente_nome}", "type": "CERTIFICATE", "bodyTemplate": "Atesto que {paciente_nome} foi atendida." }`.
* **Respostas:** `200 OK` (`{ "isExample": true, "watermark": "EXEMPLO — SEM VALIDADE CLÍNICA", "type": "CERTIFICATE", "title": "Atestado para Maria da Silva", "content": "Atesto que Maria da Silva foi atendida.", "variables": { "paciente_nome": "Maria da Silva" }, "missingPlaceholders": [] }`), `400 VALIDATION_ERROR`, `401 UNAUTHENTICATED`, `403 PERMISSION_DENIED`, `422 INVALID_TEMPLATE_STRUCTURE`, `422 INVALID_TEMPLATE_VARIABLE` (com `details.invalidVariables`).

#### `POST /organizations/:orgSlug/templates` (alias: `POST /organizations/:orgSlug/document-templates`)
* **Descrição:** Valida a estrutura e as variáveis dinâmicas (`{variavel}`) contra o catálogo homologado (`APPROVED_TEMPLATE_VARIABLES`), cria um novo modelo da clínica na versão `1` (`status: ACTIVE`), grava o snapshot inicial em `DocumentTemplateVersion` e registra `TEMPLATE_CREATED` em `AuditLog` na mesma transação.
* **Permissão:** `templates:write` (`PROFESSIONAL` e `ADMIN_PROFESSIONAL`).
* **Body:** `{ "title": "Atestado 3 Dias", "type": "CERTIFICATE", "bodyTemplate": "Atesto para os devidos fins que {paciente_nome}..." }`
* **Respostas:** `201 Created`, `400 VALIDATION_ERROR`, `403 PERMISSION_DENIED`, `422 INVALID_TEMPLATE_STRUCTURE`, `422 INVALID_TEMPLATE_VARIABLE` (com `details.invalidVariables` e `details.allowedVariables`).

#### `PATCH /organizations/:orgSlug/templates/:templateId` e `PUT /organizations/:orgSlug/templates/:templateId` (aliases em `/document-templates/:templateId`)
* **Descrição:** Valida a estrutura e as variáveis dinâmicas contra o catálogo homologado e salva uma nova versão do modelo da clínica com controle de concorrência otimista (`version`). Incrementa `version`, cria um novo registro imutável em `DocumentTemplateVersion` (preservando todas as versões anteriores inalteradas) e grava `TEMPLATE_UPDATED` em `AuditLog` na mesma transação. Modelos globais (`403 PERMISSION_DENIED`), arquivados (`409 INVALID_STATE_TRANSITION`) ou de outras clínicas (`404 NOT_FOUND`) não podem ser editados.
* **Permissão:** `templates:write` (`PROFESSIONAL` e `ADMIN_PROFESSIONAL`).
* **Body:** `{ "version": 1, "title": "Atestado 5 Dias", "type": "CERTIFICATE", "bodyTemplate": "Atesto que {paciente_nome}..." }` (`version` e ao menos um campo editável são obrigatórios).
* **Respostas:** `200 OK`, `400 VALIDATION_ERROR`, `403 PERMISSION_DENIED`, `404 NOT_FOUND`, `409 VERSION_CONFLICT` (edição concorrente / versão obsoleta), `409 INVALID_STATE_TRANSITION` (modelo arquivado), `422 INVALID_TEMPLATE_STRUCTURE`, `422 INVALID_TEMPLATE_VARIABLE`.

#### `POST /organizations/:orgSlug/document-templates/:templateId/archive`
* **Descrição:** Arquiva logicamente o modelo da clínica (`status: ARCHIVED`, `archivedAt`, `archivedById`) e grava `TEMPLATE_ARCHIVED` em `AuditLog` na mesma transação. Repetir o comando para um modelo já arquivado retorna sucesso sem nova auditoria. Modelos globais não podem ser arquivados pela clínica. Versões históricas e vínculos de documentos anteriores permanecem intactos; o modelo deixa de ser selecionável para novos documentos e não pode ser editado.
* **Permissão:** `templates:write`.
* **Respostas:** `200 OK` (`{ "archived": true }`).

---

### Módulo 10: Comunicações & Integração WhatsApp (WAHA)
*(Ref: Issues [#196](https://github.com/Flowcare-team/flowcare-monorepo/issues/196), [#295](https://github.com/Flowcare-team/flowcare-monorepo/issues/295)–[#298](https://github.com/Flowcare-team/flowcare-monorepo/issues/298))*

**Decisão do MVP:** ver [catálogo, consentimento e estados de mensagens](MESSAGING_MVP.md). Apenas confirmação de agendamento, cancelamento e lembrete 24 horas antes são enviados por WhatsApp, com opt-in ativo do paciente. Mensagens de autenticação e convite usam e-mail. As rotas de conexão, templates, histórico, preferência, webhook e reenvio manual seguro estão implementadas. A fila persistente e o worker de envio também estão implementados. O worker fixa a versão imutável do template corrente da organização antes da tentativa e não envia quando o tipo ainda não possui template configurado.

**Destino e resultado de envio:** o canal aceita telefone brasileiro inequívoco como DDD + assinante ou E.164 com `+55`; DDD `55` não é confundido com código de país. Números internacionais não brasileiros e entradas ambíguas são recusados. Timeout, resposta inválida, HTTP `408`, HTTP `429`, HTTP `5xx` e interrupção durante uma tentativa são resultados `UNCERTAIN`: ficam visíveis para apuração, não recebem retry automático e só avançam por webhook quando existe identificador correlacionável. O contrato WAHA consultado não garante que essas respostas ocorram antes da aceitação de `sendText`.

**Validação dos templates:** violações estruturais do contrato HTTP rejeitadas pelo Elysia — por exemplo JSON/campos inválidos, `content` vazio ou acima de 4.096 caracteres e versões fora do tipo/faixa declarados — retornam `400 VALIDATION_ERROR` no envelope padrão da API. Conteúdo aceito pelo schema, mas semanticamente inválido para templates — por exemplo placeholders malformados ou não permitidos para o tipo — retorna `422 INVALID_TEMPLATE_STRUCTURE` ou `422 INVALID_TEMPLATE_VARIABLE`.

#### `GET /organizations/:orgSlug/communications/whatsapp/status`
* **Descrição:** Consulta o status da sessão do WhatsApp (conectado, desconectado, QR code pendente).
* **Permissão:** `communications:read`.
* **Respostas:** `200 OK` (`{ "status": "CONNECTED", "phoneNumber": "5511999998888" }`). Estados normalizados: `CONNECTED`, `DISCONNECTED`, `QR_CODE_REQUIRED`, `CONNECTING` e `ERROR`; estados internos e credenciais do provedor não são expostos.

#### `POST /organizations/:orgSlug/communications/whatsapp/reconnect`
* **Descrição:** Cria ou reinicia a sessão privada da clínica e, quando o provedor solicitar pareamento, retorna o QR temporário com sua validade. O QR não é persistido e a resposta usa `Cache-Control: no-store`.
* **Permissão:** `settings:write` (somente `ADMIN` e `ADMIN_PROFESSIONAL`).
* **Respostas:** `200 OK` (`{ "status": "QR_CODE_REQUIRED", "phoneNumber": null, "qrCode": "data:image/png;base64,...", "qrExpiresAt": "2026-10-11T12:00:20.000Z" }`), `503 COMMUNICATION_PROVIDER_UNAVAILABLE`.

#### `GET /organizations/:orgSlug/communications/messages`
* **Descrição:** Lista o histórico paginado de mensagens operacionais com filtros por estado e período; telefone mascarado.
* **Permissão:** `communications:read` ou `appointments:read` para membros ativos da clínica.
* **Query:** `status`, `patientId`, `from`, `to` (instantes ISO 8601 com UTC ou offset, aplicados a `sentAt` e comparados cronologicamente), `cursor` e `limit` (1–100, padrão 25). Ordenação: `sentAt DESC NULLS LAST`, `createdAt DESC`, `id DESC`; mensagens ainda não enviadas aparecem após as enviadas.
* **Respostas:** `200 OK` (`{ "items": [{ "id": "msg_1", "type": "APPOINTMENT_REMINDER", "status": "QUEUED", "patientId": "...", "appointmentId": "...", "phoneMasked": "(11) 98765-****", "createdAt": "...", "sentAt": null, "errorCode": null, "errorReason": null }], "nextCursor": null }`). Estados: `QUEUED`, `UNCERTAIN`, `SENT`, `DELIVERED`, `READ`, `FAILED`. `UNCERTAIN` indica que uma tentativa pode ter sido aceita e não pode ser reenviada automaticamente com segurança.

#### `PATCH /organizations/:orgSlug/patients/:patientId/communication-preferences`
* **Descrição:** Registra opt-in ou opt-out de WhatsApp informado pelo paciente, com origem, autor e horário auditáveis. Opt-out cancela disparos pendentes quando possível.
* **Permissão:** `patients:write`.
* **Body:** `{ "whatsappOptIn": false, "source": "PATIENT_REQUEST" }`. `source` deve conter ao menos um caractere diferente de espaço; o valor é persistido sem espaços nas extremidades.

#### `GET /organizations/:orgSlug/communications/whatsapp/templates`
* **Descrição:** Lista os textos já configurados pela clínica para `APPOINTMENT_CONFIRMATION`, `APPOINTMENT_CANCELLATION` e `APPOINTMENT_REMINDER_24H`. Organizações sem configuração recebem `data: []`; a API não cria textos padrão implicitamente.
* **Permissão:** `communications:read` (`ADMIN`, `ADMIN_PROFESSIONAL` ou `RECEPTIONIST` ativo).
* **Resposta:** `{ "data": [{ "type": "APPOINTMENT_CONFIRMATION", "content": "Consulta confirmada para {data} às {hora}.", "version": 1, "allowedVariables": ["{paciente_nome}", "{data}", "{hora}", "{medico_nome}", "{clinica_nome}"], "maxLength": 4096, "approvedById": "...", "approvedAt": "...", "createdAt": "...", "updatedAt": "..." }] }`.

#### `PUT /organizations/:orgSlug/communications/whatsapp/templates/:type`
* **Descrição:** Cria ou atualiza um texto operacional com concorrência otimista. `version: 0` cria a primeira versão; atualizações devem enviar a versão corrente. Salvar por um membro autorizado equivale à revisão/aprovação e torna imediatamente a nova versão corrente. Não há rascunho ou etapa de aprovação separada no MVP. Versões anteriores permanecem imutáveis.
* **Permissão:** `communications:write` (`ADMIN`, `ADMIN_PROFESSIONAL` ou `RECEPTIONIST` ativo).
* **Body:** `{ "content": "Olá, {paciente_nome}. Sua consulta será em {data} às {hora}.", "version": 0 }`. O conteúdo tem limite provisório de 4.096 caracteres.
* **Respostas:** `200 OK` com o template corrente; `400 VALIDATION_ERROR` para payload estruturalmente inválido; `409 VERSION_CONFLICT`; `422 INVALID_TEMPLATE_STRUCTURE`; `422 INVALID_TEMPLATE_VARIABLE`. A auditoria registra responsável, organização, tipo, versões, instante de aprovação, campos alterados e variáveis, sem copiar o texto.

#### `GET /organizations/:orgSlug/communications/whatsapp/templates/:type/versions`
* **Descrição:** Lista os snapshots imutáveis do tipo configurado, em ordem crescente de versão.
* **Permissão:** `communications:read` (`ADMIN`, `ADMIN_PROFESSIONAL` ou `RECEPTIONIST` ativo).
* **Resposta:** `{ "data": [{ "type": "APPOINTMENT_CONFIRMATION", "content": "...", "version": 1, "approvedById": "...", "approvedAt": "...", "createdAt": "..." }] }`; `404 NOT_FOUND` quando o tipo ainda não foi configurado para a clínica.

#### `GET /organizations/:orgSlug/communications/whatsapp/templates/:type/versions/:version`
* **Descrição:** Recupera um snapshot histórico específico do tipo configurado na clínica.
* **Permissão:** `communications:read` (`ADMIN`, `ADMIN_PROFESSIONAL` ou `RECEPTIONIST` ativo).
* **Respostas:** `200 OK`; `400 VALIDATION_ERROR` quando `version` não for um inteiro entre 1 e 2.147.483.647; `404 NOT_FOUND` para tipo/versão inexistente dentro da organização ativa.

#### `POST /organizations/:orgSlug/communications/whatsapp/templates/:type/preview`
* **Descrição:** Valida um texto sem persistir e substitui somente as variáveis presentes por exemplos fixos e fictícios. Não consulta paciente, agenda, profissional ou organização.
* **Permissão:** `communications:write` (`ADMIN`, `ADMIN_PROFESSIONAL` ou `RECEPTIONIST` ativo).
* **Body:** `{ "content": "Olá, {paciente_nome}. Sua consulta será em {data} às {hora}." }`.
* **Resposta:** `{ "isExample": true, "type": "APPOINTMENT_CONFIRMATION", "content": "Olá, Maria da Silva. Sua consulta será em 20/10/2026 às 14:30.", "variables": { "paciente_nome": "Maria da Silva", "data": "20/10/2026", "hora": "14:30" }, "allowedVariables": [...], "maxLength": 4096 }`.
* **Erros:** `400 VALIDATION_ERROR` para payload estruturalmente inválido; `422 INVALID_TEMPLATE_STRUCTURE`; `422 INVALID_TEMPLATE_VARIABLE`.

#### `POST /webhooks/whatsapp/status`
* **Descrição:** Recebe `message.ack` do WAHA. Exige `X-Webhook-Hmac` (HMAC-SHA512 hexadecimal do corpo bruto com `WAHA_WEBHOOK_SECRET`), `X-Webhook-Request-Id` e `X-Webhook-Timestamp` (milissegundos, janela de cinco minutos). Valida a correspondência entre `ackName` e `ack`: `PENDING/0` é aceito sem mutação; `SERVER/1`, `DEVICE/2`, `READ/3` e `PLAYED/4` avançam a entrega; `ERROR/-1` marca `FAILED` somente antes de `DELIVERED` ou `READ`. Requisições repetidas são idempotentes por organização e pela impressão SHA-256 do corpo bruto autenticado, mesmo se o request ID for alterado; atualizações fora de ordem não regridem entrega ou leitura. Se o ACK chegar antes de o worker persistir o identificador retornado por `sendText`, a API guarda de forma durável apenas essa impressão e o hash do identificador da mensagem, no escopo da organização, e o worker o associa e reconcilia automaticamente ao concluir a persistência. Se o segredo não está configurado, falha fechado. Retorna `{ "accepted": true }`.
* **Permissão:** segredo do webhook, sem sessão de usuário.

#### `POST /organizations/:orgSlug/communications/messages/:messageId/resend`
* **Descrição:** Solicita reenvio apenas de mensagem `FAILED`, após verificar novamente opt-in, telefone e agendamento; registra o operador. Mensagens `SENT`, `DELIVERED` e `READ` não são reenviadas.
* **Permissão:** `communications:write`.
* **Cabeçalho Obrigatório:** `Idempotency-Key`
* **Respostas:** `200 OK` (`{ "status": "QUEUED" }`), `409 MESSAGE_STATE_CONFLICT` se não for elegível. Repetir a chave retorna o resultado original.
* **Estado:** Implementado na #297. Mensagens `UNCERTAIN` não são elegíveis enquanto o resultado original não for esclarecido.

---

### Módulo 11: Painel & Indicadores da Clínica
*(Ref: Issues [#197](https://github.com/Flowcare-team/flowcare-monorepo/issues/197), [#229](https://github.com/Flowcare-team/flowcare-monorepo/issues/229), [#230](https://github.com/Flowcare-team/flowcare-monorepo/issues/230))*

**Decisão do MVP:** ver [dicionário de métricas](METRICS_MVP.md). O painel mostra contagens de agenda e taxa de faltas; consumo de transcrição mostra volume, sem custo estimado em R$ ou cota inventada. As rotas de indicadores e consumo de transcrição estão implementadas.

#### `GET /organizations/:orgSlug/dashboard/metrics`
* **Descrição:** Retorna indicadores operacionais da clínica no período e fuso configurados, sem cruzar organizações.
* **Permissão:** `dashboard:read`.
* **Query Params:** `?period=today|week|month` ou `?startDate=YYYY-MM-DD&endDate=YYYY-MM-DD`. Padrão: `today`. Datas do intervalo explícito são limites locais, com início inclusivo e fim exclusivo; os dois filtros são mutuamente exclusivos. O intervalo explícito pode ter no máximo 366 dias. Semana começa na segunda-feira.
* **Respostas:** `200 OK` (`{ "periodStart": "...", "periodEnd": "...", "timeZone": "America/Fortaleza", "totalAppointments": 10, "scheduledAppointments": 2, "completedAppointments": 5, "cancelledAppointments": 2, "noShowAppointments": 1, "noShowRate": 0.1667 }`). `periodStart` e `periodEnd` são instantes UTC no formato ISO. `noShowRate` é fração entre 0 e 1 ou `null` sem atendimentos concluídos ou faltas. Períodos inválidos retornam `400 VALIDATION_ERROR`.

#### `GET /organizations/:orgSlug/settings/usage` (alias `GET /organizations/:orgSlug/usage`)
* **Descrição:** Consulta o consumo mensal de transcrição da clínica, com detalhamento por profissional e falhas sem consumo.
* **Permissão:** `usage:read` (ou `settings:read`).
* **Query Params:** `?month=YYYY-MM`. Padrão: mês corrente no fuso da clínica.
* **Respostas:** `200 OK` (`{ "month": "2026-10", "timeZone": "America/Fortaleza", "periodStart": "2026-10-01T03:00:00.000Z", "periodEnd": "2026-11-01T03:00:00.000Z", "processedSeconds": 120, "processedMinutes": 2, "successfulAudioCount": 2, "transcribedConsultations": 2, "failedAudioCount": 1, "byProfessional": [] }`). Sem campo de custo em R$ ou cota até aprovação da regra comercial.

---

### Módulo 12: Configurações da Clínica & Horários
*(Ref: Issues [#303](https://github.com/Flowcare-team/flowcare-monorepo/issues/303)–[#306](https://github.com/Flowcare-team/flowcare-monorepo/issues/306))*

#### `GET /organizations/:orgSlug/settings`
* **Descrição:** Consulta as configurações institucionais, endereço completo e metadados do logotipo da clínica ativa.
* **Permissão:** `settings:read` (`ADMIN` ou `ADMIN_PROFESSIONAL`).
* **Respostas:** `200 OK` com `id`, `name`, `slug`, `version`, `completed`, `legalName`, `taxId`, `contactEmail`, `contactPhone`, `postalCode`, `state`, `city`, `district`, `street`, `streetNumber`, `addressComplement` e `logo` (`{ "contentType": "image/png", "sizeBytes": 1024, "updatedAt": "..." } | null`). Nenhum URL público ou chave de armazenamento é exposto. `401 UNAUTHENTICATED`, `403 MEMBERSHIP_INACTIVE`, `403 PERMISSION_DENIED`, `404 NOT_FOUND`.

#### `PATCH /organizations/:orgSlug/settings` e `PUT /organizations/:orgSlug/settings`
* **Descrição:** Atualiza os dados institucionais, contato e/ou endereço da clínica ativa com controle de concorrência otimista (`version`) e gravação de evento `ORGANIZATION_SETTINGS_UPDATED` em `AuditLog` na mesma transação. `slug`, `id`, `organizationId` e `ownerId` são imutáveis e rejeitados.
* **Permissão:** `settings:write` (`ADMIN` ou `ADMIN_PROFESSIONAL`).
* **Body (`PATCH`):** `{ "version": 2, "name": "Clínica Vida", "legalName": "Clínica Vida Ltda", "taxId": "11.222.333/0001-81", "contactEmail": "contato@vida.com.br", "contactPhone": "(85) 99999-0000", "postalCode": "60000-000", "state": "CE", "city": "Fortaleza", "district": "Aldeota", "street": "Av. Santos Dumont", "streetNumber": "1000", "addressComplement": "Sala 10" }` (exige `version` e ao menos um campo editável; `PUT` exige todos os campos institucionais e de endereço).
* **Respostas:** `200 OK` com o DTO atualizado e `version` incrementado; `400 VALIDATION_ERROR` com `error.details.field`; `403 MEMBERSHIP_INACTIVE`; `403 PERMISSION_DENIED`; `404 NOT_FOUND`; `409 VERSION_CONFLICT`.

#### `POST /organizations/:orgSlug/settings/logo` (alias `POST /organizations/:orgSlug/logo`)
* **Descrição:** Envia ou substitui o logotipo oficial da clínica por `multipart/form-data` no campo `file`. O servidor valida assinatura binária (magic bytes) e grava no armazenamento privado sob `organizations/{organizationId}/logo/`. O logotipo anterior é removido após o commit e a troca gera registro `ORGANIZATION_LOGO_UPDATED` em `AuditLog`.
* **Permissão:** `settings:write` (`ADMIN` ou `ADMIN_PROFESSIONAL`).
* **Limite:** JPEG, PNG ou WebP, até **5 MiB (5.242.880 bytes)**.
* **Respostas:** `200 OK` com o DTO de `GET /organizations/:orgSlug/settings`; `400 VALIDATION_ERROR`; `403 PERMISSION_DENIED`; `404 NOT_FOUND`; `413 FILE_TOO_LARGE`; `503 STORAGE_UNAVAILABLE`.

#### `GET /organizations/:orgSlug/settings/logo/download-url` (alias `GET /organizations/:orgSlug/logo/download-url`)
* **Descrição:** Gera URL temporária assinada (15 minutos) para leitura do logotipo privado da clínica ativa.
* **Permissão:** `organizations:read` (qualquer membro ativo da clínica).
* **Respostas:** `200 OK` (`{ "downloadUrl": "...", "expiresInSeconds": 900 }`); `403 MEMBERSHIP_INACTIVE`; `404 NOT_FOUND` (sem vínculo ou sem logotipo cadastrado); `503 STORAGE_UNAVAILABLE`.

#### `GET /organizations/:orgSlug/settings/schedule-rules`
* **Permissão:** `settings:read` na clínica ativa.
* **Resposta:** `200 OK` com `{ "timezone": "America/Fortaleza", "rules": [{ "dayOfWeek": "MONDAY", "startTime": "08:00", "endTime": "12:00", "slotDurationMinutes": 30 }] }`.

#### `PUT /organizations/:orgSlug/settings/schedule-rules`
* **Descrição:** Substitui apenas a grade semanal da clínica; exceções permanecem. A alteração do fuso horário da clínica é explícita.
* **Permissão:** `settings:write` (ADMIN ou ADMIN_PROFESSIONAL ativo).
* **Body:** `{ "timezone": "America/Fortaleza", "rules": [{ "dayOfWeek": "MONDAY", "startTime": "08:00", "endTime": "12:00", "slotDurationMinutes": 30 }] }`. `rules: []` remove a grade.
* **Respostas:** `200 OK` com o mesmo formato do GET; `400 VALIDATION_ERROR` para fuso, intervalo ou duração inválidos e sobreposição no mesmo dia.

#### `GET /organizations/:orgSlug/settings/schedule-exceptions`
* **Permissão:** `settings:read` na clínica ativa.
* **Resposta:** `200 OK` com `{ "timezone": "America/Fortaleza", "exceptions": [{ "id": "<uuid>", "professionalId": null, "startsAt": "2026-12-25T00:00:00.000Z", "endsAt": "2026-12-26T00:00:00.000Z", "timezone": "America/Fortaleza", "reason": "Feriado" }] }`.

#### `POST /organizations/:orgSlug/settings/schedule-exceptions`
* **Descrição:** Cria bloqueio de intervalo UTC para toda a clínica (`professionalId` omitido) ou para um profissional ativo da clínica. Salva explicitamente o fuso da clínica no registro. A grade semanal não é alterada.
* **Permissão:** `settings:write`.
* **Body:** `{ "professionalId": "<uuid>", "startsAt": "2026-12-25T11:00:00.000Z", "endsAt": "2026-12-25T12:00:00.000Z", "reason": "Ausência" }`.
* **Respostas:** `201 Created` com `{ "exception": { ... } }`; `400 VALIDATION_ERROR` para intervalo inválido; `404 NOT_FOUND` para profissional de outra clínica; `409 SCHEDULE_CONFLICT` para bloqueio sobreposto no mesmo escopo.

#### `DELETE /organizations/:orgSlug/settings/schedule-exceptions/:exceptionId`
* **Permissão:** `settings:write`.
* **Respostas:** `200 OK` com `{ "deleted": true }`; `404 NOT_FOUND` para exceção inexistente ou de outra clínica.

Bloqueios de clínica e profissional são aplicados por `GET /appointments/availability`, criação e alteração de agendamentos. Uma exceção não apaga a regra semanal; remover a exceção volta a expor os horários livres da grade.

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
* **Respostas:** `200 OK` (`{ "id": "usr_1", "fullName": "Dra. Maria Silva", "email": "maria@exemplo.com", "photo": null }`). Quando há foto, `photo` contém somente `contentType` e `sizeBytes`; nenhum URL público é exposto.

#### `PATCH /me/profile`
* **Descrição:** Atualiza o nome completo ou foto de perfil pessoal.
* **Permissão:** Autenticado.
* **Body:** `{ "fullName": "Dra. Maria Silva Santos" }` (3 a 120 caracteres após remover espaços nas pontas). Outros campos, inclusive `email` e `userId`, são rejeitados.
* **Respostas:** `200 OK` com o mesmo DTO de `GET /me/profile`; `400 VALIDATION_ERROR` para nome inválido.

#### `POST /me/profile/photo`
* **Descrição:** Envia foto da própria conta por `multipart/form-data` no campo `file`, sem depender de clínica. O servidor verifica o conteúdo e grava no armazenamento privado sob `users/{id}/profile/`. A foto anterior é removida após a substituição.
* **Permissão:** Autenticado.
* **Limite:** JPEG ou PNG, até **5 MiB (5.242.880 bytes)**. O tipo declarado deve corresponder à assinatura do arquivo.
* **Respostas:** `200 OK` com o DTO de `GET /me/profile`; `400 VALIDATION_ERROR` para tipo/conteúdo inválido; `413 FILE_TOO_LARGE`; `503 STORAGE_UNAVAILABLE`.

#### `GET /me/profile/photo/download-url`
* **Descrição:** Gera URL temporária de leitura da foto privada da própria conta, válida por 15 minutos.
* **Permissão:** Autenticado.
* **Respostas:** `200 OK` (`{ "downloadUrl": "...", "expiresInSeconds": 900 }`); `404 NOT_FOUND` se não houver foto.

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
* **Respostas:** `200 OK` (`{ "revokedCount": 1 }`); `404 NOT_FOUND` para sessão inexistente, expirada, já revogada ou de outra conta. Revogar a sessão atual invalida o token na próxima requisição.

#### `DELETE /me/sessions/other`
* **Descrição:** Revoga todas as outras sessões ativas, exceto a atual.
* **Permissão:** Autenticado.
* **Respostas:** `200 OK` (`{ "revokedCount": 2 }`).
* **Auditoria:** Os dois comandos registram conta, sessão autora, alvo quando aplicável, quantidade e horário na mesma transação da revogação. O comando `other` é auditado mesmo quando a quantidade é zero.

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
* **`Membership`**: Vínculo entre `User` e `Organization` com `role` (`ADMIN`, `ADMIN_PROFESSIONAL`, `PROFESSIONAL` ou `RECEPTIONIST`) e status.
* **`OnboardingProgress`**: Estado do assistente de primeiro acesso, persistido por conta.
* **`Role` & `Permission`**: Papéis e permissões granulares por clínica.
* **`Patient`**: Cadastros de pacientes isolados por `organizationId`.
* **`Appointment`**: Agendamentos ligados a `Patient`, `User` (profissional) e `Organization`.
* **`Consultation`**: Atendimento clínico ligado a `Appointment` e `Patient`.
* **`Document` & `DocumentVersion`**: Documentos médicos com histórico de versões e snapshots imutáveis.
* **`AuditLog`**: Trilha imutável de eventos de auditoria da organização e de segurança. `actorUserId` pode ser nulo somente quando a tentativa ocorre antes de uma identidade ser comprovada; nesses casos, alvo e origem são pseudonimizados com HMAC-SHA256.

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
| `Membership` | `role` | Papel da pessoa nessa organização: `ADMIN`, `ADMIN_PROFESSIONAL`, `PROFESSIONAL` ou `RECEPTIONIST`. |
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

### 23. Auditoria de Segurança e Trilha de Eventos (#327)

#### `GET /api/organizations/:orgSlug/audit-logs`
Consulta a trilha de auditoria e segurança da clínica ativa. Acesso restrito a usuários com permissão administrativa (`audit:read`), isto é, papéis `ADMIN` e `ADMIN_PROFESSIONAL`.

**Query Parameters:**
* `action` (opcional, string): filtra por ação específica (ex.: `AUTH_LOGIN_SUCCEEDED`, `TEAM_INVITE_CREATED`, `WEEKLY_SCHEDULE_UPDATED`, `ORGANIZATION_SETTINGS_UPDATED`).
* `targetType` (opcional, string): filtra por tipo de recurso alvo (ex.: `SESSION`, `ORGANIZATION`, `ORGANIZATION_INVITE`, `PATIENT`).
* `targetId` (opcional, string): filtra por ID do alvo.
* `actorUserId` (opcional, string): filtra pelo ID do usuário autor da ação.
* `limit` (opcional, int, padrão 50, máx 100): limita a quantidade de registros retornados.

**Resposta de Sucesso (200 OK):**
```json
{
  "data": [
    {
      "id": "c1f7b028-1b6e-473d-9d41-3b7c845ad35e",
      "organizationId": "550e8400-e29b-41d4-a716-446655440000",
      "actorUserId": "3c914bf6-02a8-4e89-8d7d-5a9e32a6a672",
      "action": "WEEKLY_SCHEDULE_UPDATED",
      "targetType": "ORGANIZATION",
      "targetId": "550e8400-e29b-41d4-a716-446655440000",
      "metadata": {
        "timezone": "America/Sao_Paulo",
        "ruleCount": 5
      },
      "createdAt": "2026-10-12T11:00:00.000Z"
    }
  ]
}
```

#### Imutabilidade e Sanitização de Dados
* **Imutabilidade**: Eventos de auditoria são somente gravação pelo sistema. Qualquer tentativa de alteração ou remoção via API comum (`POST`, `PATCH`, `PUT`, `DELETE /organizations/:orgSlug/audit-logs` ou `/audit-logs`) é expressamente rejeitada com HTTP 403 `AUDIT_LOG_IMMUTABLE`.
* **Sanitização de Metadados**: O serviço de auditoria sanitiza previamente qualquer dado sensível em profundidade. É terminantemente proibida a persistência de senhas, hashes de senha, tokens, chaves privadas/API, áudios brutos, gravações de voz ou conteúdo clínico bruto nos metadados.
* **Eventos públicos de autenticação**: `AUTH_LOGIN_FAILED` e `AUTH_RATE_LIMITED` usam `targetType: "AUTH_SUBJECT"`, `actorUserId: null` quando a conta não pode ser comprovada e somente digests HMAC do alvo/origem. E-mail, IP, senha e token completos não entram na trilha nem nos logs HTTP abertos.
* **Fail-Closed**: Falha no registro de auditoria em ações críticas aborta a transação e retorna erro HTTP, impedindo que mutações críticas ocorram sem rastro.
* **Retenção**: Prazo de retenção homologado de 5 anos (1.825 dias).
