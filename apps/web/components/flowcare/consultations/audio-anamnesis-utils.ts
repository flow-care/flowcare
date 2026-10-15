export const MAX_AUDIO_SIZE_BYTES = 50 * 1024 * 1024; // 50MB

export const ALLOWED_AUDIO_EXTENSIONS = [
  ".mp3",
  ".wav",
  ".m4a",
  ".webm",
] as const;

export const ALLOWED_AUDIO_MIME_TYPES = [
  "audio/mpeg",
  "audio/mp3",
  "audio/wav",
  "audio/x-wav",
  "audio/wave",
  "audio/webm",
  "audio/mp4",
  "audio/m4a",
  "audio/x-m4a",
  "audio/aac",
] as const;

export interface AudioFileValidationResult {
  valid: boolean;
  error?: string;
}

export function validateAudioFile(file: {
  name: string;
  size: number;
  type: string;
}): AudioFileValidationResult {
  if (file.size <= 0) {
    return {
      valid: false,
      error: "O arquivo de áudio está vazio.",
    };
  }

  if (file.size > MAX_AUDIO_SIZE_BYTES) {
    return {
      valid: false,
      error: "O arquivo selecionado excede o limite máximo permitido de 50MB.",
    };
  }

  const nameLower = file.name.toLowerCase();
  const hasValidExtension = ALLOWED_AUDIO_EXTENSIONS.some((ext) =>
    nameLower.endsWith(ext),
  );
  const hasValidMime = ALLOWED_AUDIO_MIME_TYPES.includes(
    file.type as (typeof ALLOWED_AUDIO_MIME_TYPES)[number],
  );

  if (!hasValidExtension && !hasValidMime) {
    return {
      valid: false,
      error:
        "Formato de arquivo não suportado. Envie arquivos nos formatos MP3, WAV, M4A ou WebM.",
    };
  }

  return { valid: true };
}

export function formatAudioDuration(totalSeconds: number): string {
  const safeSeconds = Math.max(0, Math.floor(totalSeconds));
  const minutes = Math.floor(safeSeconds / 60);
  const seconds = safeSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

export function formatFileSize(bytes: number): string {
  if (bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  const value = bytes / 1024 ** i;
  return `${value.toFixed(1).replace(".0", "")} ${units[i]}`;
}

export function normalizeAudioContentType(
  mimeType: string,
  fileName = "",
): "audio/webm" | "audio/mpeg" | "audio/mp4" {
  const norm = mimeType.toLowerCase();
  const name = fileName.toLowerCase();

  if (norm.includes("webm") || name.endsWith(".webm")) {
    return "audio/webm";
  }
  if (norm.includes("mpeg") || norm.includes("mp3") || name.endsWith(".mp3")) {
    return "audio/mpeg";
  }
  if (norm.includes("mp4") || norm.includes("m4a") || name.endsWith(".m4a")) {
    return "audio/mp4";
  }
  return "audio/webm";
}

export function generateIdempotencyKey(): string {
  if (
    typeof crypto !== "undefined" &&
    typeof crypto.randomUUID === "function"
  ) {
    return crypto.randomUUID();
  }
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}
