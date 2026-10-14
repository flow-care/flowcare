# ADR-003: Renderizador de PDF

- **Status:** Accepted
- **Origem histórica:** issue #13 (taxonomia anterior)
- **Decisão técnica e spike:** issue #276

## Contexto

O ciclo de vida de documentos clínicos no MVP (decisão de produto #195, DOCUMENTS_MVP.md) define a emissão de documentos finais imutáveis destinados exclusivamente à **impressão e assinatura manuscrita** (receita simples, atestado, laudo e solicitação de exames). O documento emitido deve manter formato A4 estrito, paginação confiável, cabeçalho da clínica, identificação do paciente e profissional emissor, além de aviso mandatório de que o arquivo não possui assinatura digital e exige assinatura manual em papel.

## Alternativas avaliadas no Spike (#276)

1. **Chromium headless no runtime Bun (Puppeteer / Playwright):**
   - *Desvantagens:* Alto consumo de memória RAM (~200MB a 350MB por instância de browser), dependências pesadas de bibliotecas gráficas no container Docker (libnss3, libatk, libcups, etc.), tempo elevado de inicialização de processo (~1,5s por renderização), risco de processos zumbis (*orphaned processes*) e timeouts sob concorrência na VPS.
   - *Incompatibilidade:* Suporte a pipes de processo de browsers em Bun ainda possui instabilidades conhecidas.

2. **Worker Node.js separado com Chromium:**
   - *Desvantagens:* Complexidade adicional de infraestrutura (manutenção de container dedicado, fila de mensagens/RPC, monitoramento de saúde do worker), over-engineering para o escopo do MVP onde os documentos possuem campos estruturados e modelos padronizados.

3. **Renderizador estruturado A4 em TypeScript puro:**
   - *Vantagens:* Execução nativa no runtime Bun com latência inferior a 1ms, zero dependências externas de SO ou binários no container Docker, determinismo binário absoluto a partir do snapshot imutável, suporte a quebra de página automática (A4 com margens e numeração "Página X de Y"), consumo desprezível de memória RAM (<100KB) e total isolamento por organização.

## Decisão

Adotou-se o **renderizador estruturado A4 em TypeScript puro** (`DocumentPdfRenderer`) integrado a armazenamento em bucket privado S3/R2 (`DocumentPdfStore`) sob o serviço desacoplado `DocumentPdfService`.

O PDF gerado:
- Utiliza formato padrão A4 (595.28 x 841.89 pt) com tipografia Helvetica (WinAnsiEncoding compatível com acentuação em português);
- Renderiza dados congelados exclusivamente a partir do snapshot (`DocumentVersion`);
- Inclui bloco de assinatura manuscrita do profissional emissor;
- Exibe de forma proeminente o aviso legal: *"DOCUMENTO DESTINADO EXCLUSIVAMENTE À IMPRESSÃO E ASSINATURA MANUSCRITA. NÃO POSSUI ASSINATURA ELETRÔNICA QUALIFICADA."*;
- Registra no rodapé de todas as páginas o hash de integridade (`sha256_...`), ID do documento, versão da cadeia e numeração de páginas;
- É persistido no bucket privado sob a chave `organizations/<organizationId>/pdf/<documentId>.pdf` e transmitido diretamente pela API mediante autorização `documents:read`.

A arquitetura permanece desacoplada através da interface `DocumentPdfService`. Caso fases futuras exijam renderização de conteúdo WYSIWYG arbitrário via Chromium ou assinatura eletrônica qualificada ICP-Brasil, a implementação poderá ser estendida ou migrada para um worker sem alterar os contratos de API nem a camada de persistência.

## Consequências

- **Positivas:**
  - Emissão de PDFs ultrarrápida, estável e livre de falhas de timeout de browser;
  - Baixo uso de recursos na VPS de produção (209.126.11.124);
  - Garantia de imutabilidade: alterações posteriores em dados de pacientes, clínicas ou templates não afetam o PDF emitido;
  - Testes unitários e de integração rápidos, executados em milissegundos sem necessidade de mockar Chromium.
- **Negativas / Limitações:**
  - Customizações visuais complexas de CSS livre não são suportadas no MVP; o layout segue a identidade clínica padronizada do Flowcare.
