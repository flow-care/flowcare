# Armazenamento privado do Flowcare

O bucket de arquivos deve ser privado e não deve ter domínio público ou acesso anônimo. A aplicação usa o endpoint S3 do R2 e assina operações somente depois de validar uma `Membership` ativa.

## Regras

- Chaves começam sempre com `organizations/<organizationId>/`, seguido da categoria: `organizations/<organizationId>/audio/...`, `organizations/<organizationId>/pdf/...` ou `organizations/<organizationId>/attachment/...`.
- URLs de upload expiram em 10 minutos; URLs de download expiram em 15 minutos.
- Áudios aceitos: `audio/mp4`, `audio/webm` e `audio/mpeg`, até 50 MiB.
- PDFs e imagens JPEG/PNG aceitos até 25 MiB.
- Áudios brutos podem ser excluídos após 30 dias pelo job `infra/storage/expire-audio.sh --apply`. A agenda instalada inicialmente executa apenas uma simulação. O R2 só oferece regras de lifecycle por prefixo; uma regra em `organizations/` também excluiria PDFs e anexos. A antiga regra `organizations/audio/` não atinge as chaves novas e pode permanecer temporariamente para objetos legados.
- PDFs emitidos não devem ter regra de expiração automática; a retenção é perene até a política regulatória definir outra coisa.
- O tamanho declarado é incluído em `Content-Length` assinado na URL PUT. O R2 rejeita com `403` um corpo cujo tamanho difere do declarado; o backend também recusa declarações acima do limite antes de assinar.

## Expiração operacional de áudio

Na VPS, `infra/storage/expire-audio.sh` sem argumentos faz uma simulação: consulta áudios criados há mais de 30 dias, confere o prefixo da organização e mostra apenas contagens. Com `--apply`, exclui cada objeto do R2 e depois sua linha `StorageObject`. A exclusão do R2 é idempotente; se o banco falhar, a execução seguinte tenta novamente. Nenhum PDF ou anexo entra na consulta. O deploy instala uma entrada diária de simulação no cron do host:

```cron
25 3 * * * bash /root/flowcare/infra/storage/expire-audio.sh >> /root/flowcare/logs/audio-expiry.log 2>&1
```

Antes de habilitar, rode uma simulação e confira a contagem. O job usa a data do upload como início da retenção de 30 dias; a integração com o estado de conclusão da transcrição ainda não existe e deve ser incorporada quando esse fluxo for implementado.

Áudios clínicos enviados pela rota de consulta também são incluídos no job. Uploads assinados que não foram confirmados são removidos após o vencimento do link mais uma hora de tolerância, sem criar processamento. Ao confirmar, o backend copia o áudio validado para uma chave privada diferente; a chave temporária é removida imediatamente e verificada novamente pelo job após o vencimento da URL, pois o cliente ainda poderia reutilizá-la até lá. Para áudios confirmados com mais de 30 dias, o objeto final é apagado e `objectDeletedAt` é registrado; o consentimento e o histórico do processamento permanecem no banco. O modo padrão do job continua sendo simulação.

## Verificação operacional

Use um objeto de teste sem dados clínicos. Este bucket não tem endpoint público: `r2.dev` está desativado e não há domínio personalizado. O endpoint S3 sem assinatura retorna `400 Bad Request` para GET anônimo; esse status não deve ser interpretado como arquivo público. Uma URL assinada permite acesso durante sua validade e retorna `403` após expirar.

Registre apenas data, status HTTP, categoria do objeto e duração da URL. Não registre URLs completas, tokens, nomes de pacientes ou conteúdo de arquivos.

As regras de lifecycle e o bloqueio de acesso público são configuração do bucket e precisam ser conferidos no painel do Cloudflare R2 antes do fechamento da issue #205.

## Evidência em 2026-10-09

Foi enviado um objeto sintético sem dados clínicos para o bucket com uma URL assinada: PUT `200`. A leitura por URL assinada retornou GET `200` e conteúdo idêntico. GET anônimo pelo endpoint S3 retornou `400`. Uma URL de leitura de teste com validade de 1 segundo retornou GET `403` após a expiração. Em novo teste, uma URL PUT com `Content-Length: 1` assinado recusou corpo de 3 bytes com `403` e aceitou corpo de 1 byte com `200`. Os testes automatizados verificam que o backend emite upload por 600 segundos e download por 900 segundos, recusa MIME/tamanho inválidos e impede usuários sem membership ativa ou de outra organização de receber uma URL.

O critério literal da issue que exige `403` em acesso anônimo direto não corresponde ao comportamento do endpoint S3 privado do R2, que retorna `400`. A privacidade é sustentada pela ausência de endpoint público e pelo sucesso apenas da URL assinada. A validação acima usou credenciais de teste locais e não comprova que a API de produção já tenha as variáveis `STORAGE_*` configuradas.
