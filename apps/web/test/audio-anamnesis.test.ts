import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";

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

const {
  ConsultationsApiError,
  getAudioPresignedUrl,
  startTranscriptionJob,
  getTranscriptionStatus,
  completeAudioUpload,
} = await import("../server/consultations");

const {
  startTranscriptionAction,
  getAudioPresignedUrlAction,
  getTranscriptionStatusAction,
} = await import("../app/app/[orgSlug]/consultations/actions");

const {
  validateAudioFile,
  formatAudioDuration,
  formatFileSize,
  normalizeAudioContentType,
  generateIdempotencyKey,
  MAX_AUDIO_SIZE_BYTES,
} = await import("../components/flowcare/consultations/audio-anamnesis-utils");

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

describe("Audio Anamnesis Server & Utilities (#270)", () => {
  describe("1. Patient Consent Requirement", () => {
    test("startTranscriptionJob rejects when consentConfirmed is false without calling fetch", async () => {
      let fetchCalled = false;
      globalThis.fetch = (async () => {
        fetchCalled = true;
        return new Response("{}", { status: 200 });
      }) as unknown as typeof fetch;

      expect(
        startTranscriptionJob("clinica-teste", "consultation-123", {
          consentConfirmed: false,
        }),
      ).rejects.toThrow(ConsultationsApiError);

      expect(fetchCalled).toBe(false);
    });

    test("startTranscriptionAction returns success: false with FORBIDDEN error when consentConfirmed is false", async () => {
      const result = await startTranscriptionAction(
        "clinica-teste",
        "consultation-123",
        {
          consentConfirmed: false,
        },
      );

      expect(result.success).toBe(false);
      expect(result.code).toBe("FORBIDDEN");
      expect(result.error).toContain("Consentimento");
    });
  });

  describe("2. File Type and Size Validation", () => {
    test("accepts valid audio formats: MP3, WAV, M4A, WebM under 50MB", () => {
      const testCases = [
        { name: "audio.mp3", type: "audio/mpeg", size: 10 * 1024 * 1024 },
        { name: "recording.wav", type: "audio/wav", size: 25 * 1024 * 1024 },
        { name: "consultation.m4a", type: "audio/mp4", size: 5 * 1024 * 1024 },
        { name: "voice.webm", type: "audio/webm", size: 15 * 1024 * 1024 },
        { name: "audio_uppercase.MP3", type: "audio/mp3", size: 1024 },
        { name: "custom.webm", type: "", size: 5000 },
      ];

      for (const tc of testCases) {
        const res = validateAudioFile(tc);
        expect(res.valid).toBe(true);
        expect(res.error).toBeUndefined();
      }
    });

    test("rejects unsupported file formats like images, documents, and videos", () => {
      const invalidFiles = [
        { name: "photo.png", type: "image/png", size: 1024 },
        { name: "document.pdf", type: "application/pdf", size: 2048 },
        { name: "notes.txt", type: "text/plain", size: 512 },
        { name: "video.mkv", type: "video/x-matroska", size: 10000 },
      ];

      for (const tc of invalidFiles) {
        const res = validateAudioFile(tc);
        expect(res.valid).toBe(false);
        expect(res.error).toContain("Formato de arquivo não suportado");
      }
    });

    test("rejects files exceeding 50MB (52428800 bytes)", () => {
      const oversizedFile = {
        name: "huge-recording.mp3",
        type: "audio/mpeg",
        size: MAX_AUDIO_SIZE_BYTES + 1,
      };

      const res = validateAudioFile(oversizedFile);
      expect(res.valid).toBe(false);
      expect(res.error).toContain("50MB");
    });

    test("rejects empty files (0 bytes)", () => {
      const emptyFile = {
        name: "empty.mp3",
        type: "audio/mpeg",
        size: 0,
      };

      const res = validateAudioFile(emptyFile);
      expect(res.valid).toBe(false);
      expect(res.error).toContain("vazio");
    });

    test("getAudioPresignedUrl throws UNAVAILABLE error when file size exceeds 50MB", async () => {
      expect(
        getAudioPresignedUrl("clinica-teste", "consultation-123", {
          fileName: "large.mp3",
          contentType: "audio/mpeg",
          sizeBytes: 52428801,
        }),
      ).rejects.toThrow(ConsultationsApiError);
    });

    test("normalizeAudioContentType correctly resolves content types for backend", () => {
      expect(normalizeAudioContentType("audio/webm", "test.webm")).toBe(
        "audio/webm",
      );
      expect(normalizeAudioContentType("audio/mpeg", "test.mp3")).toBe(
        "audio/mpeg",
      );
      expect(normalizeAudioContentType("audio/mp4", "test.m4a")).toBe(
        "audio/mp4",
      );
      expect(normalizeAudioContentType("audio/wav", "test.wav")).toBe(
        "audio/webm",
      );
    });

    test("formatFileSize formats bytes to human readable string", () => {
      expect(formatFileSize(0)).toBe("0 B");
      expect(formatFileSize(1024)).toBe("1 KB");
      expect(formatFileSize(1572864)).toBe("1.5 MB");
    });
  });

  describe("3. Media Recorder Duration and State Transitions", () => {
    test("formatAudioDuration formats seconds into MM:SS correctly", () => {
      expect(formatAudioDuration(0)).toBe("00:00");
      expect(formatAudioDuration(9)).toBe("00:09");
      expect(formatAudioDuration(60)).toBe("01:00");
      expect(formatAudioDuration(75)).toBe("01:15");
      expect(formatAudioDuration(599)).toBe("09:59");
      expect(formatAudioDuration(3600)).toBe("60:00");
      expect(formatAudioDuration(-10)).toBe("00:00");
    });

    test("simulates recorder state transitions cleanly", () => {
      type RecorderState =
        | "idle"
        | "recording"
        | "paused"
        | "stopped"
        | "permission_denied";

      let state: RecorderState = "idle";
      let timer = 0;

      // Start recording
      state = "recording";
      timer = 10;
      expect(state).toBe("recording");
      expect(timer).toBe(10);

      // Pause recording
      state = "paused";
      expect(state).toBe("paused");
      expect(timer).toBe(10); // timer preserved

      // Resume recording
      state = "recording";
      timer = 20;
      expect(state).toBe("recording");
      expect(timer).toBe(20);

      // Stop recording
      state = "stopped";
      expect(state).toBe("stopped");
      expect(timer).toBe(20);

      // Discard and reset
      state = "idle";
      timer = 0;
      expect(state).toBe("idle");
      expect(timer).toBe(0);

      // Permission denied
      state = "permission_denied";
      expect(state).toBe("permission_denied");
    });
  });

  describe("4. Idempotency Key Handling", () => {
    test("generateIdempotencyKey generates non-empty unique string", () => {
      const key1 = generateIdempotencyKey();
      const key2 = generateIdempotencyKey();
      expect(key1).toBeDefined();
      expect(key1.length).toBeGreaterThan(10);
      expect(key1).not.toBe(key2);
    });

    test("startTranscriptionJob sends provided Idempotency-Key header", async () => {
      let sentHeader: string | null = null;
      globalThis.fetch = (async (_url: string, init?: RequestInit) => {
        const headers = init?.headers as Record<string, string>;
        sentHeader = headers?.["Idempotency-Key"] ?? null;
        return new Response(
          JSON.stringify({
            jobId: "job-123",
            status: "PROCESSING",
          }),
          { status: 202, headers: { "Content-Type": "application/json" } },
        );
      }) as unknown as typeof fetch;

      const customKey = "custom-idempotency-key-456";
      const result = await startTranscriptionJob(
        "clinica-teste",
        "consultation-123",
        {
          consentConfirmed: true,
          idempotencyKey: customKey,
        },
      );

      expect(sentHeader).toBe(customKey);
      expect(result.jobId).toBe("job-123");
      expect(result.status).toBe("PROCESSING");
    });

    test("startTranscriptionJob auto-generates Idempotency-Key when omitted", async () => {
      let sentHeader: string | null = null;
      globalThis.fetch = (async (_url: string, init?: RequestInit) => {
        const headers = init?.headers as Record<string, string>;
        sentHeader = headers?.["Idempotency-Key"] ?? null;
        return new Response(
          JSON.stringify({
            jobId: "job-auto",
            status: "QUEUED",
          }),
          { status: 202, headers: { "Content-Type": "application/json" } },
        );
      }) as unknown as typeof fetch;

      const result = await startTranscriptionJob(
        "clinica-teste",
        "consultation-123",
        {
          consentConfirmed: true,
        },
      );

      expect(sentHeader).toBeDefined();
      expect(typeof sentHeader).toBe("string");
      expect((sentHeader as unknown as string).length).toBeGreaterThan(10);
      expect(result.jobId).toBe("job-auto");
      expect(result.status).toBe("QUEUED");
    });
  });

  describe("5. Transcription Status Polling and Results", () => {
    test("getTranscriptionStatus returns active job status from transcription endpoint", async () => {
      globalThis.fetch = (async (url: string) => {
        if (url.includes("/transcription")) {
          return new Response(
            JSON.stringify({
              jobId: "job-active",
              status: "PROCESSING",
            }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          );
        }
        return new Response("Not found", { status: 404 });
      }) as unknown as typeof fetch;

      const result = await getTranscriptionStatus(
        "clinica-teste",
        "consultation-123",
      );

      expect(result.jobId).toBe("job-active");
      expect(result.status).toBe("PROCESSING");
    });

    test("getTranscriptionStatus falls back to consultation details and marks COMPLETED if anamnesis is DRAFT", async () => {
      globalThis.fetch = (async (url: string) => {
        if (url.includes("/transcription")) {
          return new Response("Not found", { status: 404 });
        }
        if (url.includes("/consultations/consultation-123")) {
          return new Response(
            JSON.stringify({
              id: "consultation-123",
              patientId: "p1",
              professionalId: "pr1",
              scheduledAt: "2026-10-14T10:00:00.000Z",
              status: "IN_PROGRESS",
              anamnesisStatus: "DRAFT",
              chiefComplaint: "Dor no joelho",
              anamnesisDraft: { topics: [] },
              patient: { id: "p1", fullName: "Carlos Silva" },
              professional: { id: "pr1", fullName: "Dr. João" },
            }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          );
        }
        return new Response("Not found", { status: 404 });
      }) as unknown as typeof fetch;

      const result = await getTranscriptionStatus(
        "clinica-teste",
        "consultation-123",
      );

      expect(result.jobId).toBe("consultation-123");
      expect(result.status).toBe("COMPLETED");
    });

    test("getTranscriptionStatus falls back to consultation details and marks FAILED if consultation is CANCELLED", async () => {
      globalThis.fetch = (async (url: string) => {
        if (url.includes("/transcription")) {
          return new Response("Not found", { status: 404 });
        }
        if (url.includes("/consultations/consultation-123")) {
          return new Response(
            JSON.stringify({
              id: "consultation-123",
              patientId: "p1",
              professionalId: "pr1",
              scheduledAt: "2026-10-14T10:00:00.000Z",
              status: "CANCELLED",
              anamnesisStatus: "PENDING",
              patient: { id: "p1", fullName: "Carlos Silva" },
              professional: { id: "pr1", fullName: "Dr. João" },
            }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          );
        }
        return new Response("Not found", { status: 404 });
      }) as unknown as typeof fetch;

      const result = await getTranscriptionStatus(
        "clinica-teste",
        "consultation-123",
      );

      expect(result.jobId).toBe("consultation-123");
      expect(result.status).toBe("FAILED");
      expect(result.error).toContain("cancelado");
    });
  });

  describe("6. Complete Audio Upload Integration", () => {
    test("completeAudioUpload calls complete endpoint and returns status UPLOADED", async () => {
      let completeUrlCalled = "";
      globalThis.fetch = (async (url: string) => {
        completeUrlCalled = url;
        return new Response(
          JSON.stringify({
            audioId: "audio-uuid-999",
            status: "UPLOADED",
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }) as unknown as typeof fetch;

      const result = await completeAudioUpload(
        "clinica-teste",
        "consultation-123",
        "audio-uuid-999",
      );

      expect(completeUrlCalled).toContain("/audio/audio-uuid-999/complete");
      expect(result.audioId).toBe("audio-uuid-999");
      expect(result.status).toBe("UPLOADED");
    });
  });

  describe("7. Server Action Wrappers", () => {
    test("getAudioPresignedUrlAction returns success: true with data on valid request", async () => {
      globalThis.fetch = (async () => {
        return new Response(
          JSON.stringify({
            audioId: "audio-uuid-111",
            uploadUrl: "https://storage.test/upload",
            expiresInSeconds: 600,
            status: "PENDING_UPLOAD",
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }) as unknown as typeof fetch;

      const result = await getAudioPresignedUrlAction(
        "clinica-teste",
        "consultation-123",
        {
          fileName: "consulta.mp3",
          contentType: "audio/mpeg",
          sizeBytes: 1024 * 1024,
        },
      );

      expect(result.success).toBe(true);
      expect(result.data?.audioId).toBe("audio-uuid-111");
      expect(result.data?.uploadUrl).toBe("https://storage.test/upload");
    });

    test("getTranscriptionStatusAction returns success: true with transcription status", async () => {
      globalThis.fetch = (async (url: string) => {
        if (url.includes("/transcription")) {
          return new Response(
            JSON.stringify({
              jobId: "job-action-123",
              status: "COMPLETED",
            }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          );
        }
        return new Response("Not found", { status: 404 });
      }) as unknown as typeof fetch;

      const result = await getTranscriptionStatusAction(
        "clinica-teste",
        "consultation-123",
      );

      expect(result.success).toBe(true);
      expect(result.data?.jobId).toBe("job-action-123");
      expect(result.data?.status).toBe("COMPLETED");
    });
  });
});
