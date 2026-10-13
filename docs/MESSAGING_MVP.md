# Flowcare — mensagens operacionais no MVP

**Origem:** decisão de produto #196. Esta especificação define o comportamento esperado; o envio de mensagens ainda não está implementado na API. A instância WAHA existente está descrita em [WAHA.md](infra/WAHA.md).

## Catálogo de disparos

| Evento | Canal e destinatário | Quando | Variáveis permitidas | Condição |
|---|---|---|---|---|
| Agendamento criado | WhatsApp do paciente | Após a confirmação da gravação do agendamento | `{paciente_nome}`, `{data}`, `{hora}`, `{medico_nome}`, `{clinica_nome}` | Opt-in ativo e número válido |
| Agendamento cancelado | WhatsApp do paciente | Após a confirmação do cancelamento | `{paciente_nome}`, `{data}`, `{hora}`, `{clinica_nome}` | Opt-in ativo e número válido |
| Lembrete | WhatsApp do paciente | Uma vez, 24 horas antes do horário local da consulta | `{paciente_nome}`, `{data}`, `{hora}`, `{medico_nome}`, `{clinica_nome}` | Opt-in ativo; agendamento ainda válido; sem lembrete anterior para a mesma versão |
| Autenticação e convite | E-mail do usuário convidado ou titular da conta | No fluxo de autenticação/convite correspondente | Variáveis próprias do fluxo | Fora da preferência de WhatsApp do paciente |

O horário de 24 horas considera o fuso configurado da clínica. Mudança de horário cancela o lembrete pendente e cria um novo evento para a nova versão do agendamento. Cancelamento também cancela lembretes pendentes. Não há mensagens de confirmação de presença, resposta automática, chat, campanhas ou conteúdo clínico no MVP. Uma resposta do paciente não altera automaticamente o agendamento.

## Preferência e conteúdo

O envio operacional por WhatsApp exige opt-in explícito registrado por clínica e paciente, com data/hora, origem e quem registrou. Sem registro ou após opt-out, não se cria novo envio. A recepção pode registrar a preferência informada pelo paciente; a revogação interrompe mensagens futuras e cancela as ainda enfileiradas quando possível. O histórico já enviado é preservado para auditoria. A mensagem informa a clínica e como pedir a interrupção dos contatos. E-mails de segurança/convite seguem os fluxos próprios e não dependem desse opt-in.

Templates são limitados aos três eventos de WhatsApp acima. Variáveis desconhecidas são recusadas. Diagnóstico, medicamento, hipótese clínica e conteúdo de prontuário são proibidos nos textos; como texto livre não permite detecção confiável, a clínica deve revisar o template antes de ativá-lo. O texto usa apenas informações logísticas necessárias; nome de profissional e da clínica são opcionais conforme o template aprovado. O armazenamento e os logs não devem expor telefone completo, credencial, token ou conteúdo clínico.

Esta é uma política de produto conservadora para o canal. A base legal e os avisos de privacidade de cada clínica precisam de revisão jurídica antes da operação real; o opt-in por si só não substitui essa revisão. A [LGPD](https://www.planalto.gov.br/ccivil_03/_ato2015-2018/2018/lei/l13709.htm) disciplina o tratamento de dados pessoais, e a [ANPD](https://www.gov.br/anpd/pt-br/assuntos/noticias/anpd-conclui-a-analise-sobre-compartilhamento-de-dados-pessoais-entre-whatsapp-e-meta) destaca transparência no uso do WhatsApp.

## Fila, estados e idempotência

O agendamento é salvo sem esperar o WAHA. No mesmo fluxo transacional, uma saída persistente registra o evento de mensagem; o worker a processa depois. A chave lógica única é `organizationId + eventId + channel`, em que `eventId` identifica uma mudança de estado ou uma versão de lembrete do agendamento. Reprocessar o mesmo evento não cria outra mensagem. Cada tentativa de envio tem identificador próprio e conserva o vínculo com a mensagem lógica e com o hash do identificador retornado pelo provedor, que pode conter o telefone do destinatário. A chave `Idempotency-Key` é exigida no reenvio manual; repetir a mesma chave devolve o mesmo resultado.

| Estado | Significado |
|---|---|
| `QUEUED` | Persistida, aguardando tentativa; inclui reenvio agendado. |
| `SENT` | Provedor aceitou a tentativa; entrega ao aparelho ainda não confirmada. |
| `DELIVERED` | Provedor confirmou entrega. |
| `READ` | Provedor confirmou leitura. |
| `FAILED` | Falha definitiva ou tentativas automáticas esgotadas. |

O webhook autenticado usa segredo configurado e deduplica pelo identificador do evento do provedor. Atualizações repetidas ou fora de ordem não retrocedem `READ → DELIVERED → SENT`; `DELIVERED` ou `READ` prevalece sobre uma falha tardia. Quando o resultado do provedor é desconhecido após timeout, o sistema consulta/reconcilia antes de novo envio, para não mandar uma segunda cópia por engano.

Falhas temporárias conhecidas tentam novamente até três vezes no total, com espera de 1 e 5 minutos. Falhas definitivas, número inválido, falta de opt-in ou mensagem já aceita pelo provedor não entram em retry automático. Após esgotar as tentativas, `FAILED` fica visível à equipe. Reenvio manual só é permitido em `FAILED`, após nova verificação de consentimento, telefone, estado do agendamento e permissão; registra autor e instante. `SENT`, `DELIVERED` e `READ` não podem ser reenviadas. Desconexão do WAHA deixa itens na fila e alerta a equipe, sem bloquear agendamentos.

## Execução

Conexão #295; registro, fila e webhook #296; reenvio #297; templates #298; interface #299–#301; QA #302. A revisão jurídica da preferência de canal e o procedimento de operação do WAHA devem ser concluídos antes de ativar disparos reais para pacientes.
