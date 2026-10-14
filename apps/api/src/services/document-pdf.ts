import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import type { Env } from "../config/env";
import type { DocumentType, Prisma } from "../generated/prisma/client";

export interface DocumentPdfRenderInput {
  organizationId: string;
  documentId: string;
  title: string;
  content: string;
  snapshotHash: string;
  type?: DocumentType;
  chainVersion?: number;
  variables?: Prisma.JsonValue;
  issuedAt?: Date | string;
}

export interface DocumentPdfStore {
  put(key: string, bytes: Uint8Array): Promise<void>;
  get(key: string): Promise<Uint8Array | null>;
  delete(key: string): Promise<void>;
}

export class MemoryDocumentPdfStore implements DocumentPdfStore {
  private readonly storage = new Map<string, Uint8Array>();

  async put(key: string, bytes: Uint8Array): Promise<void> {
    this.storage.set(key, bytes);
  }

  async get(key: string): Promise<Uint8Array | null> {
    return this.storage.get(key) ?? null;
  }

  async delete(key: string): Promise<void> {
    this.storage.delete(key);
  }
}

export class S3DocumentPdfStore implements DocumentPdfStore {
  private readonly client: S3Client;
  private readonly bucket: string;

  constructor(config: {
    endpoint: string;
    bucket: string;
    region?: string;
    accessKeyId: string;
    secretAccessKey: string;
  }) {
    this.bucket = config.bucket;
    this.client = new S3Client({
      endpoint: config.endpoint,
      region: config.region ?? "auto",
      forcePathStyle: true,
      credentials: {
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey,
      },
    });
  }

  async put(key: string, bytes: Uint8Array): Promise<void> {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: bytes,
        ContentType: "application/pdf",
      }),
    );
  }

  async get(key: string): Promise<Uint8Array | null> {
    try {
      const response = await this.client.send(
        new GetObjectCommand({
          Bucket: this.bucket,
          Key: key,
        }),
      );
      if (!response.Body) return null;
      return await response.Body.transformToByteArray();
    } catch (err: unknown) {
      if (
        typeof err === "object" &&
        err !== null &&
        "name" in err &&
        (err.name === "NoSuchKey" || err.name === "NotFound")
      ) {
        return null;
      }
      throw err;
    }
  }

  async delete(key: string): Promise<void> {
    await this.client.send(
      new DeleteObjectCommand({
        Bucket: this.bucket,
        Key: key,
      }),
    );
  }
}

export interface DocumentPdfService {
  renderAndStore(input: DocumentPdfRenderInput): Promise<string>;
  getPdf(input: {
    organizationId: string;
    documentId: string;
    pdfObjectKey: string;
  }): Promise<Uint8Array | null>;
}

export function createDocumentPdfService(
  env?: Pick<
    Env,
    | "storageEndpoint"
    | "storageBucket"
    | "storageRegion"
    | "storageAccessKeyId"
    | "storageSecretAccessKey"
  >,
  customStore?: DocumentPdfStore,
): DocumentPdfService {
  let store: DocumentPdfStore;

  if (customStore) {
    store = customStore;
  } else if (
    env?.storageEndpoint &&
    env?.storageBucket &&
    env?.storageAccessKeyId &&
    env?.storageSecretAccessKey
  ) {
    store = new S3DocumentPdfStore({
      endpoint: env.storageEndpoint,
      bucket: env.storageBucket,
      region: env.storageRegion,
      accessKeyId: env.storageAccessKeyId,
      secretAccessKey: env.storageSecretAccessKey,
    });
  } else {
    store = new MemoryDocumentPdfStore();
  }

  return {
    async renderAndStore(input: DocumentPdfRenderInput): Promise<string> {
      const pdfBytes = renderClinicalDocumentPdf(input);
      const objectKey = `organizations/${input.organizationId}/pdf/${input.documentId}.pdf`;
      await store.put(objectKey, pdfBytes);
      return objectKey;
    },

    async getPdf(input: {
      organizationId: string;
      documentId: string;
      pdfObjectKey: string;
    }): Promise<Uint8Array | null> {
      return store.get(input.pdfObjectKey);
    },
  };
}

/**
 * Encodes text into a PDF hexadecimal string using Windows-1252 (WinAnsiEncoding)
 * character mapping. Supports Portuguese accents and punctuation natively.
 */
function toHexWinAnsi(text: string): string {
  let hex = "";
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code >= 32 && code <= 126) {
      hex += code.toString(16).padStart(2, "0");
    } else if (code >= 160 && code <= 255) {
      hex += code.toString(16).padStart(2, "0");
    } else if (code === 8226) {
      // • bullet
      hex += "95";
    } else if (code === 8211) {
      // – en-dash
      hex += "96";
    } else if (code === 8212) {
      // — em-dash
      hex += "97";
    } else if (code === 8216) {
      // ‘ left single quote
      hex += "91";
    } else if (code === 8217) {
      // ’ right single quote
      hex += "92";
    } else if (code === 8220) {
      // “ left double quote
      hex += "93";
    } else if (code === 8221) {
      // ” right double quote
      hex += "94";
    } else {
      const char = text[i] ?? "";
      const norm = char.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
      const c = norm.charCodeAt(0) || 63;
      hex += (c >= 32 && c <= 126 ? c : 63).toString(16).padStart(2, "0");
    }
  }
  return `<${hex}>`;
}

function wrapLines(text: string, maxCharsPerLine = 84): string[] {
  const result: string[] = [];
  const paragraphs = text.split(/\r?\n/);
  for (const para of paragraphs) {
    if (!para.trim()) {
      result.push("");
      continue;
    }
    const words = para.split(/\s+/);
    let line = "";
    for (const w of words) {
      if (!line) {
        line = w;
      } else if (line.length + 1 + w.length <= maxCharsPerLine) {
        line += ` ${w}`;
      } else {
        result.push(line);
        line = w;
      }
    }
    if (line) {
      result.push(line);
    }
  }
  return result;
}

function getDocumentTypeTitle(type?: DocumentType): string {
  switch (type) {
    case "PRESCRIPTION":
      return "RECEITA MÉDICA SIMPLES";
    case "CERTIFICATE":
      return "ATESTADO MÉDICO";
    case "REPORT":
      return "LAUDO CLÍNICO";
    case "EXAM_REQUEST":
      return "SOLICITAÇÃO DE EXAMES";
    default:
      return "DOCUMENTO CLÍNICO";
  }
}

/**
 * Standard A4 PDF builder in pure TypeScript (ISO 32000-1 compatible).
 * Produces crisp, reproducible binary PDFs for clinical documents.
 */
export function renderClinicalDocumentPdf(
  input: DocumentPdfRenderInput,
): Uint8Array {
  const vars =
    input.variables &&
    typeof input.variables === "object" &&
    !Array.isArray(input.variables)
      ? (input.variables as Record<string, unknown>)
      : {};
  const clinicName = String(vars.clinica_nome ?? "Clínica").trim();
  const clinicCnpj = vars.clinica_cnpj ? String(vars.clinica_cnpj).trim() : "";
  const clinicAddress = vars.clinica_endereco
    ? String(vars.clinica_endereco).trim()
    : "";
  const clinicPhone = vars.clinica_telefone
    ? String(vars.clinica_telefone).trim()
    : "";

  const clinicDetailsParts = [
    clinicCnpj ? `CNPJ: ${clinicCnpj}` : null,
    clinicAddress || null,
    clinicPhone ? `Tel: ${clinicPhone}` : null,
  ].filter((p): p is string => Boolean(p));
  const clinicDetailsLine = clinicDetailsParts.join("   •   ");

  const patientName = String(vars.paciente_nome ?? "Paciente").trim();
  const patientCpf = vars.paciente_cpf ? String(vars.paciente_cpf).trim() : "";
  const patientBirth = vars.paciente_data_nascimento
    ? String(vars.paciente_data_nascimento).trim()
    : "";
  const patientSubParts = [
    patientCpf ? `CPF: ${patientCpf}` : null,
    patientBirth ? `Data de Nasc.: ${patientBirth}` : null,
  ].filter((p): p is string => Boolean(p));
  const patientSubLine = patientSubParts.join("   •   ");

  const professionalName = String(
    vars.profissional_nome ?? vars.medico_nome ?? "Profissional Responsável",
  ).trim();
  const professionalReg = String(
    vars.profissional_registro ??
      vars.profissional_crm ??
      vars.medico_crm ??
      "",
  ).trim();
  const professionalTitle = String(
    vars.profissional_titulo ?? "Profissional de Saúde",
  ).trim();

  let formattedDate = "";
  if (vars.data_emissao) {
    formattedDate = String(vars.data_emissao).trim();
  } else if (input.issuedAt) {
    const d = new Date(input.issuedAt);
    if (!Number.isNaN(d.getTime())) {
      const day = String(d.getUTCDate()).padStart(2, "0");
      const month = String(d.getUTCMonth() + 1).padStart(2, "0");
      const year = d.getUTCFullYear();
      formattedDate = `${day}/${month}/${year}`;
    }
  }

  const docTypeHeader = getDocumentTypeTitle(input.type);
  const docTitle = input.title.trim() || docTypeHeader;
  const contentLines = wrapLines(input.content);

  // Pagination calculation:
  // A4 Page Height = 841.89, Width = 595.28
  // Printable margins: Left=50, Right=545.28 (width = 495.28)
  // Page 1 header takes from top (Y=790) down to Y=630.
  // Content start Y = 620 on Page 1.
  // Last page bottom area (Signature + Disclaimer + Hash) takes 210pt (Y=50 to Y=260).
  // Intermediate page content start Y = 710, bottom Y = 60.
  const page1StartY = 620;
  const page1MinY = 270; // if last page, stops at 270. If not last page, can go down to 65.
  const otherPageStartY = 710;
  const otherPageMinY = 65;
  const lineHeight = 14;

  const pagesContentLines: string[][] = [];
  let currentLines: string[] = [];
  let currentY = page1StartY;
  let isFirstPage = true;

  for (let i = 0; i < contentLines.length; i++) {
    const line = contentLines[i] ?? "";

    // Check if we can fit remaining lines AND the signature block on current page
    const linesRemaining = contentLines.length - i;
    const neededForSignature = 210;

    let pageBottomLimit = otherPageMinY;
    if (isFirstPage) {
      pageBottomLimit =
        currentY - linesRemaining * lineHeight >= neededForSignature
          ? page1MinY
          : otherPageMinY;
    } else {
      pageBottomLimit =
        currentY - linesRemaining * lineHeight >= neededForSignature
          ? page1MinY
          : otherPageMinY;
    }

    if (currentY - lineHeight < pageBottomLimit) {
      pagesContentLines.push(currentLines);
      currentLines = [line];
      isFirstPage = false;
      currentY = otherPageStartY - lineHeight;
    } else {
      currentLines.push(line);
      currentY -= lineHeight;
    }
  }

  if (currentLines.length > 0 || pagesContentLines.length === 0) {
    pagesContentLines.push(currentLines);
  }

  // If the last page cannot accommodate the signature block (currentY < 240), add an extra page for signature
  const lastPageAvailableY = isFirstPage
    ? currentY
    : otherPageStartY - currentLines.length * lineHeight;
  if (lastPageAvailableY < 230 && pagesContentLines.length > 0) {
    pagesContentLines.push([]);
  }

  const totalPages = pagesContentLines.length;
  const pageStreams: string[] = [];

  for (let pageIdx = 0; pageIdx < totalPages; pageIdx++) {
    const pageNum = pageIdx + 1;
    const isPageOne = pageNum === 1;
    const isLastPage = pageNum === totalPages;
    const lines = pagesContentLines[pageIdx] ?? [];

    const streamParts: string[] = [];

    // 1. Clinic Header (every page)
    streamParts.push("BT");
    streamParts.push("/F2 13 Tf");
    streamParts.push("0.10 0.15 0.25 rg");
    streamParts.push(`50 782 Td ${toHexWinAnsi(clinicName)} Tj`);
    streamParts.push("ET");

    if (clinicDetailsLine) {
      streamParts.push("BT");
      streamParts.push("/F1 8 Tf");
      streamParts.push("0.40 0.45 0.52 rg");
      streamParts.push(`50 768 Td ${toHexWinAnsi(clinicDetailsLine)} Tj`);
      streamParts.push("ET");
    }

    // Header divider line
    streamParts.push("0.82 0.85 0.89 RG 0.75 w 50 756 m 545.28 756 l S");

    // 2. Document & Patient Header
    if (isPageOne) {
      // Document Type & Title
      streamParts.push("BT");
      streamParts.push("/F2 14 Tf");
      streamParts.push("0.09 0.12 0.18 rg");
      streamParts.push(`50 734 Td ${toHexWinAnsi(docTypeHeader)} Tj`);
      streamParts.push("ET");

      if (docTitle !== docTypeHeader) {
        streamParts.push("BT");
        streamParts.push("/F1 10.5 Tf");
        streamParts.push("0.28 0.33 0.40 rg");
        streamParts.push(`50 718 Td ${toHexWinAnsi(docTitle)} Tj`);
        streamParts.push("ET");
      }

      // Patient Card Box
      streamParts.push(
        "0.96 0.97 0.98 rg 0.87 0.90 0.93 RG 0.5 w 50 660 495.28 42 re B",
      );
      streamParts.push("BT");
      streamParts.push("/F2 9.5 Tf");
      streamParts.push("0.15 0.20 0.28 rg");
      streamParts.push(
        `60 686 Td ${toHexWinAnsi(`PACIENTE: ${patientName}`)} Tj`,
      );
      streamParts.push("ET");

      if (patientSubLine) {
        streamParts.push("BT");
        streamParts.push("/F1 8.5 Tf");
        streamParts.push("0.38 0.43 0.50 rg");
        streamParts.push(`60 671 Td ${toHexWinAnsi(patientSubLine)} Tj`);
        streamParts.push("ET");
      }
    } else {
      // Subsequent page subheader
      streamParts.push("BT");
      streamParts.push("/F1 8.5 Tf");
      streamParts.push("0.40 0.45 0.52 rg");
      streamParts.push(
        `50 738 Td ${toHexWinAnsi(
          `${docTypeHeader} — Paciente: ${patientName} (continuação)`,
        )} Tj`,
      );
      streamParts.push("ET");
      streamParts.push("0.88 0.90 0.93 RG 0.5 w 50 730 m 545.28 730 l S");
    }

    // 3. Content Lines
    let yPos = isPageOne ? 632 : 710;
    streamParts.push("BT");
    streamParts.push("/F1 10 Tf");
    streamParts.push("0.12 0.14 0.18 rg");

    for (const l of lines) {
      if (l.trim()) {
        streamParts.push(`50 ${yPos} Td ${toHexWinAnsi(l)} Tj -50 -${yPos} Td`);
      }
      yPos -= lineHeight;
    }
    streamParts.push("ET");

    // 4. Last Page Elements: Signature + Mandatory Disclaimer + Integrity Hash
    if (isLastPage) {
      // Date line
      if (formattedDate) {
        streamParts.push("BT");
        streamParts.push("/F1 9.5 Tf");
        streamParts.push("0.25 0.30 0.35 rg");
        streamParts.push(
          `50 248 Td ${toHexWinAnsi(`Data de emissão: ${formattedDate}`)} Tj`,
        );
        streamParts.push("ET");
      }

      // Professional Signature Block (centered)
      const sigLineY = 200;
      streamParts.push(
        `0.45 0.50 0.55 RG 0.75 w 180 ${sigLineY} m 415 ${sigLineY} l S`,
      );

      streamParts.push("BT");
      streamParts.push("/F2 9.5 Tf");
      streamParts.push("0.12 0.16 0.22 rg");
      streamParts.push(
        `180 ${sigLineY - 14} Td ${toHexWinAnsi(professionalName)} Tj`,
      );
      streamParts.push("ET");

      const regTitleLine = [professionalReg || null, professionalTitle || null]
        .filter((p): p is string => Boolean(p))
        .join(" — ");

      if (regTitleLine) {
        streamParts.push("BT");
        streamParts.push("/F1 8.5 Tf");
        streamParts.push("0.35 0.40 0.48 rg");
        streamParts.push(
          `180 ${sigLineY - 26} Td ${toHexWinAnsi(regTitleLine)} Tj`,
        );
        streamParts.push("ET");
      }

      streamParts.push("BT");
      streamParts.push("/F3 8 Tf");
      streamParts.push("0.45 0.50 0.58 rg");
      streamParts.push(
        `180 ${sigLineY - 38} Td ${toHexWinAnsi(
          "Assinatura e carimbo manuscritos",
        )} Tj`,
      );
      streamParts.push("ET");

      // Mandatory Disclaimer Box (for manual printing and signature, NOT digital signature)
      streamParts.push(
        "0.98 0.98 0.99 rg 0.82 0.84 0.88 RG 0.5 w 50 82 495.28 44 re B",
      );

      streamParts.push("BT");
      streamParts.push("/F2 7.5 Tf");
      streamParts.push("0.70 0.15 0.15 rg");
      streamParts.push(
        `58 114 Td ${toHexWinAnsi(
          "ATENÇÃO: DOCUMENTO DESTINADO EXCLUSIVAMENTE À IMPRESSÃO E ASSINATURA MANUSCRITA.",
        )} Tj`,
      );
      streamParts.push("ET");

      streamParts.push("BT");
      streamParts.push("/F1 7 Tf");
      streamParts.push("0.30 0.35 0.40 rg");
      streamParts.push(
        `58 102 Td ${toHexWinAnsi(
          "Este documento foi emitido pelo sistema Flowcare e NÃO possui assinatura eletrônica qualificada (ICP-Brasil).",
        )} Tj`,
      );
      streamParts.push("ET");

      streamParts.push("BT");
      streamParts.push("/F1 7 Tf");
      streamParts.push("0.30 0.35 0.40 rg");
      streamParts.push(
        `58 91 Td ${toHexWinAnsi(
          "A validade jurídica deste documento depende da aposição de assinatura manual e carimbo do profissional emissor.",
        )} Tj`,
      );
      streamParts.push("ET");

      // Integrity Hash Block
      const versionLabel = input.chainVersion ? `v${input.chainVersion}` : "v1";
      const hashLabel = `Doc ID: ${input.documentId}   •   Versão: ${versionLabel}   •   Hash: ${input.snapshotHash}`;
      streamParts.push("BT");
      streamParts.push("/F1 6.5 Tf");
      streamParts.push("0.50 0.55 0.60 rg");
      streamParts.push(`50 68 Td ${toHexWinAnsi(hashLabel)} Tj`);
      streamParts.push("ET");
    }

    // 5. Universal Page Footer (divider + pagination)
    streamParts.push("0.85 0.88 0.92 RG 0.5 w 50 42 m 545.28 42 l S");

    streamParts.push("BT");
    streamParts.push("/F1 7 Tf");
    streamParts.push("0.50 0.55 0.60 rg");
    streamParts.push(
      `50 30 Td ${toHexWinAnsi(
        "Flowcare • Sistema de Gestão Clínica • Impressão física obrigatória",
      )} Tj`,
    );
    streamParts.push("ET");

    streamParts.push("BT");
    streamParts.push("/F1 7 Tf");
    streamParts.push("0.50 0.55 0.60 rg");
    streamParts.push(
      `485 30 Td ${toHexWinAnsi(`Página ${pageNum} de ${totalPages}`)} Tj`,
    );
    streamParts.push("ET");

    pageStreams.push(streamParts.join("\n"));
  }

  // Assemble valid PDF 1.4 objects:
  // Obj 1: Catalog
  // Obj 2: Pages tree
  // Obj 3: Font F1 (Helvetica)
  // Obj 4: Font F2 (Helvetica-Bold)
  // Obj 5: Font F3 (Helvetica-Oblique)
  // For each page i:
  //   Obj Page_i
  //   Obj Stream_i
  const objects: string[] = [];

  const catalogObjNum = 1;
  const pagesObjNum = 2;
  const fontF1ObjNum = 3;
  const fontF2ObjNum = 4;
  const fontF3ObjNum = 5;

  const pageObjNums: number[] = [];
  const streamObjNums: number[] = [];

  let nextObjNum = 6;
  for (let i = 0; i < totalPages; i++) {
    pageObjNums.push(nextObjNum++);
    streamObjNums.push(nextObjNum++);
  }

  // Obj 1: Catalog
  objects.push(`<< /Type /Catalog /Pages ${pagesObjNum} 0 R >>`);

  // Obj 2: Pages
  const kidsStr = pageObjNums.map((n) => `${n} 0 R`).join(" ");
  objects.push(`<< /Type /Pages /Kids [${kidsStr}] /Count ${totalPages} >>`);

  // Obj 3: Font F1
  objects.push(
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>",
  );

  // Obj 4: Font F2
  objects.push(
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>",
  );

  // Obj 5: Font F3
  objects.push(
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Oblique /Encoding /WinAnsiEncoding >>",
  );

  // Pages & Streams
  for (let i = 0; i < totalPages; i++) {
    const sObj = streamObjNums[i];
    const streamContent = pageStreams[i] ?? "";
    const streamBytesLen = Buffer.byteLength(streamContent, "latin1");

    // Page Object
    objects.push(
      `<< /Type /Page /Parent ${pagesObjNum} 0 R /MediaBox [0 0 595.28 841.89] /Resources << /Font << /F1 ${fontF1ObjNum} 0 R /F2 ${fontF2ObjNum} 0 R /F3 ${fontF3ObjNum} 0 R >> >> /Contents ${sObj} 0 R >>`,
    );

    // Stream Object
    objects.push(
      `<< /Length ${streamBytesLen} >>\nstream\n${streamContent}\nendstream`,
    );
  }

  // Build binary PDF
  let out = "%PDF-1.4\n%\xE2\xE3\xCF\xD3\n";
  const offsets: number[] = [];

  for (let i = 0; i < objects.length; i++) {
    offsets.push(Buffer.byteLength(out, "latin1"));
    out += `${i + 1} 0 obj\n${objects[i]}\nendobj\n`;
  }

  const xrefOffset = Buffer.byteLength(out, "latin1");
  out += `xref\n0 ${objects.length + 1}\n`;
  out += "0000000000 65535 f \n";
  for (let i = 0; i < offsets.length; i++) {
    const offsetVal = offsets[i] ?? 0;
    out += `${offsetVal.toString().padStart(10, "0")} 00000 n \n`;
  }

  out += `trailer\n<< /Size ${objects.length + 1} /Root ${catalogObjNum} 0 R >>\n`;
  out += `startxref\n${xrefOffset}\n%%EOF\n`;

  return new Uint8Array(Buffer.from(out, "latin1"));
}
