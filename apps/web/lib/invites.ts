import { z } from "zod";

export const inviteRoleSchema = z.enum([
  "ADMIN",
  "ADMIN_PROFESSIONAL",
  "PROFESSIONAL",
  "RECEPTIONIST",
]);

export type InviteRole = z.infer<typeof inviteRoleSchema>;

export const inviteFormSchema = z.object({
  email: z
    .string()
    .trim()
    .email("Informe um e-mail válido.")
    .max(254)
    .transform((email) => email.toLowerCase()),
  role: inviteRoleSchema,
});

export const pendingInvitesSchema = z.object({
  data: z.array(
    z.object({
      id: z.string(),
      email: z.email(),
      role: inviteRoleSchema,
      expiresAt: z.string(),
    }),
  ),
  roles: z.array(inviteRoleSchema),
});

export type PendingInvite = z.infer<
  typeof pendingInvitesSchema
>["data"][number];

export const inviteDetailsSchema = z.object({
  organizationName: z.string(),
  organizationSlug: z.string(),
  email: z.string().email(),
  role: z.string(),
  expiresAt: z.string(),
});

export type InviteDetails = z.infer<typeof inviteDetailsSchema>;

export function formatInviteRole(role: string): string {
  switch (role) {
    case "ADMIN":
      return "Administrador";
    case "ADMIN_PROFESSIONAL":
      return "Administrador e Clínico";
    case "PROFESSIONAL":
      return "Profissional Clínico";
    case "RECEPTIONIST":
      return "Recepção";
    default:
      return role;
  }
}
