export const CLINIC_LOGO_MAX_BYTES = 5 * 1024 * 1024; // 5MB
export const ALLOWED_LOGO_MIME_TYPES = [
  "image/png",
  "image/jpeg",
  "image/jpg",
  "image/webp",
] as const;

export function validateLogoFile(file: { size: number; type: string }): {
  valid: boolean;
  error?: string;
} {
  if (!file) {
    return { valid: false, error: "Nenhum arquivo fornecido." };
  }
  const mime = file.type?.toLowerCase();
  if (
    !mime ||
    !ALLOWED_LOGO_MIME_TYPES.includes(
      mime as (typeof ALLOWED_LOGO_MIME_TYPES)[number],
    )
  ) {
    return {
      valid: false,
      error: "Formato de arquivo inválido. Selecione uma imagem PNG ou JPG.",
    };
  }
  if (file.size > CLINIC_LOGO_MAX_BYTES) {
    return {
      valid: false,
      error: "O arquivo excede o limite máximo de 5MB.",
    };
  }
  if (file.size <= 0) {
    return {
      valid: false,
      error: "O arquivo selecionado está vazio.",
    };
  }
  return { valid: true };
}

export interface OrganizationLogoMetadata {
  contentType: string;
  sizeBytes: number;
  updatedAt: string;
}

export interface OrganizationSettings {
  id: string;
  name: string;
  slug: string;
  version: number;
  completed: boolean;
  legalName: string;
  taxId: string;
  contactEmail: string;
  contactPhone: string;
  postalCode: string;
  state: string;
  city: string;
  district: string;
  street: string;
  streetNumber: string;
  addressComplement: string;
  logo: OrganizationLogoMetadata | null;
  logoUrl?: string | null;
}

export interface UpdateOrganizationSettingsPayload {
  version: number;
  name?: string;
  legalName?: string;
  taxId?: string;
  contactEmail?: string;
  contactPhone?: string;
  postalCode?: string;
  state?: string;
  city?: string;
  district?: string;
  street?: string;
  streetNumber?: string;
  addressComplement?: string;
}
