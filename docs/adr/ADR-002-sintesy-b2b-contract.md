# ADR-002: Contrato B2B do Sintesy

- **Status:** Accepted
- **Origem histórica:** issue #13 (taxonomia anterior)
- **Fonte vigente:** contrato da API do Flowcare + issue atual que implementar a integração

## Contexto

A integração com o Sintesy fica isolada no backend. O frontend usa apenas a API do Flowcare e não acessa credenciais nem o contrato externo diretamente.

No contrato interno, a transcrição entra por `POST /transcriptions`. O cliente upstream do Sintesy referencia `POST /sintesy/assistant/transcribe/`.

## Contrato mínimo proposto

- Autenticação B2B por API key no header.
- O header definitivo deve ser fixado na revisão deste ADR: `Authorization: Bearer <b2b-key>` ou `X-API-Key`.
- Identificar o consumidor por `clinicId` em cada requisição.
- Manter todas as credenciais somente no backend.
- Enviar o modelo `stt-low`.
- Resposta mínima esperada: `{ transcription, durationSeconds?, requestId }`.
- Prever códigos de erro estáveis no limite entre Flowcare e Sintesy.
- Fazer retry com backoff; após esgotar as tentativas, mapear a falha externa para `502 UPSTREAM_FAILURE`.
- Medir uso por consumidor/requisição no lado Sintesy e persistir as métricas necessárias ao painel de consumo.
- Prever rotação e revogação da API key.
- Definir rate limit em acordo com o Sintesy.
- Manter fallback `service_account` enquanto o B2B não estiver disponível.
- Disponibilizar mock determinístico para desenvolvimento, QA e demonstração.

O contrato atual considera uma clínica por deploy; por isso a credencial do Sintesy é tratada como configuração única desse ambiente.

## Limite entre API interna e Sintesy

O frontend chama apenas a API do Flowcare, por exemplo:

- `POST /transcriptions` para criar o job;
- `GET /transcriptions/{id}` para polling;
- `POST /transcriptions/{id}/retry` para reenvio de job com falha.

A chamada `POST /sintesy/assistant/transcribe/` pertence ao `SintesyClient` interno do backend e não deve ser exposta diretamente ao frontend.

## Medição

Quando disponível, a integração deve permitir registrar consumidor/clínica, médico, atendimento, duração, modelo, status, `requestId` do Sintesy e custo estimado.

## Pontos ainda pendentes de validação

- Escolha final do header B2B entre `Authorization: Bearer <b2b-key>` e `X-API-Key`.
- Payload completo da API externa além de `model=stt-low` e identificação do consumidor.
- Formato completo da resposta além de `transcription`, `durationSeconds?` e `requestId`.
- Taxonomia de erros do Sintesy e mapeamento para os códigos internos.
- Fluxo exato de autenticação da conta de serviço.
- Valor e política do rate limit.
- Limites, timeouts e regras de retry aceitos pelo provedor.
- Semântica de cobrança e dados de custo disponibilizados pelo Sintesy.

## Consequências

O `SintesyClient` deve ser implementado atrás desta fronteira, preservando o contrato interno do Flowcare. Este ADR permanece `Proposed` até a equipe revisar os pontos pendentes com o responsável pelo Sintesy.
