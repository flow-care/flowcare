# Etapas do onboarding

O backend calcula a próxima etapa a partir dos dados concluídos e da ordem em
`apps/api/src/modules/onboarding/steps.ts`. O login e `GET /onboarding/progress`
usam o mesmo cálculo. O frontend encaminha para a rota correspondente em
`apps/web/lib/onboarding-steps.ts`; as páginas em `/app` exigem o onboarding
concluído.

A etapa `CLINIC_DETAILS` da issue #222 vem após a criação da clínica. O formulário
salva dados institucionais e endereço, e a API marca essa etapa como concluída.
O identificador da clínica criada fica no progresso para selecionar a clínica
correta quando a pessoa administra mais de uma.

A etapa `WEEKLY_SCHEDULE` vem após o endereço. Ela salva o fuso IANA da clínica
e os intervalos semanais em `POST /onboarding/schedule-rules`; dias fechados
podem permanecer sem intervalos. `GET /onboarding/schedule-rules` recupera a
grade para recarga da página. O envio de uma grade vazia conclui a etapa sem
definir horários de atendimento.

## Adicionar uma etapa obrigatória

1. Adicione o identificador após a etapa anterior na lista do backend.
2. Registre o mesmo identificador, título e rota na lista do frontend. O
   stepper e os redirecionamentos passam a usar essa entrada.
3. Implemente a rota e sua ação de conclusão. Ao concluir, grave em
   `OnboardingProgress` o identificador da etapa em `currentStep` e
   `completed: true`. Enquanto ela estiver em andamento, use
   `completed: false` e o mesmo `currentStep`.
4. Acrescente testes para uma conta nova, uma conta parada nessa etapa e uma
   conta que havia concluído todas as etapas antes da nova implementação.

`completed: true` no registro salvo significa que `currentStep` foi a última
etapa concluída. Se outra etapa for adicionada depois dela, o backend a
apresenta como pendente, inclusive para contas já existentes. A resposta
calculada pelo backend só indica onboarding concluído quando a última etapa
registrada foi concluída. Membros convidados sem progresso de onboarding do
dono continuam com acesso à clínica.

Se o backend registrar uma etapa antes de sua rota estar disponível no
frontend, a pessoa será enviada a `/onboarding/pending`; ela não irá ao
dashboard enquanto a etapa estiver pendente.
