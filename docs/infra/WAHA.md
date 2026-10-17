# WAHA — reuso da stack existente

**Decisão (issue #4): não subir outro WAHA.** O time já tem uma instância em produção desde 2026-09-25, usada pelo Flowcare pela mesma rede do traefik. Nada novo para operar.

## Instância em uso

| Item | Valor |
|---|---|
| Stack | `waha` (deployed de `/root/waha/docker-stack.yml`) |
| Domínio | `https://waha.joaotolovi.com` |
| Endereço interno (rede `traefik-public`) | `http://waha:3000` — é o `WAHA_BASE_URL` do Flowcare |
| Sessões persistidas | volume `waha_sessions` (sobrevive a restart/redeploy) |
| API key | definida no deploy; copiada em `/root/flowcare/.env` como `WAHA_API_KEY` |

## O que o Flowcare usa

1. **Envio de mensagens** (Módulo 10 do contrato) — realizado pelo cliente WAHA do backend.
   O worker só envia com `WHATSAPP_SEND_ENABLED=true`. O padrão é `false` até concluir a revisão jurídica e a configuração do webhook HMAC.
2. **Webhook de status de entrega** — o painel do WAHA deve apontar o webhook para a API:
   `https://api.flowcare.me/api/webhooks/whatsapp/status` (após o registro DNS existir),
   com HMAC SHA-512 (`X-Webhook-Hmac`) calculado com `WAHA_WEBHOOK_SECRET` (§10). Configure o evento `message.ack` e `config.webhooks[].hmac.key` com esse segredo na sessão, ou use `WHATSAPP_HOOK_HMAC_KEY` no webhook global. A API também exige `X-Webhook-Request-Id` e `X-Webhook-Timestamp`, enviados pelo WAHA.
   Os acknowledgements suportados são `ERROR/-1`, `PENDING/0`, `SERVER/1`, `DEVICE/2`, `READ/3` e `PLAYED/4`.
   Se — e somente se — a sessão usar o engine `WEBJS`, `config.webjs.tagsEventsOn` precisa estar habilitado para emitir `message.ack`; a opção vem desabilitada e pode afetar desempenho e estabilidade. Os arquivos versionados deste repositório não registram o engine nem a versão da stack externa, portanto ambos devem ser confirmados na configuração implantada antes de ativar `WHATSAPP_SEND_ENABLED`.
3. **Alerta de sessão** — `infra/monitoring/check-health.sh` polla `GET /api/sessions`
   de dentro da rede e alerta se status ≠ `WORKING` (QR pendente, desconectado).

## Se o número cair (bloqueio/desconexão)

- `check-health.sh` detecta (status ≠ WORKING) e dispara o webhook de alerta.
- Revisar sessão: `https://waha.joaotolovi.com` → novo QR code → escanar.
  As sessões NÃO se perdem (volume persistente); é só reconectar.
- Plano B (se WhatsApp banir o número): trocar para WhatsApp Cloud API —
  decisão de produto registrada na espec. §3.1, fora de escopo do MVP.
