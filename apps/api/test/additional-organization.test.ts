import { expect, test } from "bun:test";
import { hash } from "argon2";
import { createApp } from "../src/app";
import type { Env } from "../src/config/env";
import type { PrismaClient } from "../src/generated/prisma/client";
import { signSessionToken } from "../src/services/session-token";

const env = {
  port: 0,
  nodeEnv: "test",
  version: "test",
  jwtSecret: "test-secret",
  databaseUrl: "postgresql://unused",
  corsOrigin: "http://localhost:3000",
  trustProxy: false,
  wahaBaseUrl: "http://127.0.0.1:1",
  wahaApiKey: null,
  webAppUrl: "http://localhost:3000",
  sesRegion: null,
  mailProvider: "disabled",
  mailFrom: null,
} satisfies Env;

function setup() {
  const organizations = new Map<
    string,
    { id: string; name: string; slug: string }
  >();
  const memberships = new Map<
    string,
    { userId: string; organizationId: string; status: string }
  >();
  const users = new Map([
    ["user-a", { activeOrganizationId: null as string | null }],
  ]);
  let id = 0;
  let failMembership = false;
  const prisma = {
    session: {
      findFirst: async () => ({ id: "session-a", lastActiveAt: new Date() }),
    },
    organization: {
      create: async ({ data }: { data: { name: string; slug: string } }) => {
        if (organizations.has(data.slug)) throw { code: "P2002" };
        const org = { id: `org-${++id}`, name: data.name, slug: data.slug };
        organizations.set(org.slug, org);
        return org;
      },
    },
    membership: {
      create: async ({
        data,
      }: {
        data: { userId: string; organizationId: string; status: string };
      }) => {
        if (failMembership) throw new Error("membership failure");
        memberships.set(data.organizationId, data);
      },
      findFirst: async ({
        where,
      }: {
        where: {
          userId: string;
          status: string;
          organization: { slug: string };
        };
      }) => {
        const org = organizations.get(where.organization.slug);
        const membership = org && memberships.get(org.id);
        return org &&
          membership?.userId === where.userId &&
          membership.status === where.status
          ? { organization: { id: org.id, slug: org.slug } }
          : null;
      },
    },
    subscription: { create: async () => ({}) },
    user: {
      update: async ({
        where,
        data,
      }: {
        where: { id: string };
        data: { activeOrganizationId: string };
      }) => {
        const user = users.get(where.id);
        if (!user) throw new Error("user missing");
        user.activeOrganizationId = data.activeOrganizationId;
      },
    },
    $transaction: async (fn: (tx: unknown) => Promise<unknown>) => {
      const orgSnapshot = new Map(organizations);
      const memberSnapshot = new Map(memberships);
      const active = users.get("user-a")?.activeOrganizationId ?? null;
      try {
        return await fn(prisma);
      } catch (error) {
        organizations.clear();
        for (const [key, value] of orgSnapshot) organizations.set(key, value);
        memberships.clear();
        for (const [key, value] of memberSnapshot) memberships.set(key, value);
        const user = users.get("user-a");
        if (user) user.activeOrganizationId = active;
        throw error;
      }
    },
  } as unknown as PrismaClient;
  const app = createApp(env, {
    prisma,
    mailer: { send: async () => {} },
    profilePhotoStore: null,
  });
  const bearer = {
    authorization: `Bearer ${signSessionToken({ sid: "session-a", sub: "user-a" }, env.jwtSecret, 3600)}`,
    "content-type": "application/json",
  };
  const request = (path: string, body: unknown, authorized = true) =>
    app.handle(
      new Request(`http://localhost/api${path}`, {
        method: path === "/organizations" ? "POST" : "PATCH",
        headers: authorized ? bearer : { "content-type": "application/json" },
        body: JSON.stringify(body),
      }),
    );
  return {
    request,
    organizations,
    memberships,
    users,
    setFailMembership: (value: boolean) => {
      failMembership = value;
    },
  };
}

test("creates additional clinics with unique slugs, owner/admin membership and active preference", async () => {
  const state = setup();
  const first = await state.request("/organizations", { name: "Pet Saúde" });
  expect(first.status).toBe(201);
  expect(
    ((await first.json()) as { organization: unknown }).organization,
  ).toMatchObject({ slug: "pet-saude", role: "ADMIN", isOwner: true });
  const second = await state.request("/organizations", { name: "Pet Saúde" });
  expect(second.status).toBe(201);
  const secondBody = (await second.json()) as {
    organization: { id: string; slug: string };
  };
  expect(secondBody.organization.slug).toBe("pet-saude-2");
  expect(state.memberships.size).toBe(2);
  expect(state.users.get("user-a")?.activeOrganizationId).toBe(
    secondBody.organization.id,
  );
});

test("creation is atomic when membership provisioning fails", async () => {
  const state = setup();
  state.setFailMembership(true);
  expect(
    (await state.request("/organizations", { name: "Outra Clínica" })).status,
  ).toBe(500);
  expect(state.organizations.size).toBe(0);
  expect(state.users.get("user-a")?.activeOrganizationId).toBeNull();
});

test("switches only to active own membership; rejects foreign, suspended and anonymous access", async () => {
  const state = setup();
  await state.request("/organizations", { name: "Pet Saúde" });
  const selected = await state.request("/account/active-organization", {
    orgSlug: "pet-saude",
  });
  expect(selected.status).toBe(200);
  expect(
    ((await selected.json()) as { activeOrganization: { slug: string } })
      .activeOrganization.slug,
  ).toBe("pet-saude");
  expect(
    (
      await state.request("/account/active-organization", {
        orgSlug: "foreign",
      })
    ).status,
  ).toBe(403);
  const membership = state.memberships.get("org-1");
  if (membership) membership.status = "SUSPENDED";
  expect(
    (
      await state.request("/account/active-organization", {
        orgSlug: "pet-saude",
      })
    ).status,
  ).toBe(403);
  expect(
    (await state.request("/organizations", { name: "Other" }, false)).status,
  ).toBe(401);
  expect(
    (
      await state.request(
        "/account/active-organization",
        { orgSlug: "pet-saude" },
        false,
      )
    ).status,
  ).toBe(401);
});

test("login returns saved organization only while its membership remains active", async () => {
  const password = "Password123";
  const passwordHash = await hash(password);
  let membershipActive = true;
  const prisma = {
    user: {
      findUnique: async () => ({
        id: "user-a",
        email: "ana@example.com",
        fullName: "Ana",
        passwordHash,
        emailVerified: true,
        profileCompletedAt: new Date(),
        activeOrganizationId: "org-1",
        memberships: membershipActive
          ? [
              {
                organizationId: "org-1",
                role: "ADMIN",
                organization: {
                  id: "org-1",
                  name: "Pet Saúde",
                  slug: "pet-saude",
                  ownerId: "user-a",
                },
              },
            ]
          : [],
        onboarding: null,
      }),
    },
    session: { create: async () => ({ id: "new-session" }) },
  } as unknown as PrismaClient;
  const app = createApp(env, {
    prisma,
    mailer: { send: async () => {} },
    profilePhotoStore: null,
  });
  const login = () =>
    app.handle(
      new Request("http://localhost/api/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: "ana@example.com", password }),
      }),
    );
  const first = await login();
  expect(first.status).toBe(200);
  expect(
    ((await first.json()) as { activeOrganization: unknown })
      .activeOrganization,
  ).toEqual({ id: "org-1", slug: "pet-saude" });
  membershipActive = false;
  const second = await login();
  expect(second.status).toBe(200);
  expect(
    ((await second.json()) as { activeOrganization: unknown })
      .activeOrganization,
  ).toBeNull();
});
