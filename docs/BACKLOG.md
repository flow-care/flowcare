# Flowcare — Backlog e Rastreabilidade (GitHub)

*Retrato consolidado das 155 issues de `flow-care/flowcare` em 22/10/2026. O GitHub é a fonte viva; este arquivo é o índice para leitura humana e a ponte com a especificação.*

## 1. Resumo

| Métrica | Valor |
|---|---|
| Issues | 155 |
| Concluídas | 136 |
| Abertas | 19 |
| Pull requests | 156 |

### Por área

| Área | Issues | Abertas | Requisitos |
|---|---:|---:|---|
| Produto & Decisões | 9 | 0 | §10 — pré-requisito de todos os módulos |
| Infra & Operação | 11 | 4 | RNF-1, RNF-5, RNF-6, RNF-8 |
| Conta, Segurança & Auditoria | 14 | 0 | RF-E1–E6 |
| Clínica, Equipe & Acesso | 29 | 1 | RF-E2 + requisitos novos (multi-clínica, onboarding, convites) |
| Agenda & Recepção | 10 | 0 | RF-A1–A9 |
| Pacientes & Prontuário | 8 | 0 | RF-B1–B5 |
| Atendimento & IA | 31 | 1 | RF-D1–D12 |
| Documentos Clínicos | 18 | 5 | RF-C1–C10 |
| WhatsApp | 9 | 4 | RF-A8 (§3.1) |
| Painel & Gestão | 1 | 0 | RF-D10 + §5.5 + assinatura (novo) |
| QA & Homologação | 15 | 4 | RNF-6 e Épico 7 |

---

## Produto & Decisões

Decisões que destravaram o desenvolvimento: criação e entrada em clínica, multi-clínica, papéis, ciclo de vida do documento, mensagens ao paciente e significado dos números do painel.

**Requisitos:** §10 — pré-requisito de todos os módulos · **9 issues** (0 abertas)

| # | Tarefa | Tipo | Estado | Marco |
|---:|---|---|:--:|---|
| [#191](https://github.com/flow-care/flowcare/issues/191) | Definir como uma pessoa acessa mais de uma clínica | PROD | ✅ | SR II |
| [#192](https://github.com/flow-care/flowcare/issues/192) | Definir cadastro, confirmação, recuperação e sessões | PROD | ✅ | SR II |
| [#193](https://github.com/flow-care/flowcare/issues/193) | Definir como uma pessoa cria ou entra em uma clínica | PROD | ✅ | SR II |
| [#194](https://github.com/flow-care/flowcare/issues/194) | Definir o que cada papel pode consultar e alterar | PROD | ✅ | SR II |
| [#195](https://github.com/flow-care/flowcare/issues/195) | Definir quando um documento pode mudar ou ser emitido | PROD | ✅ | SR II |
| [#196](https://github.com/flow-care/flowcare/issues/196) | Definir quais mensagens o sistema envia e como trata falhas | PROD | ✅ | SR II |
| [#197](https://github.com/flow-care/flowcare/issues/197) | Definir o significado dos números do painel e do uso | PROD | ✅ | SR II |
| [#198](https://github.com/flow-care/flowcare/issues/198) | Consolidar as decisões de produto no contrato formal da API | PROD | ✅ | SR II |
| [#199](https://github.com/flow-care/flowcare/issues/199) | Consolidar o modelo de dados relacional e schema do Prisma | PROD | ✅ | SR II |

## Infra & Operação

Fundação, CI/CD, migrações, backup/restauração, armazenamento privado, e-mail transacional, observabilidade e ambiente de staging.

**Requisitos:** RNF-1, RNF-5, RNF-6, RNF-8 · **11 issues** (4 abertas)

| # | Tarefa | Tipo | Estado | Marco |
|---:|---|---|:--:|---|
| [#200](https://github.com/flow-care/flowcare/issues/200) | Preparar apps/web e apps/api para desenvolvimento conjunto | INF | ✅ | SR II |
| [#201](https://github.com/flow-care/flowcare/issues/201) | Permitir iniciar o sistema local seguindo um único guia | INF | ✅ | SR II |
| [#202](https://github.com/flow-care/flowcare/issues/202) | Padronizar e automatizar migrações de banco com compatibilidade retroativa | INF | ✅ | SR II |
| [#203](https://github.com/flow-care/flowcare/issues/203) | Automatizar rotina de backup do banco e validar restauração em ambiente isolado | INF | ✅ | SR II |
| [#204](https://github.com/flow-care/flowcare/issues/204) | Verificar web e API antes de aceitar uma alteração | INF | ✅ | SR II |
| [#205](https://github.com/flow-care/flowcare/issues/205) | Armazenar anexos, áudios e PDFs sem acesso público | INF | ✅ | SR II |
| [#206](https://github.com/flow-care/flowcare/issues/206) | Entregar e-mails de verificação, recuperação e convite | INF | ✅ | SR II |
| [#341](https://github.com/flow-care/flowcare/issues/341) | Automatizar pipeline de deploy contínuo em ambiente de staging | INF | 🔲 | SR III |
| [#342](https://github.com/flow-care/flowcare/issues/342) | Definir e validar procedimento seguro de rollback de aplicação e banco | INF | 🔲 | SR III |
| [#343](https://github.com/flow-care/flowcare/issues/343) | Estruturar logs e métricas de telemetria com proteção a dados sensíveis | INF | 🔲 | SR III |
| [#344](https://github.com/flow-care/flowcare/issues/344) | Configurar alertas automáticos e playbooks de resposta a incidentes | INF | 🔲 | SR III |

## Conta, Segurança & Auditoria

Cadastro, confirmação de e-mail, login, recuperação de senha, sessões, perfil, notificações e proteções contra abuso/enumeração.

**Requisitos:** RF-E1–E6 · **14 issues** (0 abertas)

| # | Tarefa | Tipo | Estado | Marco |
|---:|---|---|:--:|---|
| [#207](https://github.com/flow-care/flowcare/issues/207) | Criar conta e confirmar o e-mail | BE | ✅ | SR II |
| [#209](https://github.com/flow-care/flowcare/issues/209) | Recuperar senha e encerrar sessões comprometidas | BE | ✅ | SR II |
| [#210](https://github.com/flow-care/flowcare/issues/210) | Permitir que uma pessoa entre com e-mail e senha | FE | ✅ | SR II |
| [#211](https://github.com/flow-care/flowcare/issues/211) | Permitir criar uma conta e confirmar o endereço de e-mail | FE | ✅ | SR II |
| [#212](https://github.com/flow-care/flowcare/issues/212) | Permitir recuperar o acesso com um link de redefinição de senha | FE | ✅ | SR II |
| [#327](https://github.com/flow-care/flowcare/issues/327) | Registrar eventos de segurança e mudanças importantes | BE | ✅ | SR III |
| [#332](https://github.com/flow-care/flowcare/issues/332) | Alterar senha e listar sessões ativas | BE | ✅ | SR III |
| [#333](https://github.com/flow-care/flowcare/issues/333) | Revogar uma sessão ou todas as outras sessões | BE | ✅ | SR III |
| [#335](https://github.com/flow-care/flowcare/issues/335) | Salvar preferências de notificações disponíveis | BE | ✅ | SR III |
| [#336](https://github.com/flow-care/flowcare/issues/336) | Atualizar dados pessoais e foto | FE | ✅ | SR III |
| [#337](https://github.com/flow-care/flowcare/issues/337) | Alterar senha da conta pessoal com validação de segurança | FE | ✅ | SR III |
| [#338](https://github.com/flow-care/flowcare/issues/338) | Gerenciar e revogar sessões ativas da conta | FE | ✅ | SR III |
| [#339](https://github.com/flow-care/flowcare/issues/339) | Escolher preferências de notificações | FE | ✅ | SR III |
| [#356](https://github.com/flow-care/flowcare/issues/356) | Proteger autenticação contra abuso e enumeração | BE | ✅ | — |

## Clínica, Equipe & Acesso

Onboarding da primeira clínica, dados e horários de funcionamento, convites da equipe, papéis fixos (RBAC), alternância de clínica e isolamento por tenant.

**Requisitos:** RF-E2 + requisitos novos (multi-clínica, onboarding, convites) · **29 issues** (1 abertas)

| # | Tarefa | Tipo | Estado | Marco |
|---:|---|---|:--:|---|
| [#208](https://github.com/flow-care/flowcare/issues/208) | Iniciar sessão e carregar as clínicas disponíveis | BE | ✅ | SR II |
| [#213](https://github.com/flow-care/flowcare/issues/213) | Permitir aceitar um convite para participar de uma clínica | FE | ✅ | SR II |
| [#215](https://github.com/flow-care/flowcare/issues/215) | Salvar e recuperar o progresso do onboarding | BE | ✅ | SR II |
| [#216](https://github.com/flow-care/flowcare/issues/216) | Criar a primeira clínica com seu administrador | BE | ✅ | SR II |
| [#217](https://github.com/flow-care/flowcare/issues/217) | Salvar os dados e endereço da clínica | BE | ✅ | SR II |
| [#218](https://github.com/flow-care/flowcare/issues/218) | Salvar horários iniciais e concluir o onboarding | BE | ✅ | SR II |
| [#219](https://github.com/flow-care/flowcare/issues/219) | Permitir completar o perfil pessoal durante o primeiro acesso | FE | ✅ | SR II |
| [#221](https://github.com/flow-care/flowcare/issues/221) | Permitir criar a primeira clínica no onboarding | FE | ✅ | SR II |
| [#222](https://github.com/flow-care/flowcare/issues/222) | Permitir configurar os dados e o endereço da clínica | FE | ✅ | SR II |
| [#224](https://github.com/flow-care/flowcare/issues/224) | Permitir convidar a equipe durante o onboarding | FE | ✅ | SR II |
| [#225](https://github.com/flow-care/flowcare/issues/225) | Concluir o onboarding e abrir o dashboard da clínica | FE | ✅ | SR II |
| [#227](https://github.com/flow-care/flowcare/issues/227) | Listar clínicas às quais a pessoa pertence | BE | ✅ | SR II |
| [#228](https://github.com/flow-care/flowcare/issues/228) | Resolver a clínica ativa e proteger cada requisição | BE | ✅ | SR II |
| [#230](https://github.com/flow-care/flowcare/issues/230) | Criar nova clínica para usuário autenticado e persistir organização ativa | BE | ✅ | SR II |
| [#231](https://github.com/flow-care/flowcare/issues/231) | Abrir automaticamente a clínica adequada ao entrar no aplicativo | FE | ✅ | SR II |
| [#232](https://github.com/flow-care/flowcare/issues/232) | Permitir selecionar ou criar outra clínica | FE | ✅ | SR II |
| [#233](https://github.com/flow-care/flowcare/issues/233) | Mostrar uma visão geral útil da clínica no dashboard | FE | ✅ | SR II |
| [#234](https://github.com/flow-care/flowcare/issues/234) | Navegar pelo aplicativo através de layout compartilhado com seletor de clínica | FE | ✅ | SR II |
| [#307](https://github.com/flow-care/flowcare/issues/307) | Atualizar dados, endereço e logo da clínica | FE | ✅ | SR III |
| [#314](https://github.com/flow-care/flowcare/issues/314) | Convidar membro para uma clínica | BE | ✅ | SR III |
| [#315](https://github.com/flow-care/flowcare/issues/315) | Aceitar convite e criar vínculo de membro | BE | ✅ | SR III |
| [#316](https://github.com/flow-care/flowcare/issues/316) | Pós-MVP: criar papel personalizado com permissões permitidas | BE | ✅ | SR III |
| [#317](https://github.com/flow-care/flowcare/issues/317) | Alterar papel de membro protegendo contra perda do último administrador | BE | ✅ | SR III |
| [#318](https://github.com/flow-care/flowcare/issues/318) | Remover membro da clínica mantendo integridade e trilha de auditoria | BE | ✅ | SR III |
| [#319](https://github.com/flow-care/flowcare/issues/319) | Pós-MVP: atualizar permissões de papel personalizado | BE | ✅ | SR III |
| [#321](https://github.com/flow-care/flowcare/issues/321) | Convidar uma pessoa para a equipe | FE | ✅ | SR III |
| [#322](https://github.com/flow-care/flowcare/issues/322) | Alterar papel e permissões de um membro da equipe | FE | ✅ | SR III |
| [#325](https://github.com/flow-care/flowcare/issues/325) | Pós-MVP: criar ou editar papéis de acesso personalizados | FE | 🔲 | SR III |
| [#329](https://github.com/flow-care/flowcare/issues/329) | Investigar ações realizadas na clínica | FE | ✅ | SR III |

## Agenda & Recepção

Grade diária/semanal, criação, remarcação e cancelamento, bloqueios, encaixes, horários recorrentes, fila da recepção, confirmação manual e histórico de faltas.

**Requisitos:** RF-A1–A9 · **10 issues** (0 abertas)

| # | Tarefa | Tipo | Estado | Marco |
|---:|---|---|:--:|---|
| [#237](https://github.com/flow-care/flowcare/issues/237) | Reservar horário sem criar dupla reserva | BE | ✅ | SR II |
| [#238](https://github.com/flow-care/flowcare/issues/238) | Alterar horário e dados do agendamento com controle de versão | BE | ✅ | SR II |
| [#239](https://github.com/flow-care/flowcare/issues/239) | Cancelar agendamento com justificativa e preservação de histórico | BE | ✅ | SR II |
| [#240](https://github.com/flow-care/flowcare/issues/240) | Atualizar chegada e estado da fila da recepção | BE | ✅ | SR II |
| [#243](https://github.com/flow-care/flowcare/issues/243) | Acompanhar e atualizar a fila da recepção | FE | ✅ | SR II |
| [#245](https://github.com/flow-care/flowcare/issues/245) | Criar um agendamento pela agenda | FE | ✅ | SR II |
| [#247](https://github.com/flow-care/flowcare/issues/247) | Editar dados ou remarcar um agendamento existente | FE | ✅ | SR II |
| [#248](https://github.com/flow-care/flowcare/issues/248) | Cancelar agendamento com justificativa obrigatória | FE | ✅ | SR II |
| [#304](https://github.com/flow-care/flowcare/issues/304) | Manter horários recorrentes e exceções | BE | ✅ | SR III |
| [#310](https://github.com/flow-care/flowcare/issues/310) | Editar horário recorrente ou bloqueio existente | FE | ✅ | SR III |

## Pacientes & Prontuário

Cadastro sem duplicidade, busca normalizada, ficha 360°, timeline de prontuário e anexos/exames privados.

**Requisitos:** RF-B1–B5 · **8 issues** (0 abertas)

| # | Tarefa | Tipo | Estado | Marco |
|---:|---|---|:--:|---|
| [#250](https://github.com/flow-care/flowcare/issues/250) | Cadastrar paciente e sinalizar possíveis duplicidades | BE | ✅ | SR II |
| [#252](https://github.com/flow-care/flowcare/issues/252) | Atualizar cadastro do paciente com controle de conflito | BE | ✅ | SR II |
| [#253](https://github.com/flow-care/flowcare/issues/253) | Armazenar e fornecer anexos privados do paciente | BE | ✅ | SR II |
| [#254](https://github.com/flow-care/flowcare/issues/254) | Fornecer timeline cronológica e histórico de prontuário do paciente | BE | ✅ | SR II |
| [#255](https://github.com/flow-care/flowcare/issues/255) | Localizar pacientes da clínica | FE | ✅ | SR II |
| [#256](https://github.com/flow-care/flowcare/issues/256) | Cadastrar um paciente sem sair da lista | FE | ✅ | SR II |
| [#259](https://github.com/flow-care/flowcare/issues/259) | Gerenciar exames e arquivos do paciente | FE | ✅ | SR II |
| [#260](https://github.com/flow-care/flowcare/issues/260) | Corrigir os dados cadastrais de um paciente | FE | ✅ | SR II |

## Atendimento & IA

Abertura do atendimento, consentimento, captura e envio do áudio, transcrição, extração de tópicos, revisão e aprovação da anamnese.

**Requisitos:** RF-D1–D12 · **31 issues** (1 abertas)

| # | Tarefa | Tipo | Estado | Marco |
|---:|---|---|:--:|---|
| [#223](https://github.com/flow-care/flowcare/issues/223) | Permitir definir dias e horários padrão de atendimento | FE | ✅ | SR II |
| [#236](https://github.com/flow-care/flowcare/issues/236) | Consultar agendamentos por período e visualização | BE | ✅ | SR II |
| [#242](https://github.com/flow-care/flowcare/issues/242) | Consultar a agenda da clínica por dia ou semana | FE | ✅ | SR II |
| [#246](https://github.com/flow-care/flowcare/issues/246) | Consultar os detalhes de um agendamento | FE | ✅ | SR II |
| [#251](https://github.com/flow-care/flowcare/issues/251) | Buscar e consultar pacientes da clínica | BE | ✅ | SR II |
| [#257](https://github.com/flow-care/flowcare/issues/257) | Consultar o resumo do paciente | FE | ✅ | SR II |
| [#258](https://github.com/flow-care/flowcare/issues/258) | Consultar o prontuário e histórico do paciente | FE | ✅ | SR II |
| [#262](https://github.com/flow-care/flowcare/issues/262) | Listar atendimentos clínicos com paginação e filtros de busca | BE | ✅ | SR III |
| [#263](https://github.com/flow-care/flowcare/issues/263) | Abrir atendimento ligado ao agendamento e paciente | BE | ✅ | SR III |
| [#264](https://github.com/flow-care/flowcare/issues/264) | Receber áudio de forma privada após consentimento | BE | ✅ | SR III |
| [#265](https://github.com/flow-care/flowcare/issues/265) | Processar a transcrição sem duplicar tarefas ou cobranças | BE | ✅ | SR III |
| [#266](https://github.com/flow-care/flowcare/issues/266) | Salvar rascunho estruturado da anamnese com controle de concorrência | BE | ✅ | SR III |
| [#267](https://github.com/flow-care/flowcare/issues/267) | Aprovar versão final da anamnese com registro de autoria clínica | BE | ✅ | SR III |
| [#268](https://github.com/flow-care/flowcare/issues/268) | Localizar atendimentos clínicos | FE | ✅ | SR III |
| [#269](https://github.com/flow-care/flowcare/issues/269) | Consultar o resumo de um atendimento | FE | ✅ | SR III |
| [#270](https://github.com/flow-care/flowcare/issues/270) | Gravar ou enviar áudio para gerar a anamnese | FE | ✅ | SR III |
| [#271](https://github.com/flow-care/flowcare/issues/271) | Revisar e aprovar a anamnese gerada | FE | ✅ | SR III |
| [#277](https://github.com/flow-care/flowcare/issues/277) | Consultar lista paginada, detalhes e histórico de versões de documentos | BE | ✅ | SR III |
| [#283](https://github.com/flow-care/flowcare/issues/283) | Consultar o histórico de versões de um documento | FE | 🔲 | SR III |
| [#295](https://github.com/flow-care/flowcare/issues/295) | Consultar e atualizar o estado da conexão da clínica | BE | ✅ | SR III |
| [#303](https://github.com/flow-care/flowcare/issues/303) | Consultar e atualizar dados institucionais da clínica | BE | ✅ | SR III |
| [#305](https://github.com/flow-care/flowcare/issues/305) | Salvar tópicos de anamnese por profissional | BE | ✅ | SR III |
| [#306](https://github.com/flow-care/flowcare/issues/306) | Consultar consumo de transcrição por período | BE | ✅ | SR III |
| [#308](https://github.com/flow-care/flowcare/issues/308) | Consultar horários e bloqueios da clínica | FE | ✅ | SR III |
| [#309](https://github.com/flow-care/flowcare/issues/309) | Cadastrar novo horário de atendimento ou bloqueio na agenda | FE | ✅ | SR III |
| [#311](https://github.com/flow-care/flowcare/issues/311) | Configurar tópicos de anamnese por médico | FE | ✅ | SR III |
| [#312](https://github.com/flow-care/flowcare/issues/312) | Acompanhar consumo das transcrições | FE | ✅ | SR III |
| [#320](https://github.com/flow-care/flowcare/issues/320) | Consultar membros e convites da clínica | FE | ✅ | SR III |
| [#324](https://github.com/flow-care/flowcare/issues/324) | Consultar papéis de acesso e membros vinculados | FE | ✅ | SR III |
| [#328](https://github.com/flow-care/flowcare/issues/328) | Consultar eventos de auditoria da clínica | BE | ✅ | SR III |
| [#331](https://github.com/flow-care/flowcare/issues/331) | Consultar e atualizar perfil pessoal | BE | ✅ | SR III |

## Documentos Clínicos

Modelos com campos automáticos, rascunho, emissão com snapshot imutável, versionamento, retificação, anulação e PDF.

**Requisitos:** RF-C1–C10 · **18 issues** (5 abertas)

| # | Tarefa | Tipo | Estado | Marco |
|---:|---|---|:--:|---|
| [#273](https://github.com/flow-care/flowcare/issues/273) | Criar e editar rascunho de documento | BE | ✅ | SR III |
| [#274](https://github.com/flow-care/flowcare/issues/274) | Validar campos e preparar snapshot de emissão | BE | ✅ | SR III |
| [#275](https://github.com/flow-care/flowcare/issues/275) | Emitir documento e registrar versão imutável | BE | ✅ | SR III |
| [#276](https://github.com/flow-care/flowcare/issues/276) | Gerar PDF a partir do snapshot emitido | BE | ✅ | SR III |
| [#278](https://github.com/flow-care/flowcare/issues/278) | Anular documento clínico emitido com justificativa obrigatória e registro imutável | BE | ✅ | SR III |
| [#279](https://github.com/flow-care/flowcare/issues/279) | Localizar documentos clínicos da clínica | FE | ✅ | SR III |
| [#280](https://github.com/flow-care/flowcare/issues/280) | Criar um documento clínico a partir do tipo adequado | FE | ✅ | SR III |
| [#281](https://github.com/flow-care/flowcare/issues/281) | Pós-MVP: escolher modelo de receita controlada | FE | 🔲 | SR III |
| [#282](https://github.com/flow-care/flowcare/issues/282) | Visualizar e conferir a prévia de um documento | FE | ✅ | SR III |
| [#284](https://github.com/flow-care/flowcare/issues/284) | Editar um documento enquanto ele for rascunho | FE | 🔲 | SR III |
| [#285](https://github.com/flow-care/flowcare/issues/285) | Anular documento clínico emitido mediante justificativa obrigatória | FE | 🔲 | SR III |
| [#287](https://github.com/flow-care/flowcare/issues/287) | Listar modelos disponíveis para a clínica | BE | ✅ | SR III |
| [#288](https://github.com/flow-care/flowcare/issues/288) | Validar e salvar conteúdo de um modelo | BE | ✅ | SR III |
| [#289](https://github.com/flow-care/flowcare/issues/289) | Gerar prévia de modelo sem emitir documento clínico | BE | ✅ | SR III |
| [#290](https://github.com/flow-care/flowcare/issues/290) | Arquivar modelo preservando documentos existentes | BE | ✅ | SR III |
| [#291](https://github.com/flow-care/flowcare/issues/291) | Organizar modelos de documentos da clínica | FE | ✅ | SR III |
| [#292](https://github.com/flow-care/flowcare/issues/292) | Criar um modelo com campos automáticos e prévia | FE | 🔲 | SR III |
| [#293](https://github.com/flow-care/flowcare/issues/293) | Editar um modelo sem alterar documentos já emitidos | FE | 🔲 | SR III |

## WhatsApp

Conexão da sessão da clínica, modelos versionados de mensagem, fila de envio, confirmação de consulta e reenvio sem duplicidade.

**Requisitos:** RF-A8 (§3.1) · **9 issues** (4 abertas)

| # | Tarefa | Tipo | Estado | Marco |
|---:|---|---|:--:|---|
| [#241](https://github.com/flow-care/flowcare/issues/241) | Registrar decisão de confirmação manual | BE | ✅ | SR II |
| [#244](https://github.com/flow-care/flowcare/issues/244) | Resolver confirmações manuais pendentes | FE | ✅ | SR II |
| [#296](https://github.com/flow-care/flowcare/issues/296) | Registrar mensagens, processar atualizações do provedor e fornecer histórico paginado | BE | 🔲 | SR III |
| [#297](https://github.com/flow-care/flowcare/issues/297) | Reenviar uma mensagem com segurança contra duplicação | BE | 🔲 | SR III |
| [#298](https://github.com/flow-care/flowcare/issues/298) | Salvar templates de confirmação e lembrete | BE | ✅ | SR III |
| [#299](https://github.com/flow-care/flowcare/issues/299) | Conectar e recuperar a sessão do WhatsApp da clínica | FE | 🔲 | SR III |
| [#300](https://github.com/flow-care/flowcare/issues/300) | Acompanhar falhas de mensagens e reenviar com segurança | FE | ✅ | SR III |
| [#301](https://github.com/flow-care/flowcare/issues/301) | Configurar textos de confirmação e lembrete | FE | 🔲 | SR III |
| [#323](https://github.com/flow-care/flowcare/issues/323) | Remover membro da clínica com confirmação e segurança | FE | ✅ | SR III |

## Painel & Gestão

Indicadores da clínica, consumo de transcrição e estado da assinatura.

**Requisitos:** RF-D10 + §5.5 + assinatura (novo) · **1 issues** (0 abertas)

| # | Tarefa | Tipo | Estado | Marco |
|---:|---|---|:--:|---|
| [#229](https://github.com/flow-care/flowcare/issues/229) | Fornecer os indicadores definidos para o painel | BE | ✅ | SR II |

## QA & Homologação

Validação por frente: conta, onboarding, agenda, pacientes, documentos, WhatsApp, transcrição e fluxo ponta a ponta.

**Requisitos:** RNF-6 e Épico 7 · **15 issues** (4 abertas)

| # | Tarefa | Tipo | Estado | Marco |
|---:|---|---|:--:|---|
| [#214](https://github.com/flow-care/flowcare/issues/214) | Verificar cadastro, login e recuperação de acesso | QA | ✅ | SR II |
| [#226](https://github.com/flow-care/flowcare/issues/226) | Verificar criação e retomada da primeira clínica | QA | ✅ | SR II |
| [#235](https://github.com/flow-care/flowcare/issues/235) | Verificar troca de clínica e isolamento dos indicadores | QA | ✅ | SR II |
| [#249](https://github.com/flow-care/flowcare/issues/249) | Verificar reserva, conflito e fluxo da recepção | QA | ✅ | SR II |
| [#261](https://github.com/flow-care/flowcare/issues/261) | Validar busca, cadastro, timeline de prontuário e anexos do paciente | QA | ✅ | SR II |
| [#272](https://github.com/flow-care/flowcare/issues/272) | Verificar consentimento, transcrição e aprovação | QA | ✅ | SR III |
| [#286](https://github.com/flow-care/flowcare/issues/286) | Validar rascunhos, emissão, histórico de versões, anulação e geração de PDF | QA | 🔲 | SR III |
| [#294](https://github.com/flow-care/flowcare/issues/294) | Verificar edição e arquivamento de modelos | QA | 🔲 | SR III |
| [#302](https://github.com/flow-care/flowcare/issues/302) | Verificar conexão, atualização de entrega e reenvio | QA | 🔲 | SR III |
| [#313](https://github.com/flow-care/flowcare/issues/313) | Verificar horários, tópicos e métricas da clínica | QA | ✅ | SR III |
| [#326](https://github.com/flow-care/flowcare/issues/326) | Verificar convites e permissões de cada papel | QA | 🔲 | SR III |
| [#330](https://github.com/flow-care/flowcare/issues/330) | Verificar integridade e privacidade da auditoria | QA | ✅ | SR III |
| [#340](https://github.com/flow-care/flowcare/issues/340) | Verificar perfil, senha, sessões e notificações | QA | ✅ | SR III |
| [#345](https://github.com/flow-care/flowcare/issues/345) | Verificar navegação por URL, abas e sheets | QA | ✅ | AV2 |
| [#346](https://github.com/flow-care/flowcare/issues/346) | Verificar teclado, foco e layout nas jornadas essenciais | QA | ✅ | AV2 |

## 12. Tarefas abertas (fila de trabalho)

| # | Tarefa | Área | Tipo | Marco |
|---:|---|---|---|---|
| [#281](https://github.com/flow-care/flowcare/issues/281) | Pós-MVP: escolher modelo de receita controlada | Documentos Clínicos | FE | SR III |
| [#283](https://github.com/flow-care/flowcare/issues/283) | Consultar o histórico de versões de um documento | Atendimento & IA | FE | SR III |
| [#284](https://github.com/flow-care/flowcare/issues/284) | Editar um documento enquanto ele for rascunho | Documentos Clínicos | FE | SR III |
| [#285](https://github.com/flow-care/flowcare/issues/285) | Anular documento clínico emitido mediante justificativa obrigatória | Documentos Clínicos | FE | SR III |
| [#286](https://github.com/flow-care/flowcare/issues/286) | Validar rascunhos, emissão, histórico de versões, anulação e geração de PDF | QA & Homologação | QA | SR III |
| [#292](https://github.com/flow-care/flowcare/issues/292) | Criar um modelo com campos automáticos e prévia | Documentos Clínicos | FE | SR III |
| [#293](https://github.com/flow-care/flowcare/issues/293) | Editar um modelo sem alterar documentos já emitidos | Documentos Clínicos | FE | SR III |
| [#294](https://github.com/flow-care/flowcare/issues/294) | Verificar edição e arquivamento de modelos | QA & Homologação | QA | SR III |
| [#296](https://github.com/flow-care/flowcare/issues/296) | Registrar mensagens, processar atualizações do provedor e fornecer histórico paginado | WhatsApp | BE | SR III |
| [#297](https://github.com/flow-care/flowcare/issues/297) | Reenviar uma mensagem com segurança contra duplicação | WhatsApp | BE | SR III |
| [#299](https://github.com/flow-care/flowcare/issues/299) | Conectar e recuperar a sessão do WhatsApp da clínica | WhatsApp | FE | SR III |
| [#301](https://github.com/flow-care/flowcare/issues/301) | Configurar textos de confirmação e lembrete | WhatsApp | FE | SR III |
| [#302](https://github.com/flow-care/flowcare/issues/302) | Verificar conexão, atualização de entrega e reenvio | QA & Homologação | QA | SR III |
| [#325](https://github.com/flow-care/flowcare/issues/325) | Pós-MVP: criar ou editar papéis de acesso personalizados | Clínica, Equipe & Acesso | FE | SR III |
| [#326](https://github.com/flow-care/flowcare/issues/326) | Verificar convites e permissões de cada papel | QA & Homologação | QA | SR III |
| [#341](https://github.com/flow-care/flowcare/issues/341) | Automatizar pipeline de deploy contínuo em ambiente de staging | Infra & Operação | INF | SR III |
| [#342](https://github.com/flow-care/flowcare/issues/342) | Definir e validar procedimento seguro de rollback de aplicação e banco | Infra & Operação | INF | SR III |
| [#343](https://github.com/flow-care/flowcare/issues/343) | Estruturar logs e métricas de telemetria com proteção a dados sensíveis | Infra & Operação | INF | SR III |
| [#344](https://github.com/flow-care/flowcare/issues/344) | Configurar alertas automáticos e playbooks de resposta a incidentes | Infra & Operação | INF | SR III |

---

## 13. Como ler este backlog

- `BE` backend (Elysia/Prisma) · `FE` frontend (Next.js) · `INF` infraestrutura · `QA` validação · `PROD` decisão de produto.
- A área é uma classificação de leitura, derivada do título e do label — não substitui o board do GitHub.
- Cada issue de entrega carrega no corpo: contexto, entrega, regras e permissões, dependências, critérios de aceite e fora do escopo.
- A cadeia de rastreabilidade completa é `Decisão (#191–#197) → Issue de entrega (BE/FE/INF) → Issue de QA → Caso de teste → Evidência no PR`, detalhada em `TEST_PLAN_AND_TRACEABILITY.md`.
