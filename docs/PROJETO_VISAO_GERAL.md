# Flowcare — Documento de Projeto (consolidado)

*Visão única do sistema: problema, escopo, requisitos, arquitetura, dados, fluxos, operação e riscos. Reúne o conteúdo da especificação funcional e do contrato de API entregues em 22/10/2026 e o estado real do repositório e do backlog.*

**Versão:** 1.0 · **Data:** 22/10/2026 · **Responsável:** produto + engenharia
**Fontes:** `docs/fontes/documento-de-especificacao.pdf` · `docs/fontes/sintesy-b523607b-text.pdf` · 155 issues em `flow-care/flowcare` · código em `apps/api` e `apps/web`

---

## 1. Identificação

| Campo | Valor |
|---|---|
| Produto | **Flowcare** (nome anterior: MedFlow / MedicalFlow) |
| Natureza | Sistema web de agenda e prontuário para clínicas solo e de pequeno porte |
| Contexto | Fábrica de Software / APIExt IV — semestre 2026/2, marcos avaliativos AV1, SR II, SR III e AV2 |
| Repositório | `flow-care/flowcare` (monorepo) |
| Produção | flowcare.me |
| Gestão | Scrumban — sprints quinzenais + Kanban com limite de WIP |
| Entrega final | 15/12/2026 |

---

## 2. Problema

Clínicas pequenas perdem dinheiro e qualidade clínica em três pontos:

1. **Faltas e conflitos de agenda.** No-show sem aviso e horários sobrepostos geram ociosidade e prejuízo direto.
2. **Documentação dispersa.** Prontuários, anamneses e receitas ficam em formatos variados, sem padronização nem rastreabilidade.
3. **Atenção dividida.** O profissional perde contato visual com o paciente porque digita durante a consulta.

## 3. Solução

Um sistema web integrado com três pilares:

- **Agenda orientada à ação** — grade diária/semanal, status visuais, confirmação por WhatsApp e atalho de 1 clique para a ficha do paciente.
- **Prontuário 360°** — histórico cronológico contínuo, anexos e biblioteca de modelos reutilizáveis.
- **Transcrição inteligente** — o médico grava o áudio da consulta; a IA **transcreve** e **redige** a anamnese por tópicos, que ele revisa e aprova. A IA é estritamente redatora: nunca sugere diagnóstico nem conduta.

## 4. Público e personas

| Persona | O que faz no sistema | Dor que resolve |
|---|---|---|
| Médico(a) — dono do consultório | Agenda própria, prontuário, modelos, emissão de documentos, configurações da clínica | Perde tempo digitando e organizando papel |
| Recepcionista | Agenda, cadastro de pacientes, fila, mensagens logísticas, leitura de prescrições/exames | Agenda confusa, paciente que falta sem avisar |
| Administrador da clínica | Equipe, papéis, indicadores, consumo | Falta de visão do que acontece na operação |

> No código, papéis são `ADMIN`, `ADMIN_PROFESSIONAL`, `PROFESSIONAL` e `RECEPTIONIST` (ver §6 e `RBAC_MVP.md`) — a especificação original previa apenas "médico" e "recepcionista".

## 5. Escopo

### 5.1 Dentro do MVP

Agenda e fila da recepção · cadastro e prontuário de pacientes com anexos · modelos e emissão de documentos em PDF · transcrição de anamnese com extração de tópicos · confirmação de consulta por WhatsApp · autenticação, papéis, auditoria e medição de consumo.

### 5.2 Fora do escopo (fases futuras)

| Área | Exclusão explícita |
|---|---|
| Agenda | Gateways pagos de telefonia/SMS corporativo |
| Prontuário | Migração de sistemas hospitalares (TASY/MV) |
| Documentos | Assinatura digital ICP-Brasil; editor de posicionamento livre tipo Canva |
| Transcrição | Diagnóstico autônomo ou decisão clínica por IA |
| Financeiro | Faturamento/glosa TISS-TUSS, módulo fiscal/NF-e |
| Documentos (refinamento) | Receita de controlados completa e papéis de acesso personalizados |
| Negócio | Cobrança automática da assinatura (há modelo de dados de assinatura; não há gateway) |

## 6. Papéis e permissões

Matriz completa em [`RBAC_MVP.md`](RBAC_MVP.md). Resumo:

| Capacidade | ADMIN | ADMIN_PROFESSIONAL | PROFESSIONAL | RECEPTIONIST |
|---|:--:|:--:|:--:|:--:|
| Configurações e equipe da clínica | ✓ | ✓ | — | — |
| Agenda e fila da recepção | ✓ | ✓ | ✓ | ✓ |
| Cadastro de pacientes | ✓ | ✓ | ✓ | ✓ |
| Histórico clínico, anamnese, áudio, anexos | ✓ | ✓ | ✓ | — (negado e auditado) |
| Documentos: emitir / anular | ✓ | ✓ | ✓ | leitura só de prescrições e exames |
| Consumo de transcrição | ✓ | ✓ | — | — |
| Trilha de auditoria | ✓ | ✓ | — | — |

**Invariante:** a autorização é sempre resolvida no servidor a partir de `Organization` + `Membership` ativo; identificador enviado pelo cliente nunca seleciona outro tenant. A recepção não acessa conteúdo clínico — tentativa negada gera log.

## 7. Requisitos funcionais

Os IDs abaixo vêm da especificação. A coluna **Situação** reflete o backlog e o código em 22/10/2026 — a validação formal é do QA (`TEST_PLAN_AND_TRACEABILITY.md`).

### 7.1 Módulo A — Agenda (RF-A1–A9)

| ID | Requisito | Pri. | Situação |
|---|---|:--:|---|
| A1 | Grade diária e semanal com intervalos e status | Must | Implementado |
| A2 | Criação rápida de horários | Must | Implementado |
| A3 | Bloqueios de horário | Must | Implementado |
| A4 | Encaixes fora do slot padrão | Must | Implementado |
| A5 | Status: agendado, confirmado, em espera, em atendimento, concluído, cancelado | Must | Implementado (inclui fila de recepção) |
| A6 | 1 clique do agendamento para a ficha | Must | Implementado |
| A7 | Trava anti-sobreposição no banco (não só na aplicação) | Must | Implementado — `EXCLUDE`/constraint transacional |
| A8 | Lembrete e confirmação por WhatsApp com atualização de status | Should | Parcial — backend e envio prontos; faltam telas (#299, #301, #302) |
| A9 | Registro de no-show | Should | Implementado |

**A8 em detalhe:** 1 sessão WAHA por clínica, conexão por QR, sessão persistente; disparo na criação e/ou antes do atendimento; resposta do paciente entra por webhook e é interpretada por palavras-chave normalizadas (SIM/1/CONFIRMO × NÃO/2/CANCELAR), configuráveis; resposta ambígua vai para a fila **"aguardando confirmação manual"** — nunca fica em estado indefinido; estados de mensagem `pendente → enviando → enviada → falhou`, com reenvio manual sem duplicar.

### 7.2 Módulo B — Pacientes e prontuário (RF-B1–B5)

| ID | Requisito | Pri. | Situação |
|---|---|:--:|---|
| B1 | Cadastro: dados pessoais, convênio, contato | Must | Implementado |
| B2 | Visão 360° unificada | Must | Implementado |
| B3 | Linha do tempo cronológica de atendimentos | Must | Implementado |
| B4 | Repositório de anexos e exames (PDF/JPG) | Must | Implementado — armazenamento privado por clínica |
| B5 | Busca livre e incremental (nome, CPF, telefone) | Should | Implementado — colunas normalizadas + debounce |

### 7.3 Módulo C — Documentos (RF-C1–C10)

| ID | Requisito | Pri. | Situação |
|---|---|:--:|---|
| C1 | Editor visual com preview fiel ao PDF | Must | Parcial — há modelo + preview; editor não é BlockNote (ver divergências) |
| C2 | Campos automáticos por catálogo, sem sintaxe digitada | Must | Parcial |
| C3 | Receituário simples | Must | Implementado |
| C4 | Receituário de controlados | Must | Fora do MVP (#281) |
| C5 | Laudo por modelo | Must | Implementado |
| C6 | Central de documentos com PDF gerado no back-end | Must | Implementado — PDF em storage privado |
| C7 | Assinatura eletrônica simples (autor, data, auditoria) | Must | Implementado |
| C8 | Campo de texto livre preenchido na emissão | Must | Implementado |
| C9 | Preview com paciente fictício | Should | Parcial |
| C10 | Imutabilidade: documento emitido é snapshot | Must | Implementado — versões + `snapshot` |

**Regras que não podem regredir:** obrigatoriedade de campo varia **por tipo de documento** (ex.: endereço só é exigido em receita de controlados); campo obrigatório vazio bloqueia a emissão com mensagem amigável e lista do que falta, nunca erro técnico; placeholder inválido marca o modelo como "com erro" e o impede de emitir; editar o modelo depois **nunca** altera documento já emitido.

### 7.4 Módulo D — Transcrição de anamnese (RF-D1–D12)

| ID | Requisito | Pri. | Situação |
|---|---|:--:|---|
| D1 | Tópicos da anamnese configuráveis pelo médico | Must | Implementado |
| D2 | Captura no navegador, MP3, limite 500 MB com truncamento | Must | Implementado |
| D3 | Transcrição pela API do Sintesy (server-to-server) | Must | Código pronto (`SintesyTranscriptionProvider`); modo `mock` por padrão |
| D4 | Extração semântica só dos tópicos configurados | Must | Código pronto (`GorouterExtractionProvider`), mesma ressalva |
| D5 | Revisão rápida e aprovação em 1 clique | Must | Implementado |
| D6 | IA estritamente redatora | Must | Implementado no prompt + validação de saída |
| D7 | Credenciais só no back-end; áudio nunca vai do navegador ao Sintesy | Must | Implementado |
| D8 | Pipeline assíncrono com estados e retry com backoff | Must | Implementado |
| D9 | Transcrição e extração persistidas vinculadas ao atendimento | Must | Implementado |
| D10 | Medição de uso e custo por clínica (sem bloqueio) | Should | Implementado |
| D11 | Síntese completa do Sintesy | Could | Fora do MVP |
| D12 | Descarte do áudio após transcrição bem-sucedida (LGPD) | Must | Implementado |

**Ponto de atenção:** o pipeline existe dos dois lados, mas a transcrição em produção depende de `SINTESEY_MODE=live` + chave B2B. O padrão é `mock` — sem isso, o diferencial do produto não está ativo.

### 7.5 Módulo E — Segurança e acessos (RF-E1–E6)

| ID | Requisito | Situação |
|---|---|---|
| E1 | Autenticação por sessão com invalidação | Implementado — divergiu do "JWT sem expiração" (§16) |
| E2 | RBAC por papel | Implementado |
| E3 | Criptografia em repouso e em trânsito | HTTPS/TLS + storage privado |
| E4 | Hash de senha | Implementado — Argon2 |
| E5 | Auditoria de acessos em dados clínicos | Implementado |
| E6 | Conformidade LGPD para dado de saúde | Parcial — falta termo de consentimento |

## 8. Requisitos não funcionais

| ID | Categoria | Requisito |
|---|---|---|
| RNF-1 | Confiabilidade | Integridade transacional no banco para prontuário e agenda |
| RNF-2 | Extensibilidade | Campos flexíveis (JSON) para anamnese e extração |
| RNF-3 | Usabilidade | Operações centrais em no máximo 1 clique a partir da grade |
| RNF-4 | Performance | Interface reativa; tipagem estática ponta a ponta |
| RNF-5 | Segurança | HTTPS em tudo; Argon2; auditoria |
| RNF-6 | Qualidade | CI com lint, type-check, testes e build antes do deploy |
| RNF-7 | Privacidade | Dado sensível conforme LGPD art. 11 |
| RNF-8 | Resiliência | Transcrição é job assíncrono; falha do Sintesy não derruba a consulta |
| RNF-9 | Contrato | Contratos tipados; cliente Sintesy isolado em módulo próprio |
| RNF-10 | Zero atrito | Nenhuma sintaxe técnica digitada pelo profissional |
| RNF-11 | Fidelidade | PDF gerado reproduz o preview |

## 9. Arquitetura

Monorepo com duas aplicações e infraestrutura declarada:

```text
apps/api   Elysia (Bun) + Prisma + PostgreSQL    — API REST, jobs, integrações
apps/web   Next.js (App Router) + React          — interface
docker/    Postgres local
infra/     deploy, backup, monitoring, storage
stacks/    stack de produção (compose/swarm)
docs/      contrato, decisões (ADR), operação
```

**Módulos da API** (`apps/api/src/modules/`): `account`, `anamnesis-topics`, `appointments`, `audit`, `auth`, `communications`, `consultations`, `dashboard`, `documents`, `invites`, `notifications`, `onboarding`, `organizations`, `patients`, `roles`, `schedule`, `storage`, `team`, `templates`, `webhooks`.
**Plugins** (extensões Elysia): `auth`, `organization-access`, `request-logger`.
**Serviços compartilhados:** `sintesy-client`, `transcription-provider`, `extraction-provider`, `waha-client`, `document-pdf`, `consultation-audio-store`, `profile-photo-store`, `mailer`, `mail-templates`, `audit-logger`, `rate-limiter`, `session-token`.

### 9.1 Integrações externas

| Integração | Para quê | Contrato/Limite |
|---|---|---|
| **Sintesy** (`api.sintesy.me`) | Transcrição do áudio (modelo `stt-low`) | Server-to-server, credencial só no back-end; falha → job `falhou` + reenvio |
| **gorouter** | Extração de tópicos por LLM | Atrás de `ExtractionProvider`; trocar modelo é configuração, não refatoração |
| **WAHA** (self-hosted) | WhatsApp da clínica | 1 sessão por clínica, QR, webhook de resposta; API não oficial = risco de ban |
| **Amazon SES** | E-mail transacional | Verificação de conta, recuperação de senha, convites |
| **S3/R2** | Anexos, áudios e PDFs | Privado, servido por stream/URL assinada |

### 9.2 Decisões de arquitetura registradas

| ADR | Assunto | Status |
|---|---|---|
| ADR-002 | Contrato B2B do Sintesy (API key por aplicação/clínica) | Accepted |
| ADR-003 | Renderizador de PDF | Registrado |
| ADR-004 | Camada de acesso a dados | Registrado |

## 10. Modelo de dados

~50 modelos Prisma, agrupados por domínio:

| Domínio | Entidades principais |
|---|---|
| Identidade | `User`, `Session`, `VerificationToken`, `AuthRateLimit`, `SessionRevocationAudit`, `UserNotificationPreference` |
| Clínica e equipe | `Organization`, `Membership` (+ `OrganizationRole`), `OrganizationInvite`, `OnboardingProgress`, `Subscription` |
| Agenda | `Appointment`, `AppointmentCreationRequest`, `AppointmentConfirmation`, `ConfirmationDecision`, `WeeklyScheduleRule`, `ScheduleException`, `ProfessionalSchedulePause` |
| Pacientes | `Patient`, `PatientCreationRequest`, `PatientAttachment` |
| Atendimento e IA | `Consultation`, `ConsultationAudio`, `AudioProcessing`, `TranscriptionJob`, `AnamnesisTopicConfig`, `AnamnesisTopicRevision` |
| Documentos | `DocumentTemplate`, `DocumentTemplateVersion`, `ClinicalDocument`, `DocumentVersion` |
| WhatsApp | `WhatsappSession`, `WhatsappMessage`, `WhatsappMessageAttempt`, `WhatsappWebhookEvent`, `WhatsappTemplate`, `WhatsappTemplateVersion`, `WhatsappPreference` |
| Transversal | `AuditLog`, `StorageObject` |

Convenções: IDs UUID v4 · datas em UTC (agenda recebe ISO com offset) · dinheiro em centavos (inteiro) · soft delete/arquivamento em vez de exclusão onde há valor histórico.

## 11. Fluxos críticos

**Agendamento → confirmação**
`grade` → criar/mover consulta (409 se sobrepor) → se a clínica tem WhatsApp conectado, mensagem entra na fila → job envia → paciente responde → webhook → interpretação por palavras-chave → status atualizado (`confirmado`/`cancelado`) ou fila manual.

**Atendimento → anamnese**
abrir consulta ligada ao agendamento → consentimento → gravar no navegador (MP3, corte em 500 MB com aviso) → upload privado → job `processando` → Sintesy transcreve → gorouter extrai tópicos → tela de revisão (texto e campos lado a lado) → aprovação em 1 clique grava a anamnese e **descarta o áudio**.

**Documento → PDF**
escolher modelo e paciente → texto livre quando houver → validação de campos obrigatórios por tipo → render no back-end → snapshot imutável + PDF arquivado → central de documentos; depois disso o documento pode ser retificado ou anulado com justificativa, nunca sobrescrito.

## 12. Segurança, privacidade e LGPD

- **Papéis:** clínica = controladora; Flowcare = processador; Sintesy = subprocessador (STT).
- **Dado sensível** (art. 11): áudio descartado após transcrição; texto permanece no banco, com log de auditoria em todo acesso.
- **Minimização:** só os tópicos configurados são extraídos; conversa trivial é descartada.
- **Proteções:** Argon2, rate limit por IP/conta, respostas que não revelam se um e-mail existe, sessão invalidável, auditoria de ações sensíveis.
- **Pendências:** termo/aviso de uso de IA ao paciente; política de retenção de áudio e transcrição; verificação de habilitação profissional por tipo de documento.

## 13. Operação e entrega

| Área | Como está |
|---|---|
| CI | lint, type-check, testes e build por PR |
| Deploy | pipeline automatiza build e publicação; `docs/infra/DEPLOY.md` |
| Banco | migrações versionadas com compatibilidade retroativa; runbook próprio |
| Backup | diário, com teste de restauração em ambiente isolado |
| Observabilidade | logs estruturados; alertas e playbooks **em aberto** (#342–#344) |
| Staging | **não existe** — decisão registrada, reavaliação em aberto (#341) |

## 14. Marcos

| Período | Marco | Escopo |
|---|---|---|
| até 10/09 | AV1 / Status Report I | Problema, público, escopo, stack inicial |
| 11/09–30/09 | Prototipação e modelagem | Telas, schema, contratos, spikes de integração |
| 01/10–22/10 | **SR II — core do sistema** | Agenda, ficha, plano de testes, justificativa das mudanças |
| 23/10–15/11 | Módulos clínicos | Documentos/PDF, transcrição, WhatsApp |
| 16/11–30/11 | **SR III — homologação** | QA ponta a ponta, aceite da clínica, LGPD, operação |
| 01/12–15/12 | **AV2 — entrega final** | Demonstração, relatório de extensão, seminário |

## 15. Riscos

| Risco | Impacto | Mitigação |
|---|---|---|
| Ban do número de WhatsApp (API não oficial) | Alto | Número dedicado da clínica, ritmo conservador, sessão persistente; plano B: WhatsApp Cloud API |
| Vazamento de dado clínico | Crítico | TLS, Argon2, RBAC no servidor, auditoria, descarte do áudio |
| Indisponibilidade do Sintesy | Médio | Job assíncrono com retry/backoff e degradação para digitação manual |
| Custo de transcrição estourar | Médio | Medição por clínica, `stt-low`, alerta administrativo (sem bloqueio no MVP) |
| Fidelidade do PDF divergir do preview | Médio | Mesmo CSS no editor e no render, teste de regressão visual |
| Truncamento de áudio perder conteúdo | Médio | Aviso antes de transcrever, registro de `truncated`, gravação em partes |
| Inconsistência de horários | Alto | Trava transacional no banco, não só validação na aplicação |
| Atraso de cronograma | Médio | Priorização MoSCoW estrita + acompanhamento de sprint |

## 16. Especificação × implementação

O produto evoluiu depois da especificação: multi-clínica, confirmação de e-mail, sessões revogáveis, versionamento de documentos e armazenamento em nuvem não estavam previstos. Divergências detalhadas, com evidência no código: [`ESPECIFICACAO_VS_IMPLEMENTACAO.md`](ESPECIFICACAO_VS_IMPLEMENTACAO.md).

## 17. Índice da documentação

Comece por [`README.md`](README.md) (mapa completo). Documentos por assunto:

| Assunto | Documento |
|---|---|
| Contrato HTTP vigente | [`API_CONTRACT.md`](API_CONTRACT.md) |
| Papéis e permissões | [`RBAC_MVP.md`](RBAC_MVP.md) |
| Regras de documentos | [`DOCUMENTS_MVP.md`](DOCUMENTS_MVP.md) |
| Regras de mensageria/WhatsApp | [`MESSAGING_MVP.md`](MESSAGING_MVP.md) |
| Indicadores e consumo | [`METRICS_MVP.md`](METRICS_MVP.md) |
| Onboarding da clínica | [`ONBOARDING_STEPS.md`](ONBOARDING_STEPS.md) |
| Testes e rastreabilidade | [`TEST_PLAN_AND_TRACEABILITY.md`](TEST_PLAN_AND_TRACEABILITY.md) |
| Backlog (155 issues) | [`BACKLOG.md`](BACKLOG.md) |
| Evolução narrativa do projeto | [`EVOLUCAO_DO_PROJETO.md`](EVOLUCAO_DO_PROJETO.md) |
| Decisões de arquitetura | [`adr/`](adr/) |
| Operação e produção | [`infra/`](infra/) |
