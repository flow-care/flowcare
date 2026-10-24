import "server-only";

import { z } from "zod";
import { getServerConfig } from "./config";
import { getSessionToken } from "./session";

export const membershipRoles = [
  "ADMIN",
  "ADMIN_PROFESSIONAL",
  "PROFESSIONAL",
  "RECEPTIONIST",
] as const;

export const membershipRoleSchema = z.enum(membershipRoles);
export type MembershipRole = z.infer<typeof membershipRoleSchema>;

export const teamMemberSchema = z.object({
  id: z.string(),
  userId: z.string(),
  userName: z.string(),
  email: z.string(),
  role: membershipRoleSchema,
  preset: z.enum(["ADMIN", "PROFESSIONAL", "RECEPTIONIST"]).optional(),
  /** Permissões efetivas; vazio quando a API antiga não manda a lista. */
  permissions: z.array(z.string()).default([]),
  isCustomized: z.boolean().default(false),
  status: z.enum(["ACTIVE", "SUSPENDED", "INVITED"]).default("ACTIVE"),
  createdAt: z.string(),
  version: z.number().int(),
});

export type TeamMember = z.infer<typeof teamMemberSchema>;

export const listMembersResponseSchema = z.object({
  data: z.array(teamMemberSchema),
  isSoloClinic: z.boolean().optional(),
  presetPermissions: z
    .object({
      ADMIN: z.array(z.string()),
      PROFESSIONAL: z.array(z.string()),
      RECEPTIONIST: z.array(z.string()),
    })
    .optional(),
});

export const permissionCatalogSchema = z.object({
  groups: z.array(
    z.object({
      id: z.string(),
      label: z.string(),
      description: z.string(),
      permissions: z.array(
        z.object({
          name: z.string(),
          label: z.string(),
          description: z.string(),
        }),
      ),
    }),
  ),
  presets: z.object({
    ADMIN: z.array(z.string()),
    PROFESSIONAL: z.array(z.string()),
    RECEPTIONIST: z.array(z.string()),
  }),
});

export type PermissionCatalog = z.infer<typeof permissionCatalogSchema>;

export const teamInviteSchema = z.object({
  id: z.string(),
  email: z.string(),
  role: membershipRoleSchema,
  expiresAt: z.string(),
  createdAt: z.string().optional(),
});

export type TeamInvite = z.infer<typeof teamInviteSchema>;

export const listInvitesResponseSchema = z.object({
  data: z.array(teamInviteSchema),
  roles: z.array(z.string()).optional(),
});

export const resendInviteResponseSchema = z.object({
  id: z.string(),
  email: z.string(),
  expiresAt: z.string(),
});

export type ResendInviteResponse = z.infer<typeof resendInviteResponseSchema>;

export const createInviteResponseSchema = z.object({
  id: z.string(),
  email: z.string(),
  expiresAt: z.string(),
});

export type CreateInviteResponse = z.infer<typeof createInviteResponseSchema>;

export interface TeamData {
  members: TeamMember[];
  invites: TeamInvite[];
  isSoloClinic: boolean;
}

export class TeamApiError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "TeamApiError";
  }
}

export async function getTeamMembersAndInvites(
  orgSlug: string,
): Promise<TeamData> {
  const token = await getSessionToken();
  if (!token) {
    throw new TeamApiError(
      "UNAUTHENTICATED",
      "Entre novamente para continuar.",
    );
  }

  const { apiBaseUrl } = getServerConfig();
  const headers = {
    Authorization: `Bearer ${token}`,
    Accept: "application/json",
  };

  let membersRes: Response;
  let invitesRes: Response;

  try {
    const results = await Promise.all([
      fetch(
        `${apiBaseUrl}/organizations/${encodeURIComponent(orgSlug)}/members`,
        {
          method: "GET",
          headers,
          cache: "no-store",
          redirect: "error",
          signal: AbortSignal.timeout(10_000),
        },
      ),
      fetch(
        `${apiBaseUrl}/organizations/${encodeURIComponent(orgSlug)}/invites`,
        {
          method: "GET",
          headers,
          cache: "no-store",
          redirect: "error",
          signal: AbortSignal.timeout(10_000),
        },
      ),
    ]);
    membersRes = results[0];
    invitesRes = results[1];
  } catch {
    throw new TeamApiError(
      "UNAVAILABLE",
      "Não foi possível carregar os dados da equipe. Tente novamente.",
    );
  }

  if (!membersRes.ok || !invitesRes.ok) {
    const failedRes = !membersRes.ok ? membersRes : invitesRes;
    const status = failedRes.status;
    const code =
      status === 401
        ? "UNAUTHENTICATED"
        : status === 403
          ? "FORBIDDEN"
          : status === 404
            ? "NOT_FOUND"
            : "UNAVAILABLE";
    const message =
      code === "UNAUTHENTICATED"
        ? "Entre novamente para continuar."
        : code === "FORBIDDEN"
          ? "Acesso restrito a administradores da clínica."
          : code === "NOT_FOUND"
            ? "Clínica não encontrada."
            : "Não foi possível carregar os dados da equipe.";
    throw new TeamApiError(code, message);
  }

  const [membersJson, invitesJson] = await Promise.all([
    membersRes.json(),
    invitesRes.json(),
  ]).catch(() => {
    throw new TeamApiError(
      "INVALID_RESPONSE",
      "Resposta inválida do servidor ao carregar dados da equipe.",
    );
  });

  const parsedMembers = listMembersResponseSchema.safeParse(membersJson);
  const parsedInvites = listInvitesResponseSchema.safeParse(invitesJson);

  if (!parsedMembers.success || !parsedInvites.success) {
    throw new TeamApiError(
      "INVALID_RESPONSE",
      "Resposta inválida do servidor ao carregar dados da equipe.",
    );
  }

  return {
    members: parsedMembers.data.data,
    invites: parsedInvites.data.data,
    isSoloClinic: parsedMembers.data.isSoloClinic ?? false,
  };
}

/** Catálogo de permissões (rótulos, grupos e presets) vindo da API. */
export async function getPermissionCatalog(
  orgSlug: string,
): Promise<PermissionCatalog | null> {
  const token = await getSessionToken();
  if (!token) return null;
  const { apiBaseUrl } = getServerConfig();
  try {
    const response = await fetch(
      `${apiBaseUrl}/organizations/${encodeURIComponent(orgSlug)}/permissions/catalog`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/json",
        },
        cache: "no-store",
        redirect: "error",
        signal: AbortSignal.timeout(10_000),
      },
    );
    if (!response.ok) {
      // Não engolir o status: um 403 aqui já custou um diagnóstico inteiro.
      console.warn(
        `[team] GET permissions/catalog respondeu ${response.status}`,
      );
      return null;
    }
    const parsed = permissionCatalogSchema.safeParse(await response.json());
    return parsed.success ? parsed.data : null;
  } catch (error) {
    console.warn("[team] falha ao carregar catálogo de permissões", error);
    return null;
  }
}

export async function updateMemberPermissions(
  orgSlug: string,
  memberId: string,
  payload: {
    permissions?: string[];
    preset?: "ADMIN" | "PROFESSIONAL" | "RECEPTIONIST";
    version: number;
  },
): Promise<UpdateMemberRoleResponse> {
  const token = await getSessionToken();
  if (!token) {
    throw new TeamApiError(
      "UNAUTHENTICATED",
      "Entre novamente para continuar.",
    );
  }

  const { apiBaseUrl } = getServerConfig();
  let response: Response;
  try {
    response = await fetch(
      `${apiBaseUrl}/organizations/${encodeURIComponent(orgSlug)}/members/${encodeURIComponent(memberId)}/permissions`,
      {
        method: "PATCH",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify(payload),
        cache: "no-store",
        redirect: "error",
        signal: AbortSignal.timeout(10_000),
      },
    );
  } catch {
    throw new TeamApiError(
      "UNAVAILABLE",
      "Não foi possível salvar as permissões. Tente novamente.",
    );
  }

  const data: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const code =
      (data as { error?: { code?: string } } | null)?.error?.code ??
      "UNAVAILABLE";
    throw new TeamApiError(
      code,
      (data as { error?: { message?: string } } | null)?.error?.message ??
        "Não foi possível salvar as permissões.",
    );
  }

  const parsed = updateMemberRoleResponseSchema.safeParse(data);
  if (!parsed.success) {
    throw new TeamApiError(
      "INVALID_RESPONSE",
      "Resposta inválida do servidor ao salvar permissões.",
    );
  }
  return parsed.data;
}

export async function resendInvite(
  orgSlug: string,
  inviteId: string,
): Promise<ResendInviteResponse> {
  const token = await getSessionToken();
  if (!token) {
    throw new TeamApiError(
      "UNAUTHENTICATED",
      "Entre novamente para continuar.",
    );
  }

  const { apiBaseUrl } = getServerConfig();
  let response: Response;
  try {
    response = await fetch(
      `${apiBaseUrl}/organizations/${encodeURIComponent(orgSlug)}/invites/${encodeURIComponent(inviteId)}/resend`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/json",
        },
        cache: "no-store",
        redirect: "error",
        signal: AbortSignal.timeout(10_000),
      },
    );
  } catch {
    throw new TeamApiError(
      "UNAVAILABLE",
      "Não foi possível reenviar o convite. Tente novamente.",
    );
  }

  const data: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const errorData =
      data && typeof data === "object" && "error" in data
        ? (data as { error?: { code?: string; message?: string } }).error
        : null;
    const code =
      errorData?.code ??
      (response.status === 401
        ? "UNAUTHENTICATED"
        : response.status === 403
          ? "FORBIDDEN"
          : response.status === 404
            ? "NOT_FOUND"
            : response.status === 409
              ? "ALREADY_EXISTS"
              : "UNAVAILABLE");
    const message =
      errorData?.message ??
      (code === "NOT_FOUND"
        ? "Convite pendente não encontrado."
        : code === "FORBIDDEN"
          ? "Permissão insuficiente."
          : code === "ALREADY_EXISTS"
            ? "Esta pessoa já é membro da clínica."
            : "Não foi possível reenviar o convite.");
    throw new TeamApiError(code, message);
  }

  const parsed = resendInviteResponseSchema.safeParse(data);
  if (!parsed.success) {
    throw new TeamApiError(
      "INVALID_RESPONSE",
      "Resposta inválida do servidor ao reenviar convite.",
    );
  }

  return parsed.data;
}

export async function revokeInvite(
  orgSlug: string,
  inviteId: string,
): Promise<{ success: boolean; message: string }> {
  const token = await getSessionToken();
  if (!token) {
    throw new TeamApiError(
      "UNAUTHENTICATED",
      "Entre novamente para continuar.",
    );
  }

  const { apiBaseUrl } = getServerConfig();
  let response: Response;
  try {
    response = await fetch(
      `${apiBaseUrl}/organizations/${encodeURIComponent(orgSlug)}/invites/${encodeURIComponent(inviteId)}`,
      {
        method: "DELETE",
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/json",
        },
        cache: "no-store",
        redirect: "error",
        signal: AbortSignal.timeout(10_000),
      },
    );
  } catch {
    throw new TeamApiError(
      "UNAVAILABLE",
      "Não foi possível revogar o convite. Tente novamente.",
    );
  }

  const data: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const errorData =
      data && typeof data === "object" && "error" in data
        ? (data as { error?: { code?: string; message?: string } }).error
        : null;
    const code =
      errorData?.code ??
      (response.status === 401
        ? "UNAUTHENTICATED"
        : response.status === 403
          ? "FORBIDDEN"
          : response.status === 404
            ? "NOT_FOUND"
            : "UNAVAILABLE");
    const message =
      errorData?.message ??
      (code === "NOT_FOUND"
        ? "Convite pendente não encontrado."
        : code === "FORBIDDEN"
          ? "Permissão insuficiente."
          : "Não foi possível revogar o convite.");
    throw new TeamApiError(code, message);
  }

  return {
    success: true,
    message: "Convite revogado com sucesso.",
  };
}

export async function createInvite(
  orgSlug: string,
  payload: { email: string; role: string; expiresInDays?: number },
): Promise<CreateInviteResponse> {
  const token = await getSessionToken();
  if (!token) {
    throw new TeamApiError(
      "UNAUTHENTICATED",
      "Entre novamente para continuar.",
    );
  }

  const { apiBaseUrl } = getServerConfig();
  let response: Response;
  try {
    response = await fetch(
      `${apiBaseUrl}/organizations/${encodeURIComponent(orgSlug)}/invites`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({
          email: payload.email.trim().toLowerCase(),
          role: payload.role,
        }),
        cache: "no-store",
        redirect: "error",
        signal: AbortSignal.timeout(10_000),
      },
    );
  } catch {
    throw new TeamApiError(
      "UNAVAILABLE",
      "Não foi possível enviar o convite. Tente novamente.",
    );
  }

  const data: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const errorData =
      data && typeof data === "object" && "error" in data
        ? (data as { error?: { code?: string; message?: string } }).error
        : null;
    const code =
      errorData?.code ??
      (response.status === 401
        ? "UNAUTHENTICATED"
        : response.status === 403
          ? "FORBIDDEN"
          : response.status === 404
            ? "NOT_FOUND"
            : response.status === 409
              ? "ALREADY_EXISTS"
              : "UNAVAILABLE");
    const message =
      errorData?.message ??
      (code === "NOT_FOUND"
        ? "Clínica não encontrada."
        : code === "FORBIDDEN"
          ? "Permissão insuficiente para convidar membros."
          : code === "ALREADY_EXISTS"
            ? "Esta pessoa já é membro da clínica ou possui convite pendente."
            : "Não foi possível enviar o convite.");
    throw new TeamApiError(code, message);
  }

  const parsed = createInviteResponseSchema.safeParse(data);
  if (!parsed.success) {
    throw new TeamApiError(
      "INVALID_RESPONSE",
      "Resposta inválida do servidor ao criar convite.",
    );
  }

  return parsed.data;
}

export const updateMemberRoleResponseSchema = z.object({
  id: z.string(),
  userId: z.string(),
  organizationId: z.string().optional(),
  role: membershipRoleSchema,
  status: z.string().optional(),
  version: z.number().int(),
  createdAt: z.string().optional(),
  updatedAt: z.string().optional(),
  user: z
    .object({
      id: z.string(),
      fullName: z.string(),
      email: z.string(),
      professionalRole: z.string().nullable().optional(),
      professionalTitle: z.string().nullable().optional(),
      registrationNumber: z.string().nullable().optional(),
    })
    .optional(),
  member: z
    .object({
      id: z.string(),
      userId: z.string(),
      organizationId: z.string(),
      role: membershipRoleSchema,
      status: z.string(),
      version: z.number().int(),
      createdAt: z.string().optional(),
      updatedAt: z.string().optional(),
    })
    .optional(),
});

export type UpdateMemberRoleResponse = z.infer<
  typeof updateMemberRoleResponseSchema
>;

export async function updateMemberRole(
  orgSlug: string,
  memberId: string,
  payload: { role: string; version: number },
): Promise<UpdateMemberRoleResponse> {
  const token = await getSessionToken();
  if (!token) {
    throw new TeamApiError(
      "UNAUTHENTICATED",
      "Entre novamente para continuar.",
    );
  }

  const { apiBaseUrl } = getServerConfig();
  let response: Response;
  try {
    response = await fetch(
      `${apiBaseUrl}/organizations/${encodeURIComponent(orgSlug)}/members/${encodeURIComponent(memberId)}/role`,
      {
        method: "PATCH",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({
          role: payload.role,
          version: payload.version,
        }),
        cache: "no-store",
        redirect: "error",
        signal: AbortSignal.timeout(10_000),
      },
    );
  } catch {
    throw new TeamApiError(
      "UNAVAILABLE",
      "Não foi possível atualizar o papel do colaborador. Tente novamente.",
    );
  }

  const data: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const errorData =
      data && typeof data === "object" && "error" in data
        ? (data as { error?: { code?: string; message?: string } }).error
        : null;
    const code =
      errorData?.code ??
      (response.status === 401
        ? "UNAUTHENTICATED"
        : response.status === 403
          ? "FORBIDDEN"
          : response.status === 404
            ? "NOT_FOUND"
            : response.status === 409
              ? "VERSION_CONFLICT"
              : response.status === 422
                ? "CLINICAL_QUALIFICATION_REQUIRED"
                : "UNAVAILABLE");
    const message =
      errorData?.message ??
      (code === "VERSION_CONFLICT"
        ? "O membro foi modificado por outro usuário. Recarregue os dados e tente novamente."
        : code === "LAST_ADMIN_REQUIRED"
          ? "A clínica deve manter ao menos um administrador ativo."
          : code === "FORBIDDEN"
            ? "Não é permitido alterar o próprio papel por esta rota."
            : code === "CLINICAL_QUALIFICATION_REQUIRED"
              ? "Dados profissionais exigidos para atribuição de papel clínico."
              : code === "NOT_FOUND"
                ? "Membro não encontrado."
                : code === "UNAUTHENTICATED"
                  ? "Entre novamente para continuar."
                  : "Não foi possível atualizar o papel do colaborador.");
    throw new TeamApiError(code, message);
  }

  const parsed = updateMemberRoleResponseSchema.safeParse(data);
  if (!parsed.success) {
    throw new TeamApiError(
      "INVALID_RESPONSE",
      "Resposta inválida do servidor ao atualizar papel do membro.",
    );
  }

  return parsed.data;
}

export const removeMemberResponseSchema = z.object({
  success: z.literal(true),
  message: z.string(),
  memberId: z.string(),
});

export type RemoveMemberResponse = z.infer<typeof removeMemberResponseSchema>;

export async function removeMember(
  orgSlug: string,
  memberId: string,
): Promise<RemoveMemberResponse> {
  const token = await getSessionToken();
  if (!token) {
    throw new TeamApiError(
      "UNAUTHENTICATED",
      "Entre novamente para continuar.",
    );
  }

  const { apiBaseUrl } = getServerConfig();
  let response: Response;
  try {
    response = await fetch(
      `${apiBaseUrl}/organizations/${encodeURIComponent(orgSlug)}/members/${encodeURIComponent(memberId)}`,
      {
        method: "DELETE",
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/json",
        },
        cache: "no-store",
        redirect: "error",
        signal: AbortSignal.timeout(10_000),
      },
    );
  } catch {
    throw new TeamApiError(
      "UNAVAILABLE",
      "Não foi possível remover o membro da clínica. Tente novamente.",
    );
  }

  const data: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const errorData =
      data && typeof data === "object" && "error" in data
        ? (data as { error?: { code?: string; message?: string } }).error
        : null;
    const code =
      errorData?.code ??
      (response.status === 401
        ? "UNAUTHENTICATED"
        : response.status === 403
          ? "FORBIDDEN"
          : response.status === 404
            ? "NOT_FOUND"
            : response.status === 409
              ? "LAST_ADMIN_REQUIRED"
              : "UNAVAILABLE");
    const message =
      errorData?.message ??
      (code === "LAST_ADMIN_REQUIRED"
        ? "Não é possível remover o único administrador remanescente da organização."
        : code === "NOT_FOUND"
          ? "Membro não encontrado."
          : code === "FORBIDDEN" || code === "PERMISSION_DENIED"
            ? "Você não possui permissão para realizar esta ação."
            : "Não foi possível remover o membro da clínica.");
    throw new TeamApiError(code, message);
  }

  const parsed = removeMemberResponseSchema.safeParse(data);
  if (!parsed.success) {
    throw new TeamApiError(
      "INVALID_RESPONSE",
      "Resposta inválida ao remover membro.",
    );
  }

  return parsed.data;
}
