import { z } from "zod";

export const MAX_PROFILE_PHOTO_SIZE_BYTES = 2 * 1024 * 1024; // 2MB

export const ALLOWED_PROFILE_PHOTO_MIME_TYPES = [
  "image/png",
  "image/jpeg",
  "image/jpg",
] as const;

export const LOCKED_EMAIL_NOTICE =
  "Alterações de e-mail exigem fluxo próprio de confirmação de segurança";

export interface UserProfile {
  id: string;
  fullName: string;
  email: string;
  phone?: string | null;
  professionalTitle?: string | null;
  registrationNumber?: string | null;
  photo?: { contentType: string; sizeBytes: number } | null;
  photoUrl?: string | null;
}

export interface UpdateProfilePayload {
  fullName?: string;
  phone?: string;
  professionalTitle?: string;
  registrationNumber?: string;
}

export interface PhotoValidationResult {
  valid: boolean;
  error?: string;
}

export function validateProfilePhoto(file: {
  name?: string;
  type?: string;
  size: number;
}): PhotoValidationResult {
  if (!file) {
    return { valid: false, error: "Nenhum arquivo selecionado." };
  }

  const type = file.type?.toLowerCase() || "";
  const name = file.name?.toLowerCase() || "";
  const hasValidExt =
    name.endsWith(".png") || name.endsWith(".jpg") || name.endsWith(".jpeg");

  const isAllowedType =
    type === "image/png" ||
    type === "image/jpeg" ||
    type === "image/jpg" ||
    (type === "" && hasValidExt);

  if (!isAllowedType) {
    return {
      valid: false,
      error: "Formato de arquivo não suportado. Envie uma imagem PNG ou JPG.",
    };
  }

  if (file.size <= 0) {
    return {
      valid: false,
      error: "O arquivo selecionado está vazio.",
    };
  }

  if (file.size > MAX_PROFILE_PHOTO_SIZE_BYTES) {
    return {
      valid: false,
      error: "A imagem excede o tamanho máximo permitido de 2MB.",
    };
  }

  return { valid: true };
}

export const profileFormSchema = z.object({
  fullName: z
    .string()
    .trim()
    .min(3, "Nome completo deve ter pelo menos 3 caracteres.")
    .max(120, "Nome completo não pode exceder 120 caracteres."),
  phone: z.string().trim().optional().nullable(),
  professionalTitle: z
    .string()
    .trim()
    .max(120, "Título profissional não pode exceder 120 caracteres.")
    .optional()
    .nullable(),
  registrationNumber: z
    .string()
    .trim()
    .max(80, "Registro profissional não pode exceder 80 caracteres.")
    .optional()
    .nullable(),
});

export type ProfileFormValues = z.infer<typeof profileFormSchema>;
