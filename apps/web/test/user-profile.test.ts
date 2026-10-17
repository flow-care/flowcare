import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";

let mockSessionToken: string | null = "valid-session-jwt";
let capturedRevalidatedPaths: string[] = [];

mock.module("server-only", () => ({}));
mock.module("next/headers", () => ({
  cookies: async () => ({
    get: (_name: string) =>
      mockSessionToken ? { value: mockSessionToken } : undefined,
    set: () => {},
  }),
}));
mock.module("next/cache", () => ({
  revalidatePath: (path: string, _type?: string) => {
    capturedRevalidatedPaths.push(path);
  },
}));

const {
  ALLOWED_PROFILE_PHOTO_MIME_TYPES,
  LOCKED_EMAIL_NOTICE,
  MAX_PROFILE_PHOTO_SIZE_BYTES,
  profileFormSchema,
  validateProfilePhoto,
} = await import("../lib/account-profile");

const {
  AccountApiError,
  getProfile,
  getProfilePhotoDownloadUrl,
  updateProfile,
  uploadProfilePhoto,
} = await import("../server/account");

const { updateProfileAction, uploadProfilePhotoAction } = await import(
  "../app/account/profile/actions"
);

const originalFetch = globalThis.fetch;
const originalApiUrl = process.env.API_INTERNAL_URL;

beforeEach(() => {
  process.env.API_INTERNAL_URL = "http://api.test/api";
  mockSessionToken = "valid-session-jwt";
  capturedRevalidatedPaths = [];
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  if (originalApiUrl === undefined) delete process.env.API_INTERNAL_URL;
  else process.env.API_INTERNAL_URL = originalApiUrl;
});

describe("User Profile - Photo validation & Constraints (#336)", () => {
  test("accepts valid PNG under 2MB", () => {
    const file = {
      name: "avatar.png",
      type: "image/png",
      size: 1.5 * 1024 * 1024,
    };
    const result = validateProfilePhoto(file);
    expect(result.valid).toBe(true);
    expect(result.error).toBeUndefined();
  });

  test("accepts valid JPEG under 2MB", () => {
    const file = {
      name: "foto.jpg",
      type: "image/jpeg",
      size: 500 * 1024,
    };
    const result = validateProfilePhoto(file);
    expect(result.valid).toBe(true);
  });

  test("accepts valid image with uppercase MIME type or extension", () => {
    const file = {
      name: "foto.JPG",
      type: "image/JPEG",
      size: 800 * 1024,
    };
    const result = validateProfilePhoto(file);
    expect(result.valid).toBe(true);
  });

  test("rejects unsupported MIME types (GIF, SVG, PDF)", () => {
    for (const [name, type] of [
      ["anim.gif", "image/gif"],
      ["vector.svg", "image/svg+xml"],
      ["doc.pdf", "application/pdf"],
      ["text.txt", "text/plain"],
    ]) {
      const result = validateProfilePhoto({
        name,
        type,
        size: 100 * 1024,
      });
      expect(result.valid).toBe(false);
      expect(result.error).toContain("PNG ou JPG");
    }
  });

  test("rejects files exceeding 2MB limit", () => {
    const tooLarge = {
      name: "heavy.png",
      type: "image/png",
      size: 2 * 1024 * 1024 + 1,
    };
    const result = validateProfilePhoto(tooLarge);
    expect(result.valid).toBe(false);
    expect(result.error).toContain("2MB");
  });

  test("rejects empty files (size <= 0)", () => {
    const emptyFile = {
      name: "empty.png",
      type: "image/png",
      size: 0,
    };
    const result = validateProfilePhoto(emptyFile);
    expect(result.valid).toBe(false);
    expect(result.error).toContain("vazio");
  });

  test("rejects null or missing file", () => {
    // @ts-expect-error testing null input
    const result = validateProfilePhoto(null);
    expect(result.valid).toBe(false);
    expect(result.error).toBeDefined();
  });

  test("MAX_PROFILE_PHOTO_SIZE_BYTES is exactly 2MB", () => {
    expect(MAX_PROFILE_PHOTO_SIZE_BYTES).toBe(2097152);
  });

  test("ALLOWED_PROFILE_PHOTO_MIME_TYPES includes PNG and JPEG", () => {
    expect(ALLOWED_PROFILE_PHOTO_MIME_TYPES).toContain("image/png");
    expect(ALLOWED_PROFILE_PHOTO_MIME_TYPES).toContain("image/jpeg");
  });
});

describe("User Profile - Locked Email Notice (#336)", () => {
  test("exports clear notice for locked email field", () => {
    expect(LOCKED_EMAIL_NOTICE).toBe(
      "Alterações de e-mail exigem fluxo próprio de confirmação de segurança",
    );
  });
});

describe("User Profile - Form Schema & Payload Validation (#336)", () => {
  test("validates valid profile form payload", () => {
    const parsed = profileFormSchema.safeParse({
      fullName: "Dra. Juliana Santos",
      phone: "(11) 98765-4321",
      professionalTitle: "Médica Cardiologista",
      registrationNumber: "CRM/SP 123456",
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.fullName).toBe("Dra. Juliana Santos");
      expect(parsed.data.phone).toBe("(11) 98765-4321");
      expect(parsed.data.professionalTitle).toBe("Médica Cardiologista");
      expect(parsed.data.registrationNumber).toBe("CRM/SP 123456");
    }
  });

  test("allows optional phone, professionalTitle, and registrationNumber", () => {
    const parsed = profileFormSchema.safeParse({
      fullName: "Carlos Silva",
    });
    expect(parsed.success).toBe(true);
  });

  test("rejects full name with less than 3 characters", () => {
    const parsed = profileFormSchema.safeParse({
      fullName: "Al",
    });
    expect(parsed.success).toBe(false);
  });

  test("rejects full name with more than 120 characters", () => {
    const parsed = profileFormSchema.safeParse({
      fullName: "A".repeat(121),
    });
    expect(parsed.success).toBe(false);
  });
});

describe("User Profile - Server Layer (apps/web/server/account.ts) (#336)", () => {
  test("getProfile() fetches /me/profile and returns user profile without photo", async () => {
    globalThis.fetch = mock((url: string | URL | Request) => {
      const urlStr = url.toString();
      if (urlStr.endsWith("/me/profile")) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              id: "usr_123",
              fullName: "Dr. Roberto Dias",
              email: "roberto@example.com",
              photo: null,
            }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          ),
        );
      }
      return Promise.reject(new Error(`Unexpected fetch URL: ${urlStr}`));
    }) as typeof fetch;

    const profile = await getProfile();
    expect(profile.id).toBe("usr_123");
    expect(profile.fullName).toBe("Dr. Roberto Dias");
    expect(profile.email).toBe("roberto@example.com");
    expect(profile.photo).toBeNull();
    expect(profile.photoUrl).toBeNull();
  });

  test("getProfile() resolves download URL when user has a photo", async () => {
    globalThis.fetch = mock((url: string | URL | Request) => {
      const urlStr = url.toString();
      if (urlStr.endsWith("/me/profile")) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              id: "usr_456",
              fullName: "Dra. Marina Costa",
              email: "marina@example.com",
              photo: { contentType: "image/png", sizeBytes: 1024 },
            }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          ),
        );
      }
      if (urlStr.endsWith("/me/profile/photo/download-url")) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              downloadUrl: "https://storage.test/photos/usr_456.png",
              expiresInSeconds: 900,
            }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          ),
        );
      }
      return Promise.reject(new Error(`Unexpected fetch URL: ${urlStr}`));
    }) as typeof fetch;

    const profile = await getProfile();
    expect(profile.photoUrl).toBe("https://storage.test/photos/usr_456.png");
  });

  test("getProfile() throws UNAUTHENTICATED when session token is missing", async () => {
    mockSessionToken = null;
    expect(getProfile()).rejects.toThrow(AccountApiError);
  });

  test("getProfile() throws UNAUTHENTICATED when backend returns 401", async () => {
    globalThis.fetch = mock(() =>
      Promise.resolve(new Response(null, { status: 401 })),
    ) as typeof fetch;

    await expect(getProfile()).rejects.toMatchObject({
      code: "UNAUTHENTICATED",
    });
  });

  test("getProfile() throws UNAVAILABLE on API error or connection failure", async () => {
    globalThis.fetch = mock(() =>
      Promise.reject(new Error("Connection refused")),
    ) as typeof fetch;

    await expect(getProfile()).rejects.toMatchObject({
      code: "UNAVAILABLE",
    });
  });

  test("updateProfile() sends PATCH /me/profile with payload and returns updated profile", async () => {
    let capturedMethod = "";
    let capturedBody = "";
    let capturedAuth = "";

    globalThis.fetch = mock(
      (_url: string | URL | Request, init?: RequestInit) => {
        capturedMethod = init?.method || "";
        capturedBody = (init?.body as string) || "";
        capturedAuth = (init?.headers as Record<string, string>)?.Authorization;

        return Promise.resolve(
          new Response(
            JSON.stringify({
              id: "usr_123",
              fullName: "Dr. Roberto Carlos",
              email: "roberto@example.com",
              photo: null,
            }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          ),
        );
      },
    ) as typeof fetch;

    const payload = {
      fullName: "Dr. Roberto Carlos",
      phone: "(11) 99999-8888",
      professionalTitle: "Cardiologista",
      registrationNumber: "CRM/SP 99999",
    };

    const updated = await updateProfile(payload);
    expect(capturedMethod).toBe("PATCH");
    expect(capturedAuth).toBe("Bearer valid-session-jwt");
    expect(JSON.parse(capturedBody)).toEqual(payload);
    expect(updated.fullName).toBe("Dr. Roberto Carlos");
    expect(updated.phone).toBe("(11) 99999-8888");
    expect(updated.professionalTitle).toBe("Cardiologista");
    expect(updated.registrationNumber).toBe("CRM/SP 99999");
  });

  test("updateProfile() throws VALIDATION_ERROR when backend returns 400", async () => {
    globalThis.fetch = mock(() =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            message: "Nome deve conter pelo menos 3 caracteres.",
          }),
          { status: 400, headers: { "Content-Type": "application/json" } },
        ),
      ),
    ) as typeof fetch;

    await expect(updateProfile({ fullName: "Ab" })).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
    });
  });

  test("uploadProfilePhoto() sends POST /me/profile/photo with formData and returns profile", async () => {
    let capturedPhotoMethod = "";
    let capturedAuth = "";

    globalThis.fetch = mock(
      (url: string | URL | Request, init?: RequestInit) => {
        const urlStr = url.toString();
        capturedAuth = (init?.headers as Record<string, string>)?.Authorization;

        if (urlStr.endsWith("/me/profile/photo")) {
          capturedPhotoMethod = init?.method || "";
          return Promise.resolve(
            new Response(
              JSON.stringify({
                id: "usr_123",
                fullName: "Dr. Roberto",
                email: "roberto@example.com",
                photo: { contentType: "image/png", sizeBytes: 2048 },
              }),
              { status: 200, headers: { "Content-Type": "application/json" } },
            ),
          );
        }
        if (urlStr.endsWith("/me/profile/photo/download-url")) {
          return Promise.resolve(
            new Response(
              JSON.stringify({
                downloadUrl: "https://storage.test/new-photo.png",
                expiresInSeconds: 900,
              }),
              { status: 200, headers: { "Content-Type": "application/json" } },
            ),
          );
        }
        return Promise.reject(new Error(`Unexpected URL: ${urlStr}`));
      },
    ) as typeof fetch;

    const formData = new FormData();
    formData.append(
      "file",
      new File([new Uint8Array([1, 2, 3])], "photo.png", {
        type: "image/png",
      }),
    );

    const result = await uploadProfilePhoto(formData);
    expect(capturedPhotoMethod).toBe("POST");
    expect(capturedAuth).toBe("Bearer valid-session-jwt");
    expect(result.photo?.contentType).toBe("image/png");
    expect(result.photoUrl).toBe("https://storage.test/new-photo.png");
  });

  test("uploadProfilePhoto() throws PAYLOAD_TOO_LARGE on 413 response", async () => {
    globalThis.fetch = mock(() =>
      Promise.resolve(new Response(null, { status: 413 })),
    ) as typeof fetch;

    const formData = new FormData();
    formData.append(
      "file",
      new File(["x"], "heavy.png", { type: "image/png" }),
    );

    await expect(uploadProfilePhoto(formData)).rejects.toMatchObject({
      code: "PAYLOAD_TOO_LARGE",
    });
  });

  test("uploadProfilePhoto() throws STORAGE_UNAVAILABLE on 503 response", async () => {
    globalThis.fetch = mock(() =>
      Promise.resolve(new Response(null, { status: 503 })),
    ) as typeof fetch;

    const formData = new FormData();
    formData.append(
      "file",
      new File(["x"], "photo.png", { type: "image/png" }),
    );

    await expect(uploadProfilePhoto(formData)).rejects.toMatchObject({
      code: "STORAGE_UNAVAILABLE",
    });
  });

  test("getProfilePhotoDownloadUrl() returns null on 404 (no photo)", async () => {
    globalThis.fetch = mock(() =>
      Promise.resolve(new Response(null, { status: 404 })),
    ) as typeof fetch;

    const result = await getProfilePhotoDownloadUrl();
    expect(result).toBeNull();
  });
});

describe("User Profile - Server Actions (#336)", () => {
  test("updateProfileAction() validates name, calls updateProfile and revalidates paths", async () => {
    globalThis.fetch = mock(() =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            id: "usr_123",
            fullName: "Fernanda Montenegro",
            email: "fernanda@example.com",
            photo: null,
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      ),
    ) as typeof fetch;

    const result = await updateProfileAction({
      fullName: "Fernanda Montenegro",
      phone: "(11) 91234-5678",
    });

    expect(result.ok).toBe(true);
    expect(capturedRevalidatedPaths).toContain("/account/profile");
    expect(capturedRevalidatedPaths).toContain("/app");
    expect(capturedRevalidatedPaths).toContain("/");
  });

  test("updateProfileAction() returns field error without calling fetch when name is too short", async () => {
    const fetchMock = mock(() => Promise.resolve(new Response(null)));
    globalThis.fetch = fetchMock as typeof fetch;

    const result = await updateProfileAction({
      fullName: "Jo",
    });

    expect(result.ok).toBe(false);
    expect(result.fieldErrors?.fullName).toBeDefined();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test("uploadProfilePhotoAction() rejects invalid file before calling API", async () => {
    const fetchMock = mock(() => Promise.resolve(new Response(null)));
    globalThis.fetch = fetchMock as typeof fetch;

    const formData = new FormData();
    formData.append(
      "file",
      new File(["content"], "document.pdf", { type: "application/pdf" }),
    );

    const result = await uploadProfilePhotoAction(formData);
    expect(result.ok).toBe(false);
    expect(result.message).toContain("PNG ou JPG");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test("uploadProfilePhotoAction() uploads valid photo and revalidates paths", async () => {
    globalThis.fetch = mock((url: string | URL | Request) => {
      const urlStr = url.toString();
      if (urlStr.endsWith("/me/profile/photo")) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              id: "usr_123",
              fullName: "Dr. Paulo",
              email: "paulo@example.com",
              photo: { contentType: "image/png", sizeBytes: 100 },
            }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          ),
        );
      }
      if (urlStr.endsWith("/me/profile/photo/download-url")) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              downloadUrl: "https://storage.test/paulo.png",
              expiresInSeconds: 900,
            }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          ),
        );
      }
      return Promise.reject(new Error(`Unexpected URL: ${urlStr}`));
    }) as typeof fetch;

    const formData = new FormData();
    formData.append(
      "file",
      new File([new Uint8Array([137, 80, 78, 71])], "avatar.png", {
        type: "image/png",
      }),
    );

    const result = await uploadProfilePhotoAction(formData);
    expect(result.ok).toBe(true);
    expect(capturedRevalidatedPaths).toContain("/account/profile");
    expect(capturedRevalidatedPaths).toContain("/app");
    expect(capturedRevalidatedPaths).toContain("/");
  });
});
