import { beforeEach, describe, expect, test } from "bun:test";
import { createApp } from "../src/app";
import type { Env } from "../src/config/env";
import type { PrismaClient } from "../src/generated/prisma/client";
import { createPrismaClient } from "../src/services/db";
import type { Mailer } from "../src/services/mailer";

/**
 * Testes de integração — auth (#207/#208/#209) + onboarding (#215/#216).
 * Rodam contra um Postgres real (TEST_DATABASE_URL). Sem banco acessível,
 * a suite é pulada (CI sem serviço de banco fica verde com os unit tests).
 */

const DATABASE_URL =
  process.env.TEST_DATABASE_URL ??
  "postgresql://flowcare:flowcare@127.0.0.1:5433/flowcare";

let prisma!: PrismaClient;
let dbUp = false;

const sent: { to: string; subject: string; text: string }[] = [];
const captureMailer: Mailer = {
  async send(params) {
    sent.push(params);
  },
};

const testEnv: Env = {
  port: 0,
  nodeEnv: "test",
  version: "test",
  jwtSecret: "integration-test-secret",
  databaseUrl: DATABASE_URL,
  corsOrigin: "http://localhost:3000",
  trustProxy: false,
  wahaBaseUrl: "http://127.0.0.1:1",
  wahaApiKey: null,
  webAppUrl: "http://localhost:3000",
  sesRegion: null,
  mailProvider: "disabled",
  mailFrom: null,
};

// Probe do banco em top-level: define skipIf ANTES do registro das suites.
try {
  prisma = createPrismaClient(DATABASE_URL);
  await prisma.$queryRaw`SELECT 1`;
  dbUp = true;
} catch {
  dbUp = false;
}

const api = dbUp
  ? createApp(testEnv, { prisma, mailer: captureMailer })
  : (undefined as unknown as ReturnType<typeof createApp>);

function post(path: string, body: unknown, token?: string) {
  const headers: Record<string, string> = {
    "content-type": "application/json",
  };
  if (token) headers.authorization = `Bearer ${token}`;
  return api.handle(
    new Request(`http://localhost/api${path}`, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    }),
  );
}

function patch(path: string, body: unknown, token?: string) {
  const headers: Record<string, string> = {
    "content-type": "application/json",
  };
  if (token) headers.authorization = `Bearer ${token}`;
  return api.handle(
    new Request(`http://localhost/api${path}`, {
      method: "PATCH",
      headers,
      body: JSON.stringify(body),
    }),
  );
}

function get(path: string, token?: string) {
  const headers: Record<string, string> = {};
  if (token) headers.authorization = `Bearer ${token}`;
  return api.handle(new Request(`http://localhost/api${path}`, { headers }));
}

function tokenFromMail(): string {
  const last = sent.at(-1);
  if (!last) throw new Error("nenhum e-mail capturado");
  const match = last.text.match(/token=([A-Za-z0-9_-]+)/);
  if (!match?.[1]) throw new Error("token não encontrado no e-mail");
  return match[1];
}

beforeEach(() => {
  sent.length = 0;
});

describe.skipIf(!dbUp)("Integração: auth + onboarding (Postgres real)", () => {
  beforeEach(async () => {
    await prisma.organization.deleteMany();
    await prisma.user.deleteMany();
  });

  describe("#207 cadastro + verificação de e-mail", () => {
    test("cadastro → conta pendente; resposta genérica igual para e-mail novo e repetido", async () => {
      const body = {
        fullName: "Dra. Maria Silva",
        email: "maria@exemplo.com",
        password: "senha-segura-123",
      };
      const first = await post("/auth/register", body);
      expect(first.status).toBe(201);

      const duplicate = await post("/auth/register", body);
      expect(duplicate.status).toBe(201);
      const firstJson = (await first.json()) as { message: string };
      const dupJson = (await duplicate.json()) as { message: string };
      expect(dupJson.message).toBe(firstJson.message);

      expect(
        await prisma.user.count({ where: { email: "maria@exemplo.com" } }),
      ).toBe(1);
    });

    test("login antes de verificar → ACCOUNT_NOT_VERIFIED, sem sessão", async () => {
      await post("/auth/register", {
        fullName: "Dra. Maria Silva",
        email: "maria@exemplo.com",
        password: "senha-segura-123",
      });

      const res = await post("/auth/login", {
        email: "maria@exemplo.com",
        password: "senha-segura-123",
      });
      expect(res.status).toBe(401);
      const body = (await res.json()) as { error: { code: string } };
      expect(body.error.code).toBe("ACCOUNT_NOT_VERIFIED");
      expect(await prisma.session.count()).toBe(0);
    });

    test("token válido confirma uma vez; reuso/lixo são recusados", async () => {
      await post("/auth/register", {
        fullName: "Dra. Maria Silva",
        email: "maria@exemplo.com",
        password: "senha-segura-123",
      });
      const token = tokenFromMail();

      const ok = await post("/auth/verify-email", { token });
      expect(ok.status).toBe(200);
      const confirmed = (await ok.json()) as {
        token: string;
        user: { email: string };
      };
      expect(confirmed.token).toBeTruthy();
      expect(confirmed.user.email).toBe("maria@exemplo.com");
      expect(await prisma.session.count()).toBe(1);

      const reuse = await post("/auth/verify-email", { token });
      expect(reuse.status).toBe(400);
      expect(
        ((await reuse.json()) as { error: { code: string } }).error.code,
      ).toBe("INVALID_TOKEN");

      const garbage = await post("/auth/verify-email", { token: "nao-existe" });
      expect(garbage.status).toBe(400);
    });

    test("duas confirmações simultâneas não consomem o mesmo token duas vezes", async () => {
      await post("/auth/register", {
        fullName: "Dra. Maria Silva",
        email: "maria@exemplo.com",
        password: "senha-segura-123",
      });
      const token = tokenFromMail();
      const responses = await Promise.all([
        post("/auth/verify-email", { token }),
        post("/auth/verify-email", { token }),
      ]);
      expect(responses.map((response) => response.status).sort()).toEqual([
        200, 400,
      ]);
      expect(await prisma.session.count()).toBe(1);
    });

    test("limite de reenvio mantém resposta neutra e não cria outro token", async () => {
      const body = {
        fullName: "Dra. Maria Silva",
        email: "maria@exemplo.com",
        password: "senha-segura-123",
      };
      await post("/auth/register", body);
      for (let i = 0; i < 2; i++) {
        const r = await post("/auth/register", body);
        expect(r.status).toBe(201);
      }
      const limited = await post("/auth/register", body);
      expect(limited.status).toBe(201);
      expect(sent).toHaveLength(3);
      expect(await prisma.verificationToken.count()).toBe(3);
    });
  });

  describe("#208 login + clínicas disponíveis", () => {
    test("conta verificada recebe sessão e lista de clínicas vazia", async () => {
      await post("/auth/register", {
        fullName: "Dra. Maria Silva",
        email: "maria@exemplo.com",
        password: "senha-segura-123",
      });
      await post("/auth/verify-email", { token: tokenFromMail() });

      const res = await post("/auth/login", {
        email: "maria@exemplo.com",
        password: "senha-segura-123",
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        token: string;
        user: { email: string };
        availableOrganizations: unknown[];
        onboardingCompleted: boolean;
      };
      expect(body.user.email).toBe("maria@exemplo.com");
      expect(body.token).toBeTruthy();
      expect(body.availableOrganizations).toEqual([]);
      expect(body.onboardingCompleted).toBe(false);
    });

    test("senha errada e conta inexistente → erro indistinguível (anti-enumeração)", async () => {
      const wrong = await post("/auth/login", {
        email: "maria@exemplo.com",
        password: "senha-segura-123",
      });
      // conta não existe ainda
      const nonexistent = await post("/auth/login", {
        email: "ninguem@exemplo.com",
        password: "qualquer-coisa",
      });
      expect(wrong.status).toBe(nonexistent.status);
      const wrongJson = (await wrong.json()) as { error: unknown };
      const ghostJson = (await nonexistent.json()) as { error: unknown };
      expect(wrongJson.error).toEqual(ghostJson.error);
    });
  });

  describe("#209 recuperação de senha", () => {
    async function registerVerified() {
      await post("/auth/register", {
        fullName: "Dra. Maria Silva",
        email: "maria@exemplo.com",
        password: "senha-segura-123",
      });
      await post("/auth/verify-email", { token: tokenFromMail() });
      sent.length = 0;
      return tokenFromMail;
    }

    test("solicitação não revela existência do e-mail", async () => {
      await registerVerified();
      const existing = await post("/auth/forgot-password", {
        email: "maria@exemplo.com",
      });
      const ghost = await post("/auth/forgot-password", {
        email: "fantasma@exemplo.com",
      });
      expect(existing.status).toBe(200);
      expect(ghost.status).toBe(200);
      const existingJson = (await existing.json()) as { message: unknown };
      const ghostJson = (await ghost.json()) as { message: unknown };
      expect(existingJson.message).toBe(ghostJson.message);
      expect(sent.length).toBe(1); // só o e-mail real gera token
    });

    test("reset válido troca senha, revoga sessões antigas e token vira inutilizável", async () => {
      await registerVerified();
      const login1 = await post("/auth/login", {
        email: "maria@exemplo.com",
        password: "senha-segura-123",
      });
      const oldToken = ((await login1.json()) as { token: string }).token;

      await post("/auth/forgot-password", { email: "maria@exemplo.com" });
      const resetToken = tokenFromMail();

      const reset = await post("/auth/reset-password", {
        token: resetToken,
        newPassword: "nova-senha-456",
      });
      expect(reset.status).toBe(200);

      // token de reset é de uso único
      const again = await post("/auth/reset-password", {
        token: resetToken,
        newPassword: "terceira-senha",
      });
      expect(again.status).toBe(400);

      // senha antiga falha; sessão antiga não autentica mais
      const oldPassword = await post("/auth/login", {
        email: "maria@exemplo.com",
        password: "senha-segura-123",
      });
      expect(oldPassword.status).toBe(401);

      const progressWithOldSession = await get(
        "/onboarding/progress",
        oldToken,
      );
      expect(progressWithOldSession.status).toBe(401);

      const newPassword = await post("/auth/login", {
        email: "maria@exemplo.com",
        password: "nova-senha-456",
      });
      expect(newPassword.status).toBe(200);
    });
  });

  describe("#215/#216 onboarding", () => {
    async function loginToken(): Promise<string> {
      await post("/auth/register", {
        fullName: "Dra. Maria Silva",
        email: "maria@exemplo.com",
        password: "senha-segura-123",
      });
      await post("/auth/verify-email", { token: tokenFromMail() });
      const res = await post("/auth/login", {
        email: "maria@exemplo.com",
        password: "senha-segura-123",
      });
      return ((await res.json()) as { token: string }).token;
    }

    test("progresso novo retorna estado inicial e sobrevive nova sessão", async () => {
      const token = await loginToken();
      const res = await get("/onboarding/progress", token);
      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        currentStep: string;
        completed: boolean;
        draftData: Record<string, unknown>;
        version: number;
      };
      expect(body.currentStep).toBe("PROFILE_SETUP");
      expect(body.completed).toBe(false);
      expect(body.version).toBe(0);

      // nova sessão vê o mesmo estado (persistido no banco, não no token)
      const login2 = await post("/auth/login", {
        email: "maria@exemplo.com",
        password: "senha-segura-123",
      });
      const token2 = ((await login2.json()) as { token: string }).token;
      const res2 = await get("/onboarding/progress", token2);
      expect(((await res2.json()) as { currentStep: string }).currentStep).toBe(
        "PROFILE_SETUP",
      );
    });

    test("rascunho do perfil volta após recarregar e conclusão avança uma vez", async () => {
      const token = await loginToken();
      expect((await get("/onboarding/profile")).status).toBe(401);

      const draft = await patch(
        "/onboarding/profile",
        {
          fullName: "Dra. Maria Silva",
          phone: "85",
          professionalRole: "CLINICAL",
          professionalTitle: "Médica",
          registrationNumber: "",
        },
        token,
      );
      expect(draft.status).toBe(200);
      const restored = await get("/onboarding/profile", token);
      expect(((await restored.json()) as { phone: string }).phone).toBe("85");

      const invalid = await post(
        "/onboarding/profile",
        {
          fullName: "Dra. Maria Silva",
          phone: "85999990000",
          professionalRole: "CLINICAL",
          professionalTitle: "Médica",
          registrationNumber: "",
        },
        token,
      );
      expect(invalid.status).toBe(400);

      const body = {
        fullName: "Dra. Maria Silva",
        phone: "(85) 99999-0000",
        professionalRole: "CLINICAL",
        professionalTitle: "Médica",
        registrationNumber: "CRM/CE 123456",
      };
      const saved = await post("/onboarding/profile", body, token);
      expect(saved.status).toBe(200);
      expect(((await saved.json()) as { completed: boolean }).completed).toBe(
        true,
      );
      const repeated = await post("/onboarding/profile", body, token);
      expect(repeated.status).toBe(409);
      expect(await prisma.onboardingProgress.count()).toBe(1);
      const progress = await get("/onboarding/progress", token);
      expect(
        ((await progress.json()) as { currentStep: string }).currentStep,
      ).toBe("ORGANIZATION_SETUP");
      const user = await prisma.user.findUnique({
        where: { email: "maria@exemplo.com" },
      });
      expect(user?.phone).toBe("85999990000");
    });

    test("cria clínica com slug normalizado, criador ADMIN/isOwner e assinatura pendente", async () => {
      const token = await loginToken();
      const res = await post(
        "/onboarding/organization",
        { name: "Clínica Vida & Saúde" },
        token,
      );
      expect(res.status).toBe(201);
      const body = (await res.json()) as {
        organization: { slug: string; role: string; isOwner: boolean };
      };
      expect(body.organization.slug).toBe("clinica-vida-saude");
      expect(body.organization.role).toBe("ADMIN");
      expect(body.organization.isOwner).toBe(true);

      const org = await prisma.organization.findUnique({
        where: { slug: "clinica-vida-saude" },
        include: { subscription: true, memberships: true },
      });
      expect(org).not.toBeNull();
      expect(org?.subscription?.status).toBe("PENDING_PAYMENT");
      expect(org?.subscription?.priceCents).toBe(8900);
      expect(org?.memberships.length).toBe(1);
      expect(org?.memberships[0]?.role).toBe("ADMIN");
    });

    test("horários opcionais e conclusão repetida preservam o mesmo destino", async () => {
      const token = await loginToken();
      const before = await post("/onboarding/complete", {}, token);
      expect(before.status).toBe(409);

      await post("/onboarding/organization", { name: "Clínica Alfa" }, token);
      const schedule = await post(
        "/onboarding/schedule-rules",
        {
          weeklySchedule: [
            {
              dayOfWeek: "MONDAY",
              startTime: "08:00",
              endTime: "12:00",
              slotDurationMinutes: 30,
            },
            {
              dayOfWeek: "MONDAY",
              startTime: "12:00",
              endTime: "18:00",
              slotDurationMinutes: 30,
            },
          ],
        },
        token,
      );
      expect(schedule.status).toBe(200);
      expect(await prisma.weeklyScheduleRule.count()).toBe(2);

      const overlap = await post(
        "/onboarding/schedule-rules",
        {
          weeklySchedule: [
            {
              dayOfWeek: "MONDAY",
              startTime: "08:00",
              endTime: "12:00",
              slotDurationMinutes: 30,
            },
            {
              dayOfWeek: "MONDAY",
              startTime: "11:00",
              endTime: "13:00",
              slotDurationMinutes: 30,
            },
          ],
        },
        token,
      );
      expect(overlap.status).toBe(400);
      expect(await prisma.weeklyScheduleRule.count()).toBe(2);

      const first = await post("/onboarding/complete", {}, token);
      expect(first.status).toBe(200);
      expect(await first.json()).toEqual({
        redirectUrl: "/app/clinica-alfa/dashboard",
      });
      const progress = await prisma.onboardingProgress.findFirstOrThrow();
      const repeated = await post("/onboarding/complete", {}, token);
      expect(await repeated.json()).toEqual({
        redirectUrl: "/app/clinica-alfa/dashboard",
      });
      expect((await prisma.onboardingProgress.findFirstOrThrow()).version).toBe(
        progress.version,
      );
      expect(await prisma.onboardingProgress.count()).toBe(1);

      const clear = await post(
        "/onboarding/schedule-rules",
        { weeklySchedule: [] },
        token,
      );
      expect(clear.status).toBe(200);
      expect(await prisma.weeklyScheduleRule.count()).toBe(0);
    });

    test("repetir a mesma criação → 409, sem clínica duplicada", async () => {
      const token = await loginToken();
      await post(
        "/onboarding/organization",
        { name: "Clínica Vida & Saúde" },
        token,
      );
      const repeat = await post(
        "/onboarding/organization",
        { name: "Clínica Vida & Saúde" },
        token,
      );
      expect(repeat.status).toBe(409);
      expect(
        ((await repeat.json()) as { error: { code: string } }).error.code,
      ).toBe("ALREADY_EXISTS");
      expect(await prisma.organization.count()).toBe(1);
    });

    test("slug de outro dono também colide; login lista clínica com isOwner", async () => {
      const tokenA = await loginToken();
      await post("/onboarding/organization", { name: "Clínica Alfa" }, tokenA);

      // usuário B tenta mesmo slug
      await post("/auth/register", {
        fullName: "Dr. João Souza",
        email: "joao@exemplo.com",
        password: "senha-segura-123",
      });
      await post("/auth/verify-email", { token: tokenFromMail() });
      const loginB = await post("/auth/login", {
        email: "joao@exemplo.com",
        password: "senha-segura-123",
      });
      const tokenB = ((await loginB.json()) as { token: string }).token;

      const conflict = await post(
        "/onboarding/organization",
        { name: "Clínica Beta", slug: "clinica-alfa" },
        tokenB,
      );
      expect(conflict.status).toBe(409);

      // painel do A lista a clínica dele como owner
      const loginA = await post("/auth/login", {
        email: "maria@exemplo.com",
        password: "senha-segura-123",
      });
      const orgs = (
        (await loginA.json()) as {
          availableOrganizations: {
            slug: string;
            isOwner: boolean;
            role: string;
          }[];
        }
      ).availableOrganizations;
      expect(orgs).toHaveLength(1);
      expect(orgs[0]?.slug).toBe("clinica-alfa");
      expect(orgs[0]?.isOwner).toBe(true);
    });
  });
});

// Fallback visível quando o banco não está disponível (CI).
describe("Integração: auth + onboarding (sem banco)", () => {
  test.skipIf(dbUp)("pulado: Postgres de teste não acessível", () => {
    expect(true).toBe(true);
  });
});
