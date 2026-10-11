import { describe, expect, mock, test } from "bun:test";
import { createApp } from "../src/app";
import type { Env } from "../src/config/env";
import type { Prisma, PrismaClient } from "../src/generated/prisma/client";
import type {
  ProfilePhotoUrlResponse,
  ProfileResponse,
} from "../src/modules/account/model";
import { PROFILE_PHOTO_MAX_BYTES } from "../src/services/profile-photo-store";
import { signSessionToken } from "../src/services/session-token";

const env: Env = {
  port: 0,
  nodeEnv: "test",
  version: "test",
  jwtSecret: "profile-test-secret",
  databaseUrl: "postgresql://unused",
  corsOrigin: "http://localhost:3000",
  trustProxy: false,
  wahaBaseUrl: "http://127.0.0.1:1",
  wahaApiKey: null,
  webAppUrl: "http://localhost:3000",
  sesRegion: null,
  mailProvider: "disabled",
  mailFrom: null,
};

function setup() {
  const users = new Map([
    [
      "user-a",
      {
        id: "user-a",
        fullName: "Ana Silva",
        email: "ana@example.com",
        profilePhotoKey: null as string | null,
        profilePhotoContentType: null as string | null,
        profilePhotoSizeBytes: null as number | null,
      },
    ],
    [
      "user-b",
      {
        id: "user-b",
        fullName: "Bia Souza",
        email: "bia@example.com",
        profilePhotoKey: null as string | null,
        profilePhotoContentType: null as string | null,
        profilePhotoSizeBytes: null as number | null,
      },
    ],
  ]);
  const updateMany = mock(
    async ({ where, data }: Prisma.UserUpdateManyArgs) => {
      const user = users.get(where?.id as string);
      if (!user) return { count: 0 };
      if (typeof data.fullName === "string") user.fullName = data.fullName;
      return { count: 1 };
    },
  );
  const put = mock(
    async (_key: string, _body: Uint8Array, _type: string) => {},
  );
  const del = mock(async (_key: string) => {});
  const prisma = {
    session: {
      findFirst: async () => ({ id: "session-a", lastActiveAt: new Date() }),
    },
    user: {
      findUnique: async ({ where }: Prisma.UserFindUniqueArgs) =>
        users.get(where.id as string) ?? null,
      updateMany,
      update: async ({ where, data }: Prisma.UserUpdateArgs) => {
        const user = users.get(where.id as string);
        if (!user) throw new Error("Missing user");
        user.profilePhotoKey = data.profilePhotoKey as string;
        user.profilePhotoContentType = data.profilePhotoContentType as string;
        user.profilePhotoSizeBytes = data.profilePhotoSizeBytes as number;
        return user;
      },
    },
  } as unknown as PrismaClient;
  const app = createApp(env, {
    prisma,
    mailer: { send: async () => {} },
    profilePhotoStore: {
      put,
      downloadUrl: async () => "https://private.example/signed",
      delete: del,
    },
  });
  const token = signSessionToken(
    { sid: "session-a", sub: "user-a" },
    env.jwtSecret,
    3600,
  );
  const bearer = { authorization: `Bearer ${token}` };
  const request = (path: string, init: RequestInit = {}) =>
    app.handle(new Request(`http://localhost/api${path}`, init));
  return { request, bearer, users, updateMany, put, del };
}

describe("#331 personal profile", () => {
  test("reads and updates only the signed-in account without orgSlug", async () => {
    const { request, bearer, users, updateMany } = setup();
    const before = await request("/me/profile", { headers: bearer });
    expect(before.status).toBe(200);
    expect(await before.json()).toEqual({
      id: "user-a",
      fullName: "Ana Silva",
      email: "ana@example.com",
      photo: null,
    });
    const response = await request("/me/profile", {
      method: "PATCH",
      headers: { ...bearer, "content-type": "application/json" },
      body: JSON.stringify({ fullName: "  Ana Oliveira  " }),
    });
    expect(response.status).toBe(200);
    const updated = (await response.json()) as ProfileResponse;
    expect(updated.fullName).toBe("Ana Oliveira");
    expect(updateMany.mock.calls[0]?.[0].where?.id).toBe("user-a");
    expect(users.get("user-b")?.fullName).toBe("Bia Souza");
  });

  test("rejects unauthenticated, invalid name, email and foreign account fields", async () => {
    const { request, bearer, updateMany } = setup();
    expect((await request("/me/profile")).status).toBe(401);
    for (const body of [
      { fullName: " x " },
      { fullName: "Ana", email: "other@example.com" },
      { fullName: "Ana", userId: "user-b" },
      { fullName: "Ana", id: "user-b" },
    ]) {
      const res = await request("/me/profile", {
        method: "PATCH",
        headers: { ...bearer, "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      expect(res.status).toBe(400);
    }
    expect(updateMany).not.toHaveBeenCalled();
  });

  test("stores a private photo, replaces previous photo, and permits a signed download only to its owner", async () => {
    const { request, bearer, put, del, users } = setup();
    expect(
      (await request("/me/profile/photo/download-url", { headers: bearer }))
        .status,
    ).toBe(404);
    const form = new FormData();
    const png = new Uint8Array([
      137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82, 0, 0, 0, 1,
      0, 0, 0, 1,
    ]);
    form.append("file", new File([png], "photo.png", { type: "image/png" }));
    const res = await request("/me/profile/photo", {
      method: "POST",
      headers: bearer,
      body: form,
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as ProfileResponse;
    expect(body.photo).toEqual({
      contentType: "image/png",
      sizeBytes: png.length,
    });
    expect(put).toHaveBeenCalledTimes(1);
    const firstKey = put.mock.calls[0]?.[0];
    expect(firstKey).toMatch(/^users\/user-a\/profile\//);
    expect(users.get("user-b")?.profilePhotoKey).toBeNull();

    const jpegForm = new FormData();
    const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0xff, 0xd9]);
    jpegForm.append(
      "file",
      new File([jpeg], "photo.jpg", { type: "image/jpeg" }),
    );
    const replaceRes = await request("/me/profile/photo", {
      method: "POST",
      headers: bearer,
      body: jpegForm,
    });
    expect(replaceRes.status).toBe(200);
    const replacedBody = (await replaceRes.json()) as ProfileResponse;
    expect(replacedBody.photo).toEqual({
      contentType: "image/jpeg",
      sizeBytes: jpeg.length,
    });
    expect(del).toHaveBeenCalledWith(firstKey);

    const url = await request("/me/profile/photo/download-url", {
      headers: bearer,
    });
    expect(url.status).toBe(200);
    const urlBody = (await url.json()) as ProfilePhotoUrlResponse;
    expect(urlBody.expiresInSeconds).toBe(900);
    expect((await request("/me/profile/photo/download-url")).status).toBe(401);
  });

  test("rejects forged image and oversized upload before storage", async () => {
    const { request, bearer, put } = setup();
    const png = new Uint8Array([
      137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82, 0, 0, 0, 1,
      0, 0, 0, 1,
    ]);
    const cases: Array<{ file: File; expectedStatus: number }> = [
      {
        file: new File([], "empty.png", { type: "image/png" }),
        expectedStatus: 400,
      },
      {
        file: new File(["not a PNG"], "fake.png", { type: "image/png" }),
        expectedStatus: 400,
      },
      {
        file: new File([png], "spoofed.jpg", { type: "image/jpeg" }),
        expectedStatus: 400,
      },
      {
        file: new File(
          [new Uint8Array(PROFILE_PHOTO_MAX_BYTES + 1)],
          "huge.png",
          { type: "image/png" },
        ),
        expectedStatus: 413,
      },
    ];
    for (const { file, expectedStatus } of cases) {
      const form = new FormData();
      form.append("file", file);
      const res = await request("/me/profile/photo", {
        method: "POST",
        headers: bearer,
        body: form,
      });
      expect(res.status).toBe(expectedStatus);
    }
    expect(put).not.toHaveBeenCalled();
  });
});
