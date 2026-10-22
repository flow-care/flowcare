# Flowcare — mensagens operacionais no MVP

**Origem:** decisão de produto #196. Esta especificação define o comportamento implementado para registro, fila e envio da #296; o reenvio manual da #297 permanece planejado. A instância WAHA existente está descrita em [WAHA.md](infra/WAHA.md).

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

Templates são limitados aos três eventos de WhatsApp acima. Variáveis desconhecidas são recusadas. Diagnóstico, medicamento, hipótese clínica e conteúdo de prontuário são proibidos nos textos; como texto livre não permite detecção confiável, um membro autorizado da clínica deve revisar o template antes de salvá-lo e ativá-lo. O texto usa apenas informações logísticas necessárias; nome de profissional e da clínica são opcionais conforme o template aprovado. O armazenamento e os logs não devem expor telefone completo, credencial, token ou conteúdo clínico.

O worker seleciona o template corrente do tipo correspondente dentro da organização e fixa seu snapshot imutável em `WhatsAppMessage.templateVersionId` antes da primeira tentativa. Retentativas usam a mesma versão, mesmo que um novo texto seja ativado depois. Sem template corrente elegível, a mensagem termina em `FAILED` com diagnóstico e nada é enviado.

Para o envio, telefones nacionais brasileiros são aceitos somente como DDD + assinante (10 ou 11 dígitos) e convertidos para E.164 com `+55`; um DDD `55` continua sendo tratado como DDD. Um número brasileiro já completo com `+55` é preservado. Números internacionais não brasileiros e entradas incompletas ou ambíguas não fazem parte do contrato atual e são retidos, nunca recebem prefixo presumido.

**Decisão provisória do MVP para a #298:** a gravação por um membro ativo com `communications:write` — `ADMIN`, `ADMIN_PROFESSIONAL` ou `RECEPTIONIST` — equivale à revisão, aprovação e ativação da nova versão, que passa imediatamente a ser a versão corrente. Não há estado de rascunho nem endpoint de aprovação ou ativação separado nesta fase. Cada texto aceita no máximo 4.096 caracteres; esse limite fica centralizado na API e deve ser reavaliado quando o contrato definitivo do provedor e do produto for homologado. A auditoria identifica o membro responsável e registra organização, tipo, versões, instante de aprovação, campos alterados e variáveis utilizadas, mas não copia o conteúdo do texto para os metadados.

Esta é uma política de produto conservadora para o canal. A base legal e os avisos de privacidade de cada clínica precisam de revisão jurídica antes da operação real; o opt-in por si só não substitui essa revisão. A [LGPD](https://www.planalto.gov.br/ccivil_03/_ato2015-2018/2018/lei/l13709.htm) disciplina o tratamento de dados pessoais, e a [ANPD](https://www.gov.br/anpd/pt-br/assuntos/noticias/anpd-conclui-a-analise-sobre-compartilhamento-de-dados-pessoais-entre-whatsapp-e-meta) destaca transparência no uso do WhatsApp.

## Fila, estados e idempotência

O agendamento é salvo sem esperar o WAHA. No mesmo fluxo transacional, uma saída persistente registra o evento de mensagem; o worker a processa depois. A chave lógica única implementada é `organizationId + eventId + type`, em que `eventId` identifica uma mudança de estado ou uma versão de lembrete do agendamento. Reprocessar o mesmo evento e tipo não cria outra mensagem. Cada tentativa de envio tem identificador próprio e conserva o vínculo com a mensagem lógica e com o hash do identificador retornado pelo provedor, que pode conter o telefone do destinatário. O contrato planejado do reenvio manual da #297 exigirá `Idempotency-Key`; essa operação ainda não está implementada.

| Estado | Significado |
|---|---|
| `QUEUED` | Persistida, aguardando tentativa; inclui reenvio agendado. |
| `UNCERTAIN` | A tentativa pode ter sido aceita pelo provedor, mas o resultado não pôde ser confirmado; exige acompanhamento e nunca é reenviada automaticamente. |
| `SENT` | Provedor aceitou a tentativa; entrega ao aparelho ainda não confirmada. |
| `DELIVERED` | Provedor confirmou entrega. |
| `READ` | Provedor confirmou leitura. |
| `FAILED` | Falha definitiva ou tentativas automáticas esgotadas. |

O webhook autenticado usa segredo configurado e deduplica, por organização, pela impressão SHA-256 do corpo bruto autenticado; assim, alterar o `X-Webhook-Request-Id` não permite reapresentar o mesmo evento assinado. O evento persiste somente essa impressão e o hash do identificador da mensagem, inclusive quando o `message.ack` chega antes de o worker salvar esse hash em `WhatsAppMessage`. Webhook e worker serializam a correlação pelo mesmo advisory lock transacional; quem concluir por último associa os eventos pendentes e reconcilia o estado automaticamente. Atualizações repetidas ou fora de ordem não retrocedem `READ → DELIVERED → SENT`; `DELIVERED` ou `READ` prevalece sobre uma falha `ERROR` tardia. `PENDING` é aceito sem alterar o estado local. `ERROR` move apenas `QUEUED`, `UNCERTAIN` ou `SENT` para `FAILED`; uma confirmação posterior de entrega ou leitura pode superar `FAILED`. Quando uma resposta aceita forneceu identificador antes de uma falha local, seu hash é preservado e um `message.ack` posterior pode reconciliar `UNCERTAIN` para `SENT`, `DELIVERED` ou `READ`.

O WAHA não oferece no contrato usado pelo projeto uma chave idempotente para `sendText`, nem permite consultar com segurança uma tentativa cujo identificador não retornou. Por isso timeout, resposta inválida, HTTP `408`, HTTP `429`, HTTP `5xx` e lease expirado durante uma tentativa são classificados como `UNCERTAIN`, ficam visíveis no histórico e não voltam à fila. Sem hash correlacionável, a resolução exige apuração operacional; nenhum segundo envio é iniciado enquanto o resultado original continuar desconhecido.

O mecanismo admite falhas temporárias somente quando uma integração puder comprovar que a tentativa não chegou ao provedor; nesses casos, tenta novamente até três vezes no total, com espera de 1 e 5 minutos. Nenhuma resposta HTTP atual de `sendText` é classificada dessa forma sem garantia documentada. Falhas definitivas, número inválido, falta de opt-in, resultado incerto ou mensagem já aceita pelo provedor não entram em retry automático. Após esgotar as tentativas, `FAILED` fica visível à equipe. O reenvio manual seguro pertence à #297 e ainda não está implementado; `UNCERTAIN`, `SENT`, `DELIVERED` e `READ` não podem ser reenviadas. Desconexão do WAHA deixa itens na fila, sem bloquear agendamentos.

## Interface web (#299–#301)

Rota única `/app/:orgSlug/whatsapp`, com abas por query string:

| Aba | URL | Quem acessa | API usada |
|---|---|---|---|
| Conexão | `/whatsapp` (ou `?tab=connection`) | `ADMIN`, `ADMIN_PROFESSIONAL` (`settings:write`) | `GET …/whatsapp/status` (polling), `POST …/whatsapp/reconnect` |
| Mensagens | `?tab=messages&status=&period=&cursor=` | `ADMIN`, `ADMIN_PROFESSIONAL`, `RECEPTIONIST` | `GET …/messages`, `POST …/messages/:id/resend` |
| Textos das mensagens | `?tab=settings` | `ADMIN`, `ADMIN_PROFESSIONAL` | `GET/PUT …/whatsapp/templates[/:type]` |

Outros papéis veem o aviso 403 na aba restrita; o recepcionista abre direto em Mensagens. O navegador nunca chama a API diretamente: status e QR passam por route handlers do Next (`/api/organizations/:orgSlug/whatsapp/{status,qr}`) com `Cache-Control: no-store`; o QR fica só em memória do componente, expira no cronômetro e nunca é registrado em log. O reenvio gera uma `Idempotency-Key` por mensagem e trava cliques repetidos. Os textos padrão de “Restaurar padrão” vivem no frontend (`apps/web/lib/whatsapp.ts`), pois a API não cria textos implícitos; restaurar apenas preenche o editor e o texto só vale após “Salvar e ativar”. A desconexão voluntária ainda não existe na API: o painel orienta remover o aparelho pelo WhatsApp do celular.

## Execução

Conexão #295; registro, fila e webhook #296; reenvio #297; templates #298; interface #299–#301; QA #302. A revisão jurídica da preferência de canal e o procedimento de operação do WAHA devem ser concluídos antes de ativar disparos reais para pacientes.
