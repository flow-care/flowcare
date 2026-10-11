import { expect, test } from "bun:test";
import type { PrismaClient } from "../src/generated/prisma/client";
import { organizationsModule } from "../src/modules/organizations";
import { OrganizationsService } from "../src/modules/organizations/service";
import { signSessionToken } from "../src/services/session-token";

const memberships = [
  {
    userId: "user-1",
    status: "ACTIVE",
    role: "ADMIN",
    organization: {
      id: "org-1",
      name: "Pet Saúde",
      slug: "pet-saude",
      ownerId: "user-1",
    },
  },
  {
    userId: "user-1",
    status: "ACTIVE",
    role: "PROFESSIONAL",
    organization: {
      id: "org-2",
      name: "Clínica Norte",
      slug: "clinica-norte",
      ownerId: "user-2",
    },
  },
  {
    userId: "user-1",
    status: "SUSPENDED",
    role: "ADMIN",
    organization: {
      id: "org-3",
      name: "Suspensa",
      slug: "suspensa",
      ownerId: "user-1",
    },
  },
  {
    userId: "user-1",
    status: "INVITED",
    role: "RECEPTIONIST",
    organization: {
      id: "org-4",
      name: "Convidada",
      slug: "convidada",
      ownerId: "user-2",
    },
  },
  {
    userId: "user-2",
    status: "ACTIVE",
    role: "ADMIN",
    organization: {
      id: "org-5",
      name: "Alheia",
      slug: "alheia",
      ownerId: "user-2",
    },
  },
] as const;

function organizationPrisma() {
  const queries: unknown[] = [];
  const prisma = {
    membership: {
      findMany: async (args: {
        where: { userId: string; status: string };
        take: number;
      }) => {
        queries.push(args);
        return memberships
          .filter(
            (item) =>
              item.userId === args.where.userId &&
              item.status === args.where.status,
          )
          .slice(0, args.take);
      },
    },
  } as unknown as PrismaClient;
  return { prisma, queries };
}

test("lists only own active clinics, with a bounded and minimal response", async () => {
  const { prisma, queries } = organizationPrisma();
  const result = await new OrganizationsService(prisma).listForUser("user-1");
  expect(queries[0]).toMatchObject({
    where: { userId: "user-1", status: "ACTIVE" },
    select: {
      role: true,
      organization: { select: { id: true, name: true, slug: true } },
    },
    orderBy: { createdAt: "asc" },
    take: 100,
  });
  expect(result).toEqual({
    data: [
      {
        id: "org-1",
        name: "Pet Saúde",
        slug: "pet-saude",
        role: "ADMIN",
        status: "ACTIVE",
      },
      {
        id: "org-2",
        name: "Clínica Norte",
        slug: "clinica-norte",
        role: "PROFESSIONAL",
        status: "ACTIVE",
      },
    ],
  });
});

test("returns an empty list for an account without active clinics", async () => {
  const { prisma } = organizationPrisma();
  expect(await new OrganizationsService(prisma).listForUser("user-3")).toEqual({
    data: [],
  });
});

test("organization route derives account identity from the session and rejects unauthenticated requests", async () => {
  const { prisma, queries } = organizationPrisma();
  const sessionPrisma = Object.assign(prisma, {
    session: {
      findFirst: async () => ({ id: "session-1", lastActiveAt: new Date() }),
    },
  });
  const api = organizationsModule({
    prisma: sessionPrisma,
    jwtSecret: "test-secret",
  });
  const unauthenticated = await api.handle(
    new Request("http://localhost/organizations"),
  );
  expect(unauthenticated.status).toBe(500);
  expect(queries).toHaveLength(0);

  const token = signSessionToken(
    { sid: "session-1", sub: "user-2" },
    "test-secret",
    60,
  );
  const response = await api.handle(
    new Request("http://localhost/organizations", {
      headers: { authorization: `Bearer ${token}` },
    }),
  );
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({
    data: [
      {
        id: "org-5",
        name: "Alheia",
        slug: "alheia",
        role: "ADMIN",
        status: "ACTIVE",
      },
    ],
  });
  expect(queries[0]).toMatchObject({
    where: { userId: "user-2", status: "ACTIVE" },
  });
});

const contact = {
  version: 0,
  legalName: "Pet Saúde Ltda",
  taxId: "",
  contactEmail: "contato@pet.com",
  contactPhone: "85999999999",
};
const address = {
  version: 1,
  postalCode: "60000000",
  state: "CE",
  city: "Fortaleza",
  district: "Centro",
  street: "Rua das Flores",
  streetNumber: "10",
  addressComplement: "",
};

test("clinic steps deny users without an active admin membership", async () => {
  const prisma = {
    membership: { findFirst: async () => null },
  } as unknown as PrismaClient;
  const service = new OrganizationsService(prisma);
  await expect(
    service.getClinicDetails("other-user", "pet-saude"),
  ).rejects.toMatchObject({ code: "NOT_FOUND" });
  await expect(
    service.saveClinicContact("other-user", "pet-saude", contact),
  ).rejects.toMatchObject({ code: "NOT_FOUND" });
  await expect(
    service.saveClinicAddress("other-user", "pet-saude", address),
  ).rejects.toMatchObject({ code: "NOT_FOUND" });
});

test("contact and address save separately and advance onboarding", async () => {
  const org = {
    id: "org-1",
    name: "Pet Saúde",
    slug: "pet-saude",
    detailsVersion: 0,
    detailsCompletedAt: null as Date | null,
  };
  const progress = {
    currentStep: "ORGANIZATION_SETUP",
    completed: true,
    draftData: { organizationId: "org-1" },
  };
  const writes: Array<{
    where: { detailsVersion: number };
    data: Record<string, unknown>;
  }> = [];
  const prisma = {
    membership: { findFirst: async () => ({ organization: org }) },
    onboardingProgress: { findUnique: async () => progress },
    $transaction: async (fn: (tx: unknown) => Promise<unknown>) =>
      fn({
        membership: { findFirst: async () => ({ id: "membership-1" }) },
        onboardingProgress: {
          findUnique: async () => progress,
          update: async ({
            data,
          }: {
            data: { currentStep: string; completed: boolean };
          }) => {
            progress.currentStep = data.currentStep;
            progress.completed = data.completed;
          },
        },
        organization: {
          updateMany: async (args: {
            where: { detailsVersion: number };
            data: Record<string, unknown>;
          }) => {
            writes.push(args);
            org.detailsVersion++;
            if (args.data.detailsCompletedAt)
              org.detailsCompletedAt = args.data.detailsCompletedAt as Date;
            return { count: 1 };
          },
        },
      }),
  } as unknown as PrismaClient;
  const service = new OrganizationsService(prisma);
  await service.saveClinicContact("user-1", "pet-saude", contact);
  expect(writes[0]).toMatchObject({
    where: { detailsVersion: 0 },
    data: { legalName: "Pet Saúde Ltda" },
  });
  expect(writes[0]?.data.postalCode).toBeUndefined();
  expect(progress).toMatchObject({
    currentStep: "CLINIC_DETAILS",
    completed: true,
  });
  expect(org.detailsCompletedAt).toBeNull();
  await service.saveClinicAddress("user-1", "pet-saude", address);
  expect(writes[1]).toMatchObject({
    where: { detailsVersion: 1 },
    data: { city: "Fortaleza" },
  });
  expect(writes[1]?.data.legalName).toBeUndefined();
  expect(progress).toMatchObject({
    currentStep: "CLINIC_ADDRESS",
    completed: true,
  });
  expect(org.detailsCompletedAt).toBeInstanceOf(Date);
  await expect(
    service.saveClinicContact("user-1", "pet-saude", contact),
  ).rejects.toMatchObject({ code: "STEP_ALREADY_COMPLETED" });
  await expect(
    service.saveClinicAddress("user-1", "pet-saude", address),
  ).rejects.toMatchObject({ code: "STEP_ALREADY_COMPLETED" });
});

test("clinic steps reject stale versions and another onboarding organization", async () => {
  const org = { id: "org-1", detailsVersion: 1 };
  const progress = {
    currentStep: "ORGANIZATION_SETUP",
    completed: true,
    draftData: { organizationId: "org-1" },
  };
  const prisma = {
    membership: { findFirst: async () => ({ organization: org }) },
    onboardingProgress: { findUnique: async () => progress },
    $transaction: async (fn: (tx: unknown) => Promise<unknown>) =>
      fn({
        membership: { findFirst: async () => ({ id: "membership-1" }) },
        onboardingProgress: { findUnique: async () => progress },
        organization: { updateMany: async () => ({ count: 0 }) },
      }),
  } as unknown as PrismaClient;
  const service = new OrganizationsService(prisma);
  await expect(
    service.saveClinicContact("user-1", "pet-saude", contact),
  ).rejects.toMatchObject({ code: "CONFLICT" });
  org.id = "org-2";
  await expect(
    service.saveClinicContact("user-1", "pet-saude", contact),
  ).rejects.toMatchObject({ code: "NOT_FOUND" });
});
