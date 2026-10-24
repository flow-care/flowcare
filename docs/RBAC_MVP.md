# Flowcare — papéis e permissões do MVP

**Decisão de produto do MVP:** [#194](https://github.com/flow-care/flowcare/issues/194). Este documento define autorização de clínica; identidade e conta pessoal são globais. As rotas planejadas em [API_CONTRACT.md](API_CONTRACT.md) devem aplicar esta matriz quando forem implementadas. As condições de habilitação para cada ação clínica devem ser revisadas por responsável clínico antes da ativação. Dados de saúde são dados pessoais sensíveis segundo a [ANPD](https://www.gov.br/anpd/pt-br/acesso-a-informacao/perguntas-frequentes), por isso a separação entre operação e conteúdo clínico é explícita.

## Papéis fixos

| Papel | Função |
|---|---|
| `ADMIN` | Gerencia clínica, equipe, agenda, operação, consumo **e conteúdo clínico**. O dono/criador da clínica precisa controlar prontuário, documentos e modelos da própria clínica. |
| `ADMIN_PROFESSIONAL` | Reúne administração e atuação clínica, sujeita aos requisitos profissionais de cada ação. |
| `PROFESSIONAL` | Atua em atendimentos, prontuários e documentos clínicos, sem administrar equipe, cobrança ou configurações da clínica. |
| `RECEPTIONIST` | Cuida de cadastro administrativo de pacientes, agenda, fila e mensagens logísticas. Não lê prontuário, anamnese, áudio, prescrição ou anexos clínicos. |

Não há criação nem edição de papéis personalizados no MVP. Uma pessoa tem um papel por vínculo com cada clínica; papéis e permissões não são globais. O criador pode escolher `ADMIN_PROFESSIONAL` na criação da clínica se também atuará clinicamente; o papel inicial é `ADMIN`, que já acumula administração e conteúdo clínico desde a decisão de 22/10/2026 registrada abaixo.

**Registro de alteração (22/10/2026):** por decisão do dono do produto, `ADMIN` passou a acumular as capacidades clínicas. Antes, o criador da clínica nascia como `ADMIN` e ficava sem acesso à agenda clínica, ao prontuário, aos documentos e aos modelos da própria clínica — o que também escondia Consultas e Documentos do menu. A mudança vale para todo `ADMIN`, não só para o criador, e é aplicada no backend (`capabilities.ADMIN` inclui o grupo clínico) e na navegação da web. `ADMIN_PROFESSIONAL` continua existindo e equivalente na prática; `PROFESSIONAL` e `RECEPTIONIST` não mudaram.

## Matriz por capacidade

`✓` permite; `—` nega. Capacidades de leitura nunca autorizam mutação.

| Área e capacidade | ADMIN | ADMIN_PROFESSIONAL | PROFESSIONAL | RECEPTIONIST |
|---|:---:|:---:|:---:|:---:|
| Clínica: `organizations:read` | ✓ | ✓ | ✓ | ✓ |
| Equipe: `team:read`, `team:invite`, `team:manage` | ✓ | ✓ | — | — |
| Papéis fixos: `roles:read` | ✓ | ✓ | — | — |
| Pacientes, dados cadastrais: `patients:read`, `patients:write` | ✓ | ✓ | ✓ | ✓ |
| Pacientes, histórico clínico: `patients:read_history` | ✓ | ✓ | ✓ | — |
| Pacientes, anexos clínicos: `patients:attachments:read`, `patients:attachments:write` | ✓ | ✓ | ✓ | — |
| Agenda: `appointments:read`, `appointments:write` | ✓ | ✓ | ✓ | ✓ |
| Recepção: `reception:read` | ✓ | ✓ | ✓ | ✓ |
| Recepção: `reception:write` | ✓ | ✓ | — | ✓ |
| Atendimentos, áudio e rascunhos: `consultations:read`, `consultations:write` | ✓ | ✓ | ✓ | — |
| Aprovação de anamnese: `consultations:approve` | ✓ | ✓ | ✓ | — |
| Documentos clínicos: `documents:read`, `documents:write`, `documents:issue`, `documents:void` | ✓ | ✓ | ✓ | — |
| Modelos de documentos: `templates:read`, `templates:write` | ✓ | ✓ | ✓ | — |
| WhatsApp e mensagens logísticas: `communications:read`, `communications:write` | ✓ | ✓ | — | ✓ |
| Painel operacional sem dados financeiros: `dashboard:read` | ✓ | ✓ | ✓ | ✓ |
| Consumo de transcrição: `usage:read` | ✓ | ✓ | — | — |
| Configurações da clínica e horários: `settings:read`, `settings:write` | ✓ | ✓ | — | — |
| Trilha de auditoria, sem conteúdo clínico bruto: `audit:read` | ✓ | ✓ | — | — |

Autenticação (`/auth/*`) e conta pessoal (`/me/*`) dependem da própria identidade, não do papel na clínica. Onboarding de criação pertence ao usuário criador; aceite de convite exige conta verificada com o mesmo e-mail do convite. Em todas as áreas, recursos de outra clínica permanecem inacessíveis.

## Condições e limites

1. `patients:read` e `patients:write` abrangem somente dados cadastrais e de contato. Resumos acessíveis a `RECEPTIONIST` não incluem diagnóstico, histórico, anamnese, anexos, áudio, medicamentos ou documentos. Endpoints de timeline e anexos exigem capacidades clínicas separadas, que `ADMIN`, `ADMIN_PROFESSIONAL` e `PROFESSIONAL` possuem.
2. A elegibilidade clínica hoje é verificada por papel (`ADMIN`, `ADMIN_PROFESSIONAL`, `PROFESSIONAL`). A validação de registro profissional por tipo de documento — que impediria, por exemplo, emitir receita controlada sem habilitação específica — continua pendente e deve ser implementada antes de ativar emissão de documentos sensíveis. Aprovação e emissão registram autoria; anulação de documento clínico exige justificativa e regra de autoria definida no módulo.
3. `ADMIN` e `ADMIN_PROFESSIONAL` acumulam administração e conteúdo clínico e podem atribuir papéis fixos a outra pessoa, mas não alterar o próprio papel pela rota de equipe. Atribuir papel clínico continua exigindo os dados profissionais aplicáveis do destinatário. Toda alteração é auditada.
4. A clínica mantém ao menos um membro ativo com `ADMIN` ou `ADMIN_PROFESSIONAL`. Remover, suspender ou rebaixar o último é proibido, inclusive sob concorrência.
5. O backend resolve `organizationId` e `Membership` ativo a cada requisição e calcula as capacidades do papel atual. Mudança de papel ou suspensão vale na próxima requisição, sem depender de logout ou de claim de permissão no JWT. Falha de vínculo retorna `404 NOT_FOUND` para quem não pertence à clínica; vínculo inativo retorna `403 MEMBERSHIP_INACTIVE`; falta de capacidade retorna `403 PERMISSION_DENIED` no envelope de erro da API.
6. O frontend pode ocultar ações, mas nunca substitui a autorização do backend. Consultas e mutações são filtradas por `organizationId`; identificadores enviados pelo cliente não selecionam outro tenant.

## Implementação planejada

A task [#228](https://github.com/flow-care/flowcare/issues/228) introduz o contexto organizacional e a verificação de capacidade na API Elysia. Cada rota organizacional deve declarar a capacidade exigida no macro `organizationAccess` e usar o `organizationId` resolvido para consultas e mutações. Ações clínicas marcadas com `*` falham fechadas até o módulo do recurso fornecer verificação específica de habilitação profissional. O endpoint genérico de armazenamento aceita anexos clínicos somente para papéis clínicos; áudio e PDF aguardam rotas de recurso com habilitação específica. A task [#317](https://github.com/flow-care/flowcare/issues/317) protege troca de papel e último administrador. A criação/edição de papéis personalizados das tasks #316, #319 e #325 sai do escopo do MVP.

Antes de ativar emissão de documentos, aprovação de anamnese ou outra ação clínica, responsável clínico valida as habilitações específicas por tipo de recurso. A matriz de papéis não substitui essa validação.

Casos mínimos de validação: recepção não lê timeline nem anexos clínicos; administrador e criador da clínica acessam consultas, documentos, modelos e consumo; profissional não vê consumo nem altera equipe; profissional habilitado acessa ações clínicas permitidas; papel alterado perde acesso na requisição seguinte; não é possível remover o último administrador; slug ou recurso de outra clínica não vaza dados.
