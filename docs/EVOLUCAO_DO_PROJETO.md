# Flowcare — Evolução do projeto

*Visão de alto nível: produto e desenvolvimento juntos. Situação em 22/10/2026 (entrega do Status Report II).*

---

## Em uma frase

O Flowcare (antes MedFlow / MedicalFlow) é um sistema web de **agenda e prontuário para clínicas pequenas**, com um diferencial: o médico grava a consulta e a IA redige a anamnese para ele revisar e aprovar. Em cerca de seis semanas de desenvolvimento, a equipe construiu quase todo o sistema da clínica. **O diferencial (a IA) ainda não está ligado de verdade**, e a versão que está no ar é de 09/10.

## Números do caminho

| | |
|---|---|
| Início do repositório | 22/09/2026 |
| Mudanças integradas (PRs) | 149 |
| Tarefas no board | 155 (135 concluídas, 20 abertas) |
| Marco SR II (22/10) | 70 de 70 tarefas concluídas |
| Marco SR III (30/11) | 62 concluídas, 20 abertas |
| Arquivos de teste automatizado | 109 |

---

## As etapas

### 1. Concepção e planejamento — até 10/09 (Status Report I / AV1)

**Produto:** foi definido o problema (a clínica pequena perde tempo com agenda, faltas de pacientes e papelada), o público (consultório solo e clínica de pequeno porte), o escopo do MVP e o que fica de fora (SMS pago, assinatura digital ICP-Brasil, faturamento de convênio, diagnóstico por IA).

**Desenvolvimento:** a equipe e os papéis foram definidos, o cronograma foi amarrado aos marcos avaliativos e houve a primeira escolha de tecnologia.

### 2. Organização e decisões de produto — 22 a 27/09

**Produto:** as perguntas que travariam o desenvolvimento foram respondidas antes de começar a construir:
- como alguém cria uma clínica ou entra numa;
- uma pessoa pode participar de várias clínicas;
- o que cada papel (administrador, médico, recepção) pode ver e fazer;
- quando um documento clínico pode ser alterado e quando vira definitivo;
- quais mensagens o sistema manda ao paciente;
- o que significam os números do painel.

Também ficou decidido que **a IA só redige e nunca sugere diagnóstico**, e que o modelo de negócio é uma assinatura por clínica, paga pelo dono.

**Desenvolvimento:**
- Houve uma troca de tecnologia, justificada no relatório: a transcrição passou a usar a API do Sintesy em vez de um modelo próprio.
- O trabalho foi quebrado em cerca de 60 tarefas por área (infra, backend, frontend, QA).
- Foram escritos o contrato da API, o plano de testes e os registros de decisão de arquitetura.

### 3. Fundação de produção — 28/09

Antes de existir qualquer funcionalidade, o "esqueleto" já estava no ar: servidor, domínio com HTTPS, publicação automatizada, banco de dados, backup diário e monitoramento.

**Por que importa:** daqui em diante, toda entrega podia ir para um ambiente real, e não só rodar no computador de quem desenvolveu.

### 4. Entrada no sistema e configuração da clínica — 01 a 11/10

**Produto:** a primeira experiência completa de uso:
- cadastro, confirmação por e-mail, login, recuperação de senha e controle de sessões;
- criação da primeira clínica com um passo a passo (dados, endereço, logo, horário de funcionamento);
- convite da equipe por e-mail, com papel definido;
- troca entre várias clínicas, lembrando a última usada.

**Marca:** em 06/10 o projeto passou a se chamar **Flowcare**, com domínio próprio (flowcare.me) e identidade visual nova.

**Desenvolvimento:**
- E-mail transacional real.
- Armazenamento privado de arquivos por clínica.
- Backup com teste de restauração comprovado.
- Permissões checadas em cada ação.

### 5. Núcleo clínico (motor) — 12 a 14/10

Toda a regra de negócio do dia a dia da clínica foi construída por trás das telas:
- **Agenda:** marcar, remarcar e cancelar sem horários conflitantes, confirmação manual, fila da recepção (chegou, em atendimento, finalizado), horários recorrentes e bloqueios.
- **Pacientes:** cadastro sem duplicidade, busca rápida por nome, CPF ou telefone, anexos e exames, e um prontuário em linha do tempo.
- **Atendimento:** abrir a consulta ligada ao agendamento, gravar o áudio com consentimento, enviar para transcrição e salvar e aprovar a anamnese com registro de autoria do médico.
- **Documentos clínicos:** modelos da clínica, rascunho, emissão com versão imutável, retificação, anulação com justificativa e geração de PDF.
- **Gestão:** papéis da equipe, trilha de auditoria (quem fez o quê), painel com indicadores e consumo de transcrição.

### 6. Telas do produto — 14 a 17/10

Tudo o que a etapa anterior construiu ganhou interface: agenda diária e semanal, fila da recepção, ficha do paciente, prontuário, gravação de áudio, revisão da anamnese, documentos com pré-visualização, equipe, auditoria, configurações da clínica e da conta pessoal.

**Resultado:** o fluxo completo da clínica passa a ser navegável de ponta a ponta.

### 7. Comunicação com o paciente e segurança — 17 a 19/10

- WhatsApp da clínica: modelos de mensagem com versão, fila de envio com acompanhamento de entrega e reenvio seguro (sem mandar a mesma mensagem duas vezes).
- Proteção do login contra ataques de força bruta e contra a descoberta de quais e-mails estão cadastrados.

**Marco SR II (22/10):** todas as 70 tarefas do marco foram concluídas.

---

## Onde estamos

| Área | Situação |
|---|---|
| Entrada, conta e clínicas | ✅ Pronto |
| Equipe, papéis e auditoria | ✅ Pronto |
| Agenda e recepção | ✅ Pronto |
| Pacientes e prontuário | ✅ Pronto |
| Documentos clínicos e PDF | 🟡 Quase: faltam algumas telas (edição de rascunho, histórico, criação e edição de modelos) |
| WhatsApp | 🟡 Envio e reenvio prontos por trás; faltam as telas de conexão, falhas e textos |
| **IA: transcrição e anamnese** | 🔴 **O fluxo existe, mas o "motor" é simulado**: não há conexão real com o Sintesy nem extração de tópicos por IA |
| **Versão no ar** | 🔴 **Produção parada em 09/10**: cerca de 130 mudanças (agenda, pacientes, prontuário, documentos, WhatsApp) ainda não foram publicadas |
| Operação (staging, rollback, logs, alertas) | ⚪ Não iniciado |
| Homologação (QA) | 🟡 4 frentes de validação abertas |

---

## O que falta

### A. Para o produto entregar o que promete (prioridade máxima)

1. **Ligar a IA de verdade.** Hoje o médico grava a consulta, mas nada transcreve nem redige. Faltam três coisas:
   - a integração real com a transcrição do Sintesy (o acordo técnico, ADR-002, ainda está como "proposto");
   - a etapa que transforma a transcrição em anamnese organizada por tópicos (a configuração já existe no servidor, mas o código não);
   - um teste com áudio real de consulta.

   **Sem isso, o Flowcare é uma boa agenda com prontuário, sem o diferencial.**
2. **Publicar a versão atual.** A publicação hoje é manual e não acontece desde 09/10. Quem acessar o site agora vê só o cadastro e o onboarding, e não a agenda, os pacientes ou o prontuário.

### B. Completar as funcionalidades — até o SR III (30/11)

- **WhatsApp:** tela para conectar e reconectar o número da clínica, acompanhamento das mensagens que falharam e configuração dos textos de confirmação e lembrete.
- **Documentos:** telas de edição do rascunho, histórico de versões e anulação, e criação e edição de modelos com campos automáticos.

Algumas dessas tarefas já foram entregues em parte em mudanças integradas. Vale conferir antes de reabrir trabalho.

### C. Homologação — tema central do SR III

O QA ainda precisa validar quatro frentes: permissões de cada papel e convites; documentos (rascunho até PDF); modelos; e WhatsApp (conexão, entrega e reenvio). Depois disso, é preciso testar o fluxo inteiro como uma clínica real usaria: marcar → receber → atender → gravar → aprovar → emitir documento.

### D. Operação confiável (tarefas do João, SR III)

- **Voltar atrás com segurança** quando uma publicação der problema (aplicação e banco).
- **Registros e métricas** que ajudem a investigar falhas sem expor dados de paciente.
- **Alertas automáticos** e um guia do que fazer em cada incidente.
- **Ambiente de testes (staging):** o projeto foi montado sem ele, por decisão. É preciso decidir com a equipe se ele será criado ou se a tarefa muda.

### E. Decisões que continuam em aberto

- Termo de consentimento e adequação à LGPD (dado de saúde é sensível).
- Por quanto tempo áudios e transcrições ficam guardados.
- Custo por minuto de transcrição, que define se os R$ 89/mês por clínica fecham a conta.
- O formato final do acordo técnico com o Sintesy (chave de acesso, limites, troca de chave).

### F. Fora do MVP (registrado para depois)

Papéis de acesso personalizados, receita controlada, cobrança automática da assinatura (hoje o sistema só registra o estado da assinatura, sem gateway de pagamento) e confirmação de consulta pelo WhatsApp oficial (plano B).

---

## Próximos marcos

| Marco | Data | O que precisa estar de pé |
|---|---|---|
| SR III — homologação e testes | 30/11 | IA funcionando com áudio real, versão atual publicada, WhatsApp e documentos completos, QA validado, operação com rollback e alertas |
| AV2 — entrega final e seminário | 15/12 | Demonstração do fluxo completo de uma clínica, documentação e apresentação do impacto de extensão |

**Leitura geral:** o projeto está adiantado em volume (o SR II foi fechado inteiro) e atrasado no que o torna único. A ordem que mais reduz risco até 30/11 é:
1. publicar o que já existe;
2. ligar a IA real;
3. fechar WhatsApp e documentos;
4. homologar.
