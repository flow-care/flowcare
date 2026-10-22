# Flowcare — Documentação

Ponto de entrada único da documentação do projeto. Se você só tem cinco minutos, leia a seção 1. Se vai mexer no código, leia a 2.

---

## 1. Por onde começar

| Você é / quer | Leia nesta ordem |
|---|---|
| **Produto / banca / novo integrante** | [`PROJETO_VISAO_GERAL.md`](PROJETO_VISAO_GERAL.md) → [`EVOLUCAO_DO_PROJETO.md`](EVOLUCAO_DO_PROJETO.md) → [`BACKLOG.md`](BACKLOG.md) |
| **Backend** | [`API_CONTRACT.md`](API_CONTRACT.md) → [`PROJETO_VISAO_GERAL.md`](PROJETO_VISAO_GERAL.md) §9–10 → [`adr/`](adr/) → [`infra/DEPLOY.md`](infra/DEPLOY.md) |
| **Frontend** | [`API_CONTRACT.md`](API_CONTRACT.md) → [`RBAC_MVP.md`](RBAC_MVP.md) → [`DOCUMENTS_MVP.md`](DOCUMENTS_MVP.md) / [`MESSAGING_MVP.md`](MESSAGING_MVP.md) |
| **QA** | [`TEST_PLAN_AND_TRACEABILITY.md`](TEST_PLAN_AND_TRACEABILITY.md) → [`BACKLOG.md`](BACKLOG.md) §12 (fila aberta) |
| **Operação / plantão** | [`infra/DEPLOY.md`](infra/DEPLOY.md) → [`infra/MONITORING.md`](infra/MONITORING.md) → [`infra/BACKUP.md`](infra/BACKUP.md) |
| **Auditoria de escopo** | [`ESPECIFICACAO_VS_IMPLEMENTACAO.md`](ESPECIFICACAO_VS_IMPLEMENTACAO.md) |

## 2. Mapa da documentação

### 2.1 Projeto e produto

| Documento | Responde |
|---|---|
| [`PROJETO_VISAO_GERAL.md`](PROJETO_VISAO_GERAL.md) | O que é o sistema, para quem, com qual escopo, requisitos, arquitetura, dados, fluxos, riscos e marcos |
| [`EVOLUCAO_DO_PROJETO.md`](EVOLUCAO_DO_PROJETO.md) | Como o projeto chegou até aqui, em linguagem de produto |
| [`BACKLOG.md`](BACKLOG.md) | As 155 tarefas do GitHub por área, com estado e vínculo com os requisitos |
| [`ESPECIFICACAO_VS_IMPLEMENTACAO.md`](ESPECIFICACAO_VS_IMPLEMENTACAO.md) | Onde o construído difere do especificado — e o que fazer com cada diferença |
| [`fontes/`](fontes/) | Os dois PDFs originais (especificação de requisitos e contrato de API) |

### 2.2 Contrato e regras

| Documento | Responde |
|---|---|
| [`API_CONTRACT.md`](API_CONTRACT.md) | Contrato HTTP vigente: rotas, payloads, erros, enums, RBAC por endpoint |
| [`RBAC_MVP.md`](RBAC_MVP.md) | Quem pode o quê, por capacidade e por papel |
| [`DOCUMENTS_MVP.md`](DOCUMENTS_MVP.md) | Ciclo de vida do documento clínico, campos, emissão, retificação, anulação |
| [`MESSAGING_MVP.md`](MESSAGING_MVP.md) | Quais mensagens o sistema envia e como trata falhas |
| [`METRICS_MVP.md`](METRICS_MVP.md) | O que cada número do painel e do consumo significa |
| [`ONBOARDING_STEPS.md`](ONBOARDING_STEPS.md) | Passo a passo de criação da clínica no primeiro acesso |
| [`TEST_PLAN_AND_TRACEABILITY.md`](TEST_PLAN_AND_TRACEABILITY.md) | Estratégia de testes, invariantes e matriz de rastreabilidade |

### 2.3 Decisões e operação

| Documento | Responde |
|---|---|
| [`adr/`](adr/) | Decisões de arquitetura (contrato B2B do Sintesy, renderizador de PDF, acesso a dados) |
| [`infra/DEPLOY.md`](infra/DEPLOY.md) | Como publicar |
| [`infra/BACKUP.md`](infra/BACKUP.md) | Como o banco é salvo e como se testa a restauração |
| [`infra/MIGRATION_RUNBOOK_FLOWCARE.md`](infra/MIGRATION_RUNBOOK_FLOWCARE.md) | Como rodar migração com segurança |
| [`infra/MONITORING.md`](infra/MONITORING.md) | O que é observado |
| [`infra/SECRETS.md`](infra/SECRETS.md) | Quais segredos existem e onde ficam |
| [`infra/STORAGE_R2.md`](infra/STORAGE_R2.md) | Armazenamento privado de arquivos |
| [`infra/WAHA.md`](infra/WAHA.md) | Operação do WhatsApp self-hosted |
| [`infra/SES_EVENTS.md`](infra/SES_EVENTS.md) | Eventos de e-mail transacional |
| [`infra/PRODUCTION_VALIDATION_203.md`](infra/PRODUCTION_VALIDATION_203.md) | Checklist de validação em produção |

---

## 3. O que uma documentação de projeto de sistema costuma ter

Checklist de referência. A coluna **Aqui** mostra o que já existe neste projeto.

| # | Bloco | Para que serve | Aqui |
|---:|---|---|:--:|
| 1 | **Visão geral e problema** | Explicar em uma página por que o sistema existe | ✅ `PROJETO_VISAO_GERAL.md` §2–3 |
| 2 | **Público, personas e casos de uso** | Saber para quem se constrói | ✅ §4 |
| 3 | **Escopo e não-escopo** | Evitar promessa implícita e controlar expectativa | ✅ §5 |
| 4 | **Requisitos funcionais e não funcionais** | A base contract: o que o sistema faz e com que qualidade | ✅ §7–8 |
| 5 | **Regras de negócio e permissões** | O que pode acontecer, por quem, em que ordem | ✅ `RBAC_MVP`, `DOCUMENTS_MVP`, `MESSAGING_MVP` |
| 6 | **Arquitetura e stack** | Como as peças se encaixam e por quê | ✅ §9 |
| 7 | **Modelo de dados** | Entidades, relações, convenções | ✅ §10 + `schema.prisma` |
| 8 | **Contrato de API** | Fonte única entre back e front | ✅ `API_CONTRACT.md` |
| 9 | **Integrações externas** | Contratos, limites, falhas e fallback | ✅ §9.1 + ADR-002 |
| 10 | **Fluxos críticos** | O caminho de ponta a ponta, em passos | ✅ §11 |
| 11 | **Decisões de arquitetura (ADR)** | Por que escolhemos assim, e o que foi descartado | 🟡 3 ADRs; integração Sintesy e storage pedem atualização |
| 12 | **Segurança e privacidade/LGPD** | Dado sensível: base legal, retenção, descarte | 🟡 falta termo de consentimento e política de retenção |
| 13 | **Estratégia e plano de testes** | Como se prova que funciona | ✅ `TEST_PLAN_AND_TRACEABILITY.md` |
| 14 | **Operação: deploy, backup, monitoramento, incidentes** | Como manter no ar e voltar atrás | 🟡 existe deploy/backup; **faltam alertas e playbooks** (#342–#344) e não há staging |
| 15 | **Backlog, roadmap e marcos** | O que falta, em que ordem, até quando | ✅ `BACKLOG.md` + §14 |
| 16 | **Guia de desenvolvimento** | Como rodar, testar e contribuir | ✅ `README.md` raiz + `CONTRIBUTING.md` |
| 17 | **Riscos e mitigações** | O que pode dar errado e o que fazer | ✅ §15 |
| 18 | **Glossário** | Alinhar vocabulário (evita "clínica" significar três coisas) | ❌ **não existe** |
| 19 | **Registro de mudanças / changelog** | Justificar mudanças de escopo (exigido pós-AV1) | 🟡 a especificação tem a tabela; falta um changelog contínuo |
| 20 | **Onboarding de novo dev** | Primeiro dia produtivo sem perguntar tudo | 🟡 README + `ONBOARDING_STEPS` (que é do produto, não do dev) |

**Lacunas mais caras hoje:** glossário (18), observabilidade/playbooks (14) e o registro contínuo de mudanças (19). Os três são baratos de fazer e têm alto retorno.

---

## 4. Convenções desta documentação

- **Fonte viva:** GitHub (issues e PRs) e `schema.prisma`/`API_CONTRACT.md` mandam mais que qualquer documento. Documento desatualizado é dívida — corrija na mesma PR que muda o comportamento.
- **IDs estáveis:** requisitos usam `RF-A1`…`RF-E6` e `RNF-1`…`RNF-11`; tarefas usam `#123`. Ao citar um requisito, cite o ID.
- **Situação declarada:** quando um documento diz "implementado", ele foi conferido no código ou no backlog. Validação formal é do QA.
- **Um assunto por arquivo:** documento novo só quando o assunto não cabe em nenhum existente; caso contrário, estenda o existente.
- **Idioma:** português; termos de código (rotas, enums, campos) no original, entre crases.
