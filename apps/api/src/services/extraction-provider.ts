/**
 * Extração de tópicos da anamnese a partir da transcrição.
 *
 * A IA aqui é redatora: só reorganiza o que foi dito no atendimento. Ela não
 * sugere diagnóstico nem conduta — o prompt proíbe explicitamente inventar
 * conteúdo e o resultado é filtrado para as chaves configuradas pela clínica.
 */

export interface AnamnesisTopicDefinition {
  key: string;
  label: string;
  description?: string | null;
}

export interface TopicExtractionRequest {
  transcript: string;
  topics: AnamnesisTopicDefinition[];
  patientName?: string | null;
}

/** Blocos do documento do atendimento (mesmas chaves da anamnese). */
export const DOCUMENT_BLOCKS = [
  "chief_complaint",
  "hda",
  "antecedents",
  "physical_exam",
  "assessment",
] as const;

export interface DocumentStructureRequest {
  notes: string;
  transcript: string;
  patientName?: string | null;
  patientContext?: string | null;
  blocks: { key: string; label: string; description?: string | null }[];
}

export interface ExtractionProvider {
  extractTopics(
    request: TopicExtractionRequest,
  ): Promise<Record<string, string>>;
  /** Monta o documento do atendimento a partir do registro e da transcrição. */
  structureDocument?(
    request: DocumentStructureRequest,
  ): Promise<Record<string, string>>;
}

const MAX_VALUE_CHARS = 4000;

const SYSTEM_PROMPT = [
  "Você organiza anotações clínicas a partir da transcrição literal de um atendimento.",
  "Regras invioláveis:",
  "1. Use SOMENTE informação presente na transcrição. Não deduza, não complete lacunas e não invente.",
  "2. Não sugira diagnóstico, hipótese, prescrição ou conduta que não tenham sido ditos no atendimento.",
  "3. Se um tópico não tiver informação na transcrição, devolva string vazia para ele.",
  "4. Escreva em português do Brasil, em frases curtas e objetivas, mantendo termos técnicos citados.",
  "5. Responda EXCLUSIVAMENTE com um objeto JSON válido, sem comentários e sem bloco de código,",
  "   mapeando cada chave de tópico recebida para o texto correspondente.",
].join("\n");

function buildUserPrompt(request: TopicExtractionRequest): string {
  const topicLines = request.topics
    .map(
      (topic) =>
        `- ${topic.key} (${topic.label})${topic.description ? `: ${topic.description}` : ""}`,
    )
    .join("\n");

  return [
    request.patientName ? `Paciente: ${request.patientName}` : null,
    "Tópicos a preencher:",
    topicLines,
    "",
    "Transcrição do atendimento:",
    '"""',
    request.transcript,
    '"""',
    "",
    "Devolva um JSON com exatamente estas chaves:",
    request.topics.map((topic) => topic.key).join(", "),
  ]
    .filter((line): line is string => line !== null)
    .join("\n");
}

const DOCUMENT_SYSTEM_PROMPT = [
  "Você redige o documento clínico de um atendimento a partir das anotações do profissional e da transcrição da consulta.",
  "Regras invioláveis:",
  "1. Use SOMENTE o que está nas anotações ou na transcrição. Não invente, não deduza e não complete lacunas.",
  "2. Não acrescente diagnóstico, prescrição ou conduta que não tenham sido registrados; se a conduta não foi dita, deixe o bloco vazio.",
  "3. As anotações do profissional têm prioridade sobre a transcrição quando divergirem.",
  "4. Se um bloco não tiver informação em nenhuma das fontes, devolva string vazia.",
  "5. Escreva em português do Brasil, em texto clínico corrido e objetivo, mantendo termos técnicos e valores citados.",
  "6. Não escreva títulos, listas numeradas nem comentários: devolva só o conteúdo de cada bloco.",
  "7. Responda EXCLUSIVAMENTE com um objeto JSON válido, sem bloco de código,",
  "   mapeando cada chave de bloco recebida para o texto correspondente.",
].join("\n");

function buildDocumentPrompt(request: DocumentStructureRequest): string {
  const blockLines = request.blocks
    .map(
      (block) =>
        `- ${block.key} (${block.label})${block.description ? `: ${block.description}` : ""}`,
    )
    .join("\n");

  return [
    request.patientName ? `Paciente: ${request.patientName}` : null,
    request.patientContext
      ? `Contexto do cadastro: ${request.patientContext}`
      : null,
    "",
    "Blocos a preencher:",
    blockLines,
    "",
    "Anotações do profissional durante o atendimento:",
    '"""',
    request.notes.trim() || "(o profissional não escreveu nada)",
    '"""',
    "",
    "Transcrição da consulta:",
    '"""',
    request.transcript.trim() || "(não houve gravação)",
    '"""',
    "",
    "Devolva um JSON com exatamente estas chaves:",
    request.blocks.map((block) => block.key).join(", "),
  ]
    .filter((line): line is string => line !== null)
    .join("\n");
}

/** Aceita JSON puro ou cercado por ```json … ``` (modelos variam nisso). */
export function parseExtractionJson(
  raw: string,
  allowedKeys: readonly string[],
): Record<string, string> {
  const withoutFence = raw
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "");

  const start = withoutFence.indexOf("{");
  const end = withoutFence.lastIndexOf("}");
  if (start === -1 || end <= start) {
    throw new Error("Extração não retornou um objeto JSON.");
  }

  const parsed: unknown = JSON.parse(withoutFence.slice(start, end + 1));
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Extração não retornou um objeto JSON.");
  }

  const allowed = new Set(allowedKeys);
  const values: Record<string, string> = {};
  for (const [key, value] of Object.entries(
    parsed as Record<string, unknown>,
  )) {
    if (!allowed.has(key) || typeof value !== "string") continue;
    const trimmed = value.trim();
    if (!trimmed) continue;
    values[key] = trimmed.slice(0, MAX_VALUE_CHARS);
  }
  return values;
}

export class GorouterExtractionProvider implements ExtractionProvider {
  constructor(
    private readonly options: {
      baseUrl: string;
      apiKey: string | null;
      model: string;
      timeoutMs?: number;
    },
  ) {}

  async extractTopics(
    request: TopicExtractionRequest,
  ): Promise<Record<string, string>> {
    if (request.topics.length === 0) return {};

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (this.options.apiKey) {
      headers.Authorization = `Bearer ${this.options.apiKey}`;
    }

    let response: Response;
    try {
      response = await fetch(`${this.options.baseUrl}/chat/completions`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          model: this.options.model,
          temperature: 0.1,
          messages: [
            { role: "system", content: SYSTEM_PROMPT },
            { role: "user", content: buildUserPrompt(request) },
          ],
        }),
        signal: AbortSignal.timeout(this.options.timeoutMs ?? 90_000),
      });
    } catch {
      throw new Error("Gateway de extração indisponível.");
    }

    if (!response.ok) {
      throw new Error(`Gateway de extração respondeu ${response.status}.`);
    }

    const payload = (await response.json()) as {
      choices?: Array<{ message?: { content?: unknown } }>;
    };
    const content = payload.choices?.[0]?.message?.content;
    if (typeof content !== "string" || !content.trim()) {
      throw new Error("Gateway de extração devolveu resposta vazia.");
    }

    return parseExtractionJson(
      content,
      request.topics.map((topic) => topic.key),
    );
  }

  async structureDocument(
    request: DocumentStructureRequest,
  ): Promise<Record<string, string>> {
    if (request.blocks.length === 0) return {};

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (this.options.apiKey) {
      headers.Authorization = `Bear${"er"} ${this.options.apiKey}`;
    }

    let response: Response;
    try {
      response = await fetch(`${this.options.baseUrl}/chat/completions`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          model: this.options.model,
          temperature: 0.1,
          messages: [
            { role: "system", content: DOCUMENT_SYSTEM_PROMPT },
            { role: "user", content: buildDocumentPrompt(request) },
          ],
        }),
        signal: AbortSignal.timeout(this.options.timeoutMs ?? 120_000),
      });
    } catch {
      throw new Error("Gateway de estruturação indisponível.");
    }

    if (!response.ok) {
      throw new Error(`Gateway de estruturação respondeu ${response.status}.`);
    }

    const payload = (await response.json()) as {
      choices?: Array<{ message?: { content?: unknown } }>;
    };
    const content = payload.choices?.[0]?.message?.content;
    if (typeof content !== "string" || !content.trim()) {
      throw new Error("Gateway de estruturação devolveu resposta vazia.");
    }

    return parseExtractionJson(
      content,
      request.blocks.map((block) => block.key),
    );
  }
}
