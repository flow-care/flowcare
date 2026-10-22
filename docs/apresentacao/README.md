# Apresentação — Flowcare (PDF)

`Flowcare-Documentacao-do-Projeto-2026-10-22.pdf` — 17 slides, 16:9 (13,33 × 7,5 in), vetorial e com texto selecionável.

## Conteúdo

| # | Slide |
|---:|---|
| 01 | Capa |
| 02 | O problema — três perdas |
| 03 | A solução — três pilares e o limite da IA |
| 04 | Escopo: dentro e fora do MVP |
| 05 | Papéis e permissões |
| 06 | Arquitetura e integrações |
| 07 | Modelo de dados (8 domínios) |
| 08 | Fluxo: agenda → WhatsApp → confirmação |
| 09 | Fluxo: consulta → transcrição → anamnese |
| 10 | Fluxo: modelo → PDF → retificação/anulação |
| 11 | O que está construído |
| 12 | Números do projeto |
| 13 | Especificação × código |
| 14 | Riscos |
| 15 | Próximos marcos (SR III e AV2) |
| 16 | Lacunas da documentação |
| 17 | Onde está a documentação |

Fontes: `docs/PROJETO_VISAO_GERAL.md`, `docs/BACKLOG.md`, `docs/ESPECIFICACAO_VS_IMPLEMENTACAO.md` e `docs/fontes/`.
Paleta e tipografia seguem o produto (`apps/web/app/globals.css`: primária `#0263b5`, fundo `#f3f3f3`, Inter).

## Regerar

Edite `apresentacao.html` e rode, nesta pasta:

```bash
python3 - <<'EOF'
from playwright.sync_api import sync_playwright
import pathlib
src = pathlib.Path('apresentacao.html').resolve()
with sync_playwright() as p:
    b = p.chromium.launch()
    pg = b.new_page(viewport={'width': 1280, 'height': 720})
    pg.goto(src.as_uri(), wait_until='load')
    pg.emulate_media(media='print')
    pg.pdf(path='Flowcare-Documentacao-do-Projeto-2026-10-22.pdf',
           width='13.333in', height='7.5in', print_background=True,
           margin={'top': '0', 'bottom': '0', 'left': '0', 'right': '0'})
    b.close()
EOF
```

Cada `.slide` tem 1280×720 px fixos. Se o texto crescer, o conteúdo transborda sem aviso — confira o PDF depois de editar.
