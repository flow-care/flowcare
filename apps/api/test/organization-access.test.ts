import { describe, expect, test } from "bun:test";
import { Elysia } from "elysia";
import type {
  MembershipRole,
  MembershipStatus,
  PrismaClient,
} from "../src/generated/prisma/client";
import { ApiError } from "../src/lib/api-error";
import { authPlugin } from "../src/plugins/auth";
import {
  hasOrganizationCapability,
  organizationAccessPlugin,
  resolveOrganizationAccess,
} from "../src/plugins/organization-access";
import { signSessionToken } from "../src/services/session-token";

const secret = "rbac-test-secret";
const slug = "clinic-a";
const organizationId = "11111111-1111-4111-8111-111111111111";

function fixture() {
  let role: MembershipRole = "ADMIN";
  let status: MembershipStatus = "ACTIVE";
  let membershipExists = true;
  let sessionExists = true;
  const queries: unknown[] = [];
  const prisma = {
    session: {
      findFirst: async () =>
        sessionExists ? { id: "session-a", lastActiveAt: new Date() } : null,
    },
    membership: {
      findFirst: async (query: unknown) => {
        queries.push(query);
        return membershipExists
          ? { id: "membership-a", organizationId, role, status }
          : null;
      },
    },
  } as unknown as PrismaClient;
  const app = new Elysia()
    .onError(({ error, status: responseStatus }) => {
      if (error instanceof ApiError)
        return responseStatus(error.httpStatus, {
          error: { code: error.code },
        });
      return responseStatus(500, { error: { code: "INTERNAL" } });
    })
    .use(authPlugin({ prisma, jwtSecret: secret }))
    .use(organizationAccessPlugin({ prisma, jwtSecret: secret }))
    .get(
      "/organizations/:orgSlug/settings",
      ({ organizationAccess }) => ({
        organizationId: organizationAccess.organizationId,
        role: organizationAccess.role,
      }),
      { organizationAccess: "settings:read" },
    )
    .get(
      "/organizations/:orgSlug/clinical",
      ({ organizationAccess }) => ({
        organizationId: organizationAccess.organizationId,
      }),
      { organizationAccess: "consultations:write" },
    );
  const token = signSessionToken(
    { sid: "session-a", sub: "user-a" },
    secret,
    60,
  );
  const request = (path: string, authenticated = true) =>
    app.handle(
      new Request(
        `http://localhost/organizations/${path}`,
        authenticated ? { headers: { authorization: `Bearer ${token}` } } : {},
      ),
    );
  return {
    prisma,
    queries,
    request,
    setRole: (value: MembershipRole) => {
      role = value;
    },
    setStatus: (value: MembershipStatus) => {
      status = value;
    },
    setMembership: (value: boolean) => {
      membershipExists = value;
    },
    setSession: (value: boolean) => {
      sessionExists = value;
    },
  };
}

describe("organization access", () => {
  test("matches the fixed MVP capacity matrix", () => {
    for (const role of ["ADMIN", "RECEPTIONIST"] as const) {
      expect(hasOrganizationCapability(role, "patients:read_history")).toBe(
        false,
      );
      expect(hasOrganizationCapability(role, "patients:attachments:read")).toBe(
        false,
      );
      expect(hasOrganizationCapability(role, "consultations:read")).toBe(false);
    }
    expect(hasOrganizationCapability("PROFESSIONAL", "team:manage")).toBe(
      false,
    );
    expect(hasOrganizationCapability("PROFESSIONAL", "usage:read")).toBe(false);
    expect(hasOrganizationCapability("ADMIN_PROFESSIONAL", "team:manage")).toBe(
      true,
    );
    expect(
      hasOrganizationCapability("ADMIN_PROFESSIONAL", "consultations:write"),
    ).toBe(true);
  });

  test("reads role and status afresh for each request", async () => {
    const f = fixture();
    const first = await f.request(`${slug}/settings`);
    expect(first.status).toBe(200);
    expect(await first.json()).toEqual({ organizationId, role: "ADMIN" });
    f.setRole("PROFESSIONAL");
    const changed = await f.request(`${slug}/settings`);
    expect(changed.status).toBe(403);
    expect(await changed.json()).toEqual({
      error: { code: "PERMISSION_DENIED" },
    });
    f.setStatus("SUSPENDED");
    const suspended = await f.request(`${slug}/settings`);
    expect(suspended.status).toBe(403);
    expect(await suspended.json()).toEqual({
      error: { code: "MEMBERSHIP_INACTIVE" },
    });
    expect(f.queries).toHaveLength(3);
    expect(f.queries[0]).toMatchObject({
      where: { userId: "user-a", organization: { slug } },
    });
  });

  test("distinguishes absent session from unknown tenant membership", async () => {
    const f = fixture();
    expect((await f.request(`${slug}/settings`, false)).status).toBe(401);
    f.setSession(false);
    expect((await f.request(`${slug}/settings`)).status).toBe(401);
    f.setSession(true);
    f.setMembership(false);
    const response = await f.request(`${slug}/settings`);
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: { code: "NOT_FOUND" } });
  });

  test("clinical actions fail closed until a resource eligibility check is supplied", async () => {
    const f = fixture();
    f.setRole("ADMIN_PROFESSIONAL");
    const denied = await f.request(`${slug}/clinical`);
    expect(denied.status).toBe(403);
    expect(await denied.json()).toEqual({
      error: { code: "PERMISSION_DENIED" },
    });
    const approved = await resolveOrganizationAccess(
      f.prisma,
      "user-a",
      slug,
      "consultations:write",
      async () => true,
    );
    expect(approved.organizationId).toBe(organizationId);
  });
});
