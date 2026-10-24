import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

mock.module("server-only", () => ({}));

let mockToken: string | null = "valid-token";
mock.module("next/headers", () => ({
  cookies: async () => ({
    get: (_name: string) => (mockToken ? { value: mockToken } : undefined),
    set: () => {},
  }),
}));

mock.module("next/cache", () => ({
  revalidatePath: () => {},
}));

mock.module("next/navigation", () => ({
  useRouter: () => ({
    push: () => {},
    replace: () => {},
    refresh: () => {},
    back: () => {},
    forward: () => {},
    prefetch: () => {},
  }),
  usePathname: () => "/app/clinica-teste/consultations/c-123",
  useSearchParams: () => new URLSearchParams("tab=review"),
  useParams: () => ({ orgSlug: "clinica-teste", consultationId: "c-123" }),
  redirect: (url: string) => {
    throw new Error(`NEXT_REDIRECT;${url}`);
  },
  permanentRedirect: (url: string) => {
    throw new Error(`NEXT_REDIRECT;${url}`);
  },
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
}));

const {
  ConsultationsApiError,
  getAnamnesisDraft,
  updateAnamnesisDraft,
  approveAnamnesis,
  extractTopicsFromDraft,
} = await import("../server/consultations");

const { updateAnamnesisDraftAction, approveAnamnesisAction } = await import(
  "../app/app/[orgSlug]/consultations/actions"
);

const {
  CLINICAL_ANAMNESIS_TOPICS,
  validateAnamnesisTopics,
  resolveTopicInitialValue,
  formatDoctorVerificationStamp,
} = await import("../components/flowcare/consultations/anamnesis-review-utils");

const { AnamnesisReviewView } = await import(
  "../components/flowcare/consultations/anamnesis-review-view"
);

const originalFetch = globalThis.fetch;
const originalApiUrl = process.env.API_INTERNAL_URL;

beforeEach(() => {
  process.env.API_INTERNAL_URL = "http://api.test";
  mockToken = "valid-token";
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  if (originalApiUrl === undefined) delete process.env.API_INTERNAL_URL;
  else process.env.API_INTERNAL_URL = originalApiUrl;
});

const mockConsultationBase = {
  id: "c-123",
  consultationId: "c-123",
  organizationId: "org-1",
  patientId: "patient-1",
  professionalId: "prof-1",
  scheduledAt: "2026-10-17T14:00:00.000Z",
  localScheduledAt: "2026-10-17T11:00:00",
  status: "IN_PROGRESS" as const,
  anamnesisStatus: "DRAFT" as const,
  version: 3,
  chiefComplaint: "Dor torácica atípica após esforço",
  clinicalNotes: "Orientado repouso e retorno em 7 dias",
  anamnesisDraft: {
    topics: {
      chief_complaint: "Dor torácica atípica após esforço",
      hda: "Sintomas iniciados há 2 dias com piora aos esforços físicos moderados.",
      antecedents: "Hipertenso em uso de Losartana 50mg/dia. Nega diabetes.",
      physical_exam:
        "PA 130/85 mmHg, FC 74 bpm, ausculta cardíaca normal sem sopros.",
      conduct:
        "Solicitado ECG de esforço e ecocardiograma. Mantida medicação de uso contínuo.",
    },
  },
  patient: {
    id: "patient-1",
    fullName: "Carlos Eduardo Silva",
    birthDate: "1980-05-12",
  },
  professional: {
    id: "prof-1",
    fullName: "Dra. Juliana Mendes",
    professionalTitle: "Cardiologista",
    registrationNumber: "CRM/SP 123456",
  },
};

describe("Anamnesis Review & Medical Approval (#271)", () => {
  describe("1. Documento chegando pronto (sem aviso de IA)", () => {
    test("não exibe avisos de IA nem instruções de preenchimento no documento", () => {
      const html = renderToStaticMarkup(
        createElement(AnamnesisReviewView, {
          orgSlug: "clinica-teste",
          consultation: mockConsultationBase,
          userRole: "PROFESSIONAL",
        }),
      );

      // O documento é gerado ao finalizar o atendimento; o profissional
      // revisa, não preenche, então nenhum aviso de "sugestão" aparece.
      expect(html).not.toContain("Sugestão gerada por IA");
      expect(html).not.toContain("requer validação médica");
      expect(html).not.toContain('data-testid="ai-suggestion-banner"');
      expect(html).not.toContain('data-testid="verified-stamp-banner"');
    });

    test("does NOT display AI suggestion banner when anamnesis is APPROVED", () => {
      const approvedConsultation = {
        ...mockConsultationBase,
        anamnesisStatus: "APPROVED" as const,
        status: "COMPLETED" as const,
        signedBy: "CRM/SP 123456",
        approvedAt: "2026-10-17T14:35:00.000Z",
        snapshotHash: "sha256_abcdef1234567890",
      };

      const html = renderToStaticMarkup(
        createElement(AnamnesisReviewView, {
          orgSlug: "clinica-teste",
          consultation: approvedConsultation,
          userRole: "PROFESSIONAL",
        }),
      );

      expect(html).not.toContain(
        "Sugestão gerada por IA — requer validação médica",
      );
      expect(html).not.toContain('data-testid="ai-suggestion-banner"');
      expect(html).toContain('data-testid="verified-stamp-banner"');
    });
  });

  describe("2. Clinical Topics Configuration & Value Resolution", () => {
    test("CLINICAL_ANAMNESIS_TOPICS defines all 5 required clinical sections", () => {
      const keys = CLINICAL_ANAMNESIS_TOPICS.map((t) => t.key);
      const labels = CLINICAL_ANAMNESIS_TOPICS.map((t) => t.label);

      expect(keys).toEqual([
        "chief_complaint",
        "hda",
        "antecedents",
        "physical_exam",
        "conduct",
      ]);

      expect(labels).toContain("Queixa principal");
      expect(labels).toContain("História da doença atual (HDA)");
      expect(labels).toContain("Antecedentes pessoais e familiares");
      expect(labels).toContain("Exame físico");
      expect(labels).toContain("Conduta e hipótese diagnóstica");
    });

    test("resolves topic initial values from draft topics, aliases, and consultation fields", () => {
      const draftTopics = {
        chiefComplaint: "Cefaleia frontal",
        hda_content: "Início súbito pela manhã",
        antecedentes: "Nega comorbidades",
        physicalExam: "BEG, LOTE",
        conduta: "Dipirona 1g VO",
      };

      expect(resolveTopicInitialValue("chief_complaint", draftTopics)).toBe(
        "Cefaleia frontal",
      );
      expect(resolveTopicInitialValue("hda", draftTopics)).toBe(
        "Início súbito pela manhã",
      );
      expect(resolveTopicInitialValue("antecedents", draftTopics)).toBe(
        "Nega comorbidades",
      );
      expect(resolveTopicInitialValue("physical_exam", draftTopics)).toBe(
        "BEG, LOTE",
      );
      expect(resolveTopicInitialValue("conduct", draftTopics)).toBe(
        "Dipirona 1g VO",
      );
    });

    test("falls back to consultation chiefComplaint and clinicalNotes when draft is empty", () => {
      expect(
        resolveTopicInitialValue(
          "chief_complaint",
          {},
          "Queixa vinda da consulta",
        ),
      ).toBe("Queixa vinda da consulta");

      expect(
        resolveTopicInitialValue(
          "conduct",
          {},
          null,
          "Conduta vinda da consulta",
        ),
      ).toBe("Conduta vinda da consulta");
    });

    test("extractTopicsFromDraft extracts topics from nested object or top-level keys", () => {
      const nestedDraft = {
        topics: {
          chief_complaint: "Tosse seca",
          hda: "Há 1 semana",
        },
      };

      const extracted = extractTopicsFromDraft(nestedDraft);
      expect(extracted.chief_complaint).toBe("Tosse seca");
      expect(extracted.hda).toBe("Há 1 semana");
    });
  });

  describe("3. Topic Validation Before Approval", () => {
    test("rejects approval when required topics are missing or empty", () => {
      const emptyTopics = {
        chief_complaint: "",
        hda: "   ",
        antecedents: "Hipertenso",
        physical_exam: "Normal",
        conduct: "",
      };

      const validation = validateAnamnesisTopics(emptyTopics);
      expect(validation.valid).toBe(false);
      expect(validation.missingTopics).toContain("Queixa principal");
      expect(validation.missingTopics).toContain(
        "História da doença atual (HDA)",
      );
      expect(validation.missingTopics).toContain(
        "Conduta e hipótese diagnóstica",
      );
    });

    test("accepts approval when all required topics are provided (optional topics can be blank)", () => {
      const validTopics = {
        chief_complaint: "Dor abdominal em fossa ilíaca direita",
        hda: "Quadro com 24h de evolução associado a febre baixa.",
        antecedents: "", // optional
        physical_exam: "", // optional
        conduct: "Encaminhado para ultrassom de abdome total com urgência.",
      };

      const validation = validateAnamnesisTopics(validTopics);
      expect(validation.valid).toBe(true);
      expect(validation.missingTopics).toHaveLength(0);
    });
  });

  describe("4. Concurrency Control & Version Conflict (409)", () => {
    test("updateAnamnesisDraft sends version and topics to PUT /organizations/:orgSlug/consultations/:consultationId/anamnesis/draft", async () => {
      let capturedBody: {
        version?: number;
        topics?: Record<string, string>;
      } | null = null;
      let capturedUrl = "";

      globalThis.fetch = (async (url: string | URL, init?: RequestInit) => {
        capturedUrl = url.toString();
        capturedBody = JSON.parse(String(init?.body));
        return Response.json({
          ...mockConsultationBase,
          version: 4,
          anamnesisStatus: "DRAFT",
        });
      }) as unknown as typeof fetch;

      const result = await updateAnamnesisDraft("clinica-teste", "c-123", {
        version: 3,
        content: {
          chief_complaint: "Dor torácica revisada",
          hda: "Evolução estável",
        },
      });

      expect(capturedUrl).toContain(
        "/organizations/clinica-teste/consultations/c-123/anamnesis/draft",
      );
      expect(capturedBody.version).toBe(3);
      expect(capturedBody.topics.chief_complaint).toBe("Dor torácica revisada");
      expect(result.version).toBe(4);
    });

    test("updateAnamnesisDraft throws ConsultationsApiError with code CONFLICT on HTTP 409", async () => {
      globalThis.fetch = (async () => {
        return new Response(
          JSON.stringify({
            code: "VERSION_CONFLICT",
            message:
              "O rascunho da anamnese foi alterado por outra sessão. Recarregue antes de salvar.",
          }),
          { status: 409, headers: { "Content-Type": "application/json" } },
        );
      }) as unknown as typeof fetch;

      try {
        await updateAnamnesisDraft("clinica-teste", "c-123", {
          version: 2,
          content: { chief_complaint: "Tentativa concorrente" },
        });
        expect.unreachable();
      } catch (err) {
        expect(err).toBeInstanceOf(ConsultationsApiError);
        const apiErr = err as InstanceType<typeof ConsultationsApiError>;
        expect(apiErr.code).toBe("CONFLICT");
        expect(apiErr.message).toContain("alterado por outra sessão");
      }
    });

    test("updateAnamnesisDraftAction returns { success: false, code: 'CONFLICT' } on 409", async () => {
      globalThis.fetch = (async () => {
        return new Response(
          JSON.stringify({
            code: "VERSION_CONFLICT",
            message: "Conflito de versão detectado.",
          }),
          { status: 409, headers: { "Content-Type": "application/json" } },
        );
      }) as unknown as typeof fetch;

      const actionResult = await updateAnamnesisDraftAction(
        "clinica-teste",
        "c-123",
        {
          version: 1,
          content: { chief_complaint: "Conflito" },
        },
      );

      expect(actionResult.success).toBe(false);
      expect(actionResult.code).toBe("CONFLICT");
      expect(actionResult.error).toContain("Conflito de versão");
    });
  });

  describe("5. Medical Approval & Immutability Freeze", () => {
    test("approveAnamnesis sends version to POST /organizations/:orgSlug/consultations/:consultationId/anamnesis/approve", async () => {
      let capturedUrl = "";
      let capturedMethod = "";
      let capturedBody: { version?: number } | null = null;

      globalThis.fetch = (async (url: string | URL, init?: RequestInit) => {
        capturedUrl = url.toString();
        capturedMethod = String(init?.method);
        capturedBody = JSON.parse(String(init?.body));
        return Response.json({
          status: "APPROVED",
          signedBy: "CRM/SP 123456",
          approvedAt: "2026-10-17T14:40:00.000Z",
          consultationId: "c-123",
          version: 4,
          snapshotHash: "sha256_mockhash123456789",
        });
      }) as unknown as typeof fetch;

      const response = await approveAnamnesis("clinica-teste", "c-123", {
        version: 3,
        content: {
          chief_complaint: "Queixa aprovada",
          hda: "HDA aprovada",
          conduct: "Conduta aprovada",
        },
      });

      expect(capturedUrl).toContain(
        "/organizations/clinica-teste/consultations/c-123/anamnesis/approve",
      );
      expect(capturedMethod).toBe("POST");
      expect(capturedBody.version).toBe(3);
      expect(response.status).toBe("APPROVED");
      expect(response.signedBy).toBe("CRM/SP 123456");
      expect(response.snapshotHash).toBe("sha256_mockhash123456789");
    });

    test("approveAnamnesis handles missing required topics 400 from backend as VALIDATION_ERROR", async () => {
      globalThis.fetch = (async () => {
        return new Response(
          JSON.stringify({
            code: "VALIDATION_ERROR",
            message:
              "Tópicos obrigatórios da anamnese devem estar preenchidos antes da aprovação: Queixa principal.",
          }),
          { status: 400, headers: { "Content-Type": "application/json" } },
        );
      }) as unknown as typeof fetch;

      try {
        await approveAnamnesis("clinica-teste", "c-123", {
          version: 3,
        });
        expect.unreachable();
      } catch (err) {
        expect(err).toBeInstanceOf(ConsultationsApiError);
        const apiErr = err as InstanceType<typeof ConsultationsApiError>;
        expect(apiErr.code).toBe("VALIDATION_ERROR");
        expect(apiErr.message).toContain("Tópicos obrigatórios");
      }
    });

    test("approveAnamnesisAction returns structured success response upon approval", async () => {
      globalThis.fetch = (async () => {
        return Response.json({
          status: "APPROVED",
          signedBy: "Dra. Juliana Mendes - CRM/SP 123456",
          approvedAt: "2026-10-17T14:42:00.000Z",
          consultationId: "c-123",
          version: 4,
          snapshotHash: "sha256_999888777",
        });
      }) as unknown as typeof fetch;

      const result = await approveAnamnesisAction("clinica-teste", "c-123", {
        version: 3,
      });

      expect(result.success).toBe(true);
      expect(result.data?.status).toBe("APPROVED");
      expect(result.data?.signedBy).toContain("CRM/SP 123456");
    });
  });

  describe("6. Read-Only Freeze and Verified Stamp in UI", () => {
    test("when APPROVED, all topic inputs are readOnly and disabled, and save/approve buttons are removed", () => {
      const approvedConsultation = {
        ...mockConsultationBase,
        anamnesisStatus: "APPROVED" as const,
        status: "COMPLETED" as const,
        signedBy: "Dra. Juliana Mendes (CRM/SP 123456)",
        approvedAt: "2026-10-17T14:45:00.000Z",
        snapshotHash: "sha256_abcdef0123456789",
      };

      const html = renderToStaticMarkup(
        createElement(AnamnesisReviewView, {
          orgSlug: "clinica-teste",
          consultation: approvedConsultation,
          userRole: "PROFESSIONAL",
        }),
      );

      // Save and approve buttons must NOT exist
      expect(html).not.toContain('data-testid="save-draft-button"');
      expect(html).not.toContain('data-testid="approve-anamnesis-button"');

      // Topic inputs must be strictly readOnly and disabled
      expect(html).toContain('readOnly=""');
      expect(html).toContain('disabled=""');

      // Verified stamp banner presence
      expect(html).toContain('data-testid="verified-stamp-banner"');
      expect(html).toContain("Anamnese Aprovada e Homologada");
      expect(html).toContain("Documento Imutável");
      expect(html).toContain("Dra. Juliana Mendes");
      expect(html).toContain("CRM/SP 123456");
      expect(html).toContain("sha256_abcdef0123456789");
    });

    test("formatDoctorVerificationStamp resolves doctor name and registration correctly", () => {
      const stamp = formatDoctorVerificationStamp(
        {
          id: "p-1",
          fullName: "Dr. Marcelo Ramos",
          professionalTitle: "Clínico Geral",
          registrationNumber: "CRM/MG 65432",
        },
        null,
      );

      expect(stamp.doctorName).toBe("Dr. Marcelo Ramos");
      expect(stamp.registration).toBe("CRM/MG 65432");
    });
  });

  describe("7. Role-Based Access Control (RBAC)", () => {
    test("renders editable inputs and save/approve buttons for clinical role (PROFESSIONAL)", () => {
      const html = renderToStaticMarkup(
        createElement(AnamnesisReviewView, {
          orgSlug: "clinica-teste",
          consultation: mockConsultationBase,
          userRole: "PROFESSIONAL",
        }),
      );

      expect(html).toContain('data-testid="save-draft-button"');
      expect(html).toContain('data-testid="approve-anamnesis-button"');
      expect(html).not.toContain('data-testid="non-clinical-warning"');
    });

    test("renders read-only view and restriction warning for non-clinical role (RECEPTIONIST)", () => {
      const html = renderToStaticMarkup(
        createElement(AnamnesisReviewView, {
          orgSlug: "clinica-teste",
          consultation: mockConsultationBase,
          userRole: "RECEPTIONIST",
        }),
      );

      // Warning banner for non-clinical member
      expect(html).toContain('data-testid="non-clinical-warning"');
      expect(html).toContain("Visualização restrita em modo somente-leitura");

      // Mutation buttons must be hidden
      expect(html).not.toContain('data-testid="save-draft-button"');
      expect(html).not.toContain('data-testid="approve-anamnesis-button"');

      // Inputs are readOnly
      expect(html).toContain('readOnly=""');
    });
  });

  describe("8. Error Mappings in Server Layer", () => {
    test("throws UNAUTHENTICATED when token is missing", async () => {
      mockToken = null;

      expect(getAnamnesisDraft("clinica-teste", "c-123")).rejects.toThrow(
        ConsultationsApiError,
      );

      expect(
        updateAnamnesisDraft("clinica-teste", "c-123", {
          version: 1,
          content: {},
        }),
      ).rejects.toThrow(ConsultationsApiError);

      expect(
        approveAnamnesis("clinica-teste", "c-123", { version: 1 }),
      ).rejects.toThrow(ConsultationsApiError);
    });

    test("throws FORBIDDEN when user lacks permissions (HTTP 403)", async () => {
      globalThis.fetch = (async () => {
        return new Response("Forbidden", { status: 403 });
      }) as unknown as typeof fetch;

      try {
        await updateAnamnesisDraft("clinica-teste", "c-123", {
          version: 1,
          content: {},
        });
        expect.unreachable();
      } catch (err) {
        expect(err).toBeInstanceOf(ConsultationsApiError);
        expect((err as InstanceType<typeof ConsultationsApiError>).code).toBe(
          "FORBIDDEN",
        );
      }
    });

    test("throws NOT_FOUND when consultation does not exist (HTTP 404)", async () => {
      globalThis.fetch = (async () => {
        return new Response("Not Found", { status: 404 });
      }) as unknown as typeof fetch;

      try {
        await approveAnamnesis("clinica-teste", "non-existent", { version: 1 });
        expect.unreachable();
      } catch (err) {
        expect(err).toBeInstanceOf(ConsultationsApiError);
        expect((err as InstanceType<typeof ConsultationsApiError>).code).toBe(
          "NOT_FOUND",
        );
      }
    });

    test("throws UNAVAILABLE on network failure", async () => {
      globalThis.fetch = (async () => {
        throw new Error("Network offline");
      }) as unknown as typeof fetch;

      try {
        await updateAnamnesisDraft("clinica-teste", "c-123", {
          version: 1,
          content: {},
        });
        expect.unreachable();
      } catch (err) {
        expect(err).toBeInstanceOf(ConsultationsApiError);
        expect((err as InstanceType<typeof ConsultationsApiError>).code).toBe(
          "UNAVAILABLE",
        );
      }
    });
  });
});
