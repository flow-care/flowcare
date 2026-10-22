import { createHash } from "node:crypto";
import type { Prisma, PrismaClient } from "../../generated/prisma/client";
import { ApiError } from "../../lib/api-error";
import { CLINICAL_ROLES } from "../../lib/roles";
import { normalizePatientName } from "../patients/service";
import type {
  AnamnesisStatus,
  ApproveConsultationBody,
  ApproveConsultationResponse,
  ConsultationDetailResponse,
  ConsultationListItem,
  ConsultationStatus,
  ListConsultationsQuery,
  ListConsultationsResponse,
  SaveConsultationDraftBody,
  StartConsultationBody,
} from "./model";

function dateParts(date: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  return Object.fromEntries(parts.map((part) => [part.type, part.value]));
}

function zonedDateTimeToUtc(date: string, time: string, timeZone: string) {
  const [year, month, day] = date.split("-").map(Number) as [
    number,
    number,
    number,
  ];
  const [hour, minute] = time.split(":").map(Number) as [number, number];
  const target = Date.UTC(year, month - 1, day, hour, minute);
  let candidate = target;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const parts = dateParts(new Date(candidate), timeZone);
    const represented = Date.UTC(
      Number(parts.year),
      Number(parts.month) - 1,
      Number(parts.day),
      Number(parts.hour),
      Number(parts.minute),
      Number(parts.second),
    );
    candidate += target - represented;
  }
  const result = new Date(candidate);
  const parts = dateParts(result, timeZone);
  if (
    parts.year !== String(year).padStart(4, "0") ||
    parts.month !== String(month).padStart(2, "0") ||
    parts.day !== String(day).padStart(2, "0") ||
    parts.hour !== String(hour).padStart(2, "0") ||
    parts.minute !== String(minute).padStart(2, "0")
  ) {
    throw new ApiError(
      "VALIDATION_ERROR",
      400,
      "Data ou horário inválido no fuso da clínica.",
    );
  }
  return result;
}

function localDateTime(date: Date, timeZone: string) {
  const parts = dateParts(date, timeZone);
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}`;
}

function parseDate(date: string, field: "startDate" | "endDate") {
  const parsed = new Date(`${date}T00:00:00Z`);
  if (
    Number.isNaN(parsed.getTime()) ||
    parsed.toISOString().slice(0, 10) !== date
  ) {
    throw new ApiError("VALIDATION_ERROR", 400, "Data inválida.", { field });
  }
  return parsed;
}

function addDays(date: string, days: number, field: "startDate" | "endDate") {
  const parsed = parseDate(date, field);
  parsed.setUTCDate(parsed.getUTCDate() + days);
  return parsed.toISOString().slice(0, 10);
}

export class ConsultationsService {
  constructor(private readonly prisma: PrismaClient) {}

  private async resolveTimeZone(organizationId: string): Promise<string> {
    const organization = await this.prisma.organization?.findUnique?.({
      where: { id: organizationId },
      select: { timezone: true },
    });
    const timeZone = organization?.timezone ?? "America/Sao_Paulo";
    try {
      new Intl.DateTimeFormat("en", { timeZone });
    } catch {
      throw new ApiError("INTERNAL", 500, "Fuso horário da clínica inválido.");
    }
    return timeZone;
  }

  async list(
    organizationId: string,
    query: ListConsultationsQuery = {},
  ): Promise<ListConsultationsResponse> {
    const limit = query.limit ?? 20;
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
      throw new ApiError(
        "VALIDATION_ERROR",
        400,
        "Limite de página inválido.",
        { field: "limit" },
      );
    }

    const page = query.page ?? 1;
    if (!Number.isInteger(page) || page < 1) {
      throw new ApiError("VALIDATION_ERROR", 400, "Página inválida.", {
        field: "page",
      });
    }

    const timeZone = await this.resolveTimeZone(organizationId);

    const startParsed = query.startDate
      ? parseDate(query.startDate, "startDate")
      : null;
    const endParsed = query.endDate
      ? parseDate(query.endDate, "endDate")
      : null;

    if (
      startParsed &&
      endParsed &&
      startParsed.getTime() > endParsed.getTime()
    ) {
      throw new ApiError(
        "VALIDATION_ERROR",
        400,
        "A data inicial não pode ser posterior à data final.",
        { field: "startDate" },
      );
    }

    const startAt = query.startDate
      ? zonedDateTimeToUtc(query.startDate, "00:00", timeZone)
      : undefined;
    const endAt = query.endDate
      ? zonedDateTimeToUtc(
          addDays(query.endDate, 1, "endDate"),
          "00:00",
          timeZone,
        )
      : undefined;

    if (query.cursor) {
      const cursorRecord = await this.prisma.consultation.findFirst({
        where: { id: query.cursor, organizationId },
        select: { id: true },
      });
      if (!cursorRecord) {
        throw new ApiError(
          "VALIDATION_ERROR",
          400,
          "Cursor de paginação inválido.",
          { field: "cursor" },
        );
      }
    }

    const rawSearch = (query.search ?? query.q ?? "").trim();
    let patientFilter: Prisma.PatientWhereInput | undefined;
    if (rawSearch.length > 0) {
      const collapsedSearch = rawSearch.replace(/\s+/g, " ");
      const normalizedSearch = normalizePatientName(collapsedSearch);
      patientFilter = {
        OR: [
          ...(normalizedSearch.length > 0
            ? [
                {
                  normalizedName: {
                    contains: normalizedSearch,
                    mode: "insensitive" as const,
                  },
                },
              ]
            : []),
          {
            fullName: {
              contains: collapsedSearch,
              mode: "insensitive" as const,
            },
          },
        ],
      };
    }

    const where: Prisma.ConsultationWhereInput = {
      organizationId,
      ...(startAt || endAt
        ? {
            scheduledAt: {
              ...(startAt ? { gte: startAt } : {}),
              ...(endAt ? { lt: endAt } : {}),
            },
          }
        : {}),
      ...(query.professionalId ? { professionalId: query.professionalId } : {}),
      ...(query.patientId ? { patientId: query.patientId } : {}),
      ...(query.status ? { status: query.status } : {}),
      ...(query.anamnesisStatus
        ? { anamnesisStatus: query.anamnesisStatus }
        : {}),
      ...(patientFilter ? { patient: patientFilter } : {}),
    };

    const [rows, totalCount] = await Promise.all([
      this.prisma.consultation.findMany({
        where,
        orderBy: [{ scheduledAt: "desc" }, { id: "desc" }],
        take: limit + 1,
        ...(query.cursor
          ? { cursor: { id: query.cursor }, skip: 1 }
          : page > 1
            ? { skip: (page - 1) * limit }
            : {}),
        select: {
          id: true,
          appointmentId: true,
          patientId: true,
          professionalId: true,
          scheduledAt: true,
          startedAt: true,
          completedAt: true,
          status: true,
          anamnesisStatus: true,
          version: true,
          createdAt: true,
          updatedAt: true,
          patient: {
            select: {
              id: true,
              fullName: true,
            },
          },
          professional: {
            select: {
              id: true,
              fullName: true,
              professionalTitle: true,
              registrationNumber: true,
            },
          },
        },
      }),
      typeof this.prisma.consultation.count === "function"
        ? this.prisma.consultation.count({ where })
        : Promise.resolve(null),
    ]);

    const hasNextPage = rows.length > limit;
    const pageRows = hasNextPage ? rows.slice(0, limit) : rows;
    const nextCursor = hasNextPage ? (pageRows.at(-1)?.id ?? null) : null;

    const items: ConsultationListItem[] = pageRows.map((row) => ({
      id: row.id,
      appointmentId: row.appointmentId ?? null,
      patientId: row.patientId,
      professionalId: row.professionalId,
      scheduledAt: row.scheduledAt.toISOString(),
      localScheduledAt: localDateTime(row.scheduledAt, timeZone),
      startedAt: row.startedAt ? row.startedAt.toISOString() : null,
      completedAt: row.completedAt ? row.completedAt.toISOString() : null,
      status: row.status,
      anamnesisStatus: row.anamnesisStatus,
      patient: {
        id: row.patient.id,
        fullName: row.patient.fullName,
      },
      professional: {
        id: row.professional.id,
        fullName: row.professional.fullName,
        professionalTitle: row.professional.professionalTitle ?? null,
        registrationNumber: row.professional.registrationNumber ?? null,
      },
      version: row.version,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    }));

    return {
      timeZone,
      data: items,
      items,
      pageInfo: {
        limit,
        page,
        totalCount: totalCount ?? items.length,
        hasNextPage,
        nextCursor,
      },
    };
  }

  private formatConsultationDetail(
    row: {
      id: string;
      organizationId: string;
      appointmentId: string | null;
      patientId: string;
      professionalId: string;
      scheduledAt: Date;
      startedAt: Date | null;
      completedAt: Date | null;
      status: ConsultationStatus;
      anamnesisStatus: AnamnesisStatus;
      anamnesisTopicRevisionId?: string | null;
      chiefComplaint?: string | null;
      clinicalNotes?: string | null;
      anamnesisDraft?: Prisma.JsonValue | null;
      draftSavedAt?: Date | null;
      draftSavedById?: string | null;
      approvedAt?: Date | null;
      approvedById?: string | null;
      signedBy?: string | null;
      anamnesisSnapshot?: Prisma.JsonValue | null;
      snapshotHash?: string | null;
      version: number;
      createdAt: Date;
      updatedAt: Date;
      patient?: {
        id: string;
        fullName: string;
      } | null;
      professional?: {
        id: string;
        fullName: string;
        professionalTitle: string | null;
        registrationNumber: string | null;
      } | null;
    },
    timeZone: string,
  ): ConsultationDetailResponse {
    return {
      id: row.id,
      consultationId: row.id,
      organizationId: row.organizationId,
      appointmentId: row.appointmentId ?? null,
      patientId: row.patientId,
      professionalId: row.professionalId,
      scheduledAt: row.scheduledAt.toISOString(),
      localScheduledAt: localDateTime(row.scheduledAt, timeZone),
      startedAt: row.startedAt ? row.startedAt.toISOString() : null,
      completedAt: row.completedAt ? row.completedAt.toISOString() : null,
      status: row.status,
      anamnesisStatus: row.anamnesisStatus,
      anamnesisTopicRevisionId: row.anamnesisTopicRevisionId ?? null,
      chiefComplaint: row.chiefComplaint ?? null,
      clinicalNotes: row.clinicalNotes ?? null,
      anamnesisDraft: row.anamnesisDraft ?? null,
      draftSavedAt: row.draftSavedAt ? row.draftSavedAt.toISOString() : null,
      draftSavedById: row.draftSavedById ?? null,
      approvedAt: row.approvedAt ? row.approvedAt.toISOString() : null,
      approvedById: row.approvedById ?? null,
      signedBy: row.signedBy ?? null,
      anamnesisSnapshot: row.anamnesisSnapshot ?? null,
      snapshotHash: row.snapshotHash ?? null,
      version: row.version,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
      patient: row.patient
        ? {
            id: row.patient.id,
            fullName: row.patient.fullName,
          }
        : undefined,
      professional: row.professional
        ? {
            id: row.professional.id,
            fullName: row.professional.fullName,
            professionalTitle: row.professional.professionalTitle ?? null,
            registrationNumber: row.professional.registrationNumber ?? null,
          }
        : undefined,
      consultation: {
        id: row.id,
        appointmentId: row.appointmentId ?? null,
        patientId: row.patientId,
        professionalId: row.professionalId,
        scheduledAt: row.scheduledAt.toISOString(),
        localScheduledAt: localDateTime(row.scheduledAt, timeZone),
        startedAt: row.startedAt ? row.startedAt.toISOString() : null,
        completedAt: row.completedAt ? row.completedAt.toISOString() : null,
        status: row.status,
        anamnesisStatus: row.anamnesisStatus,
        chiefComplaint: row.chiefComplaint ?? null,
        clinicalNotes: row.clinicalNotes ?? null,
        anamnesisDraft: row.anamnesisDraft ?? null,
        draftSavedAt: row.draftSavedAt ? row.draftSavedAt.toISOString() : null,
        draftSavedById: row.draftSavedById ?? null,
        approvedAt: row.approvedAt ? row.approvedAt.toISOString() : null,
        approvedById: row.approvedById ?? null,
        signedBy: row.signedBy ?? null,
        anamnesisSnapshot: row.anamnesisSnapshot ?? null,
        snapshotHash: row.snapshotHash ?? null,
        version: row.version,
        createdAt: row.createdAt.toISOString(),
        updatedAt: row.updatedAt.toISOString(),
      },
    };
  }

  async start(
    organizationId: string,
    callerUserId: string,
    body: StartConsultationBody,
  ): Promise<{ created: boolean; consultation: ConsultationDetailResponse }> {
    const timeZone = await this.resolveTimeZone(organizationId);

    const runInTransaction = async (tx: PrismaClient) => {
      // 1. Patient must belong to active clinic
      const patient = await tx.patient.findFirst({
        where: { id: body.patientId, organizationId },
        select: { id: true, fullName: true },
      });
      if (!patient) {
        throw new ApiError("NOT_FOUND", 404, "Paciente não encontrado.");
      }

      // 2. Professional is the caller, or if specified, must be an active clinical professional of the clinic
      const professionalId = body.professionalId ?? callerUserId;
      if (body.professionalId && body.professionalId !== callerUserId) {
        const profMembership = await tx.membership.findFirst({
          where: {
            userId: professionalId,
            organizationId,
            status: "ACTIVE",
            role: { in: CLINICAL_ROLES },
          },
        });
        if (!profMembership) {
          throw new ApiError(
            "NOT_FOUND",
            404,
            "Profissional não encontrado ou sem habilitação clínica ativa nesta organização.",
          );
        }
      }

      // 3. Appointment validations if provided
      let appointment: {
        id: string;
        organizationId: string;
        patientId: string;
        professionalId: string;
        scheduledAt: Date;
        status: string;
        queueStatus: string;
      } | null = null;

      if (body.appointmentId) {
        appointment = await tx.appointment.findFirst({
          where: { id: body.appointmentId, organizationId },
          select: {
            id: true,
            organizationId: true,
            patientId: true,
            professionalId: true,
            scheduledAt: true,
            status: true,
            queueStatus: true,
          },
        });
        if (!appointment) {
          throw new ApiError("NOT_FOUND", 404, "Agendamento não encontrado.");
        }

        if (appointment.patientId !== body.patientId) {
          throw new ApiError(
            "VALIDATION_ERROR",
            400,
            "O agendamento não pertence ao paciente informado.",
            { field: "patientId" },
          );
        }

        // Idempotency: return existing consultation without duplicate creation
        const existing = await tx.consultation.findFirst({
          where: { appointmentId: body.appointmentId, organizationId },
          include: {
            patient: { select: { id: true, fullName: true } },
            professional: {
              select: {
                id: true,
                fullName: true,
                professionalTitle: true,
                registrationNumber: true,
              },
            },
          },
        });

        if (existing && existing.status !== "CANCELLED") {
          return {
            created: false,
            consultation: this.formatConsultationDetail(existing, timeZone),
          };
        }
      }

      // 4. Resolve scheduledAt and startedAt
      let scheduledAt: Date;
      if (body.scheduledAt) {
        scheduledAt = new Date(body.scheduledAt);
        if (Number.isNaN(scheduledAt.getTime())) {
          throw new ApiError(
            "VALIDATION_ERROR",
            400,
            "Data agendada inválida.",
            { field: "scheduledAt" },
          );
        }
      } else if (appointment) {
        scheduledAt = appointment.scheduledAt;
      } else {
        scheduledAt = new Date();
      }

      const startedAt = new Date();

      // 5. Update appointment status to IN_PROGRESS if CONFIRMED or RESERVED
      if (appointment) {
        if (
          appointment.status === "CONFIRMED" ||
          appointment.status === "RESERVED"
        ) {
          await tx.appointment.update({
            where: { id: appointment.id },
            data: {
              status: "IN_PROGRESS",
              ...(appointment.queueStatus === "WAITING" ||
              appointment.queueStatus === "ARRIVED" ||
              appointment.queueStatus === "CALLED"
                ? {
                    queueStatus: "IN_SERVICE",
                    queueUpdatedAt: startedAt,
                    queueUpdatedById: callerUserId,
                  }
                : {}),
            },
          });
        }
      }

      // 6. Create consultation
      let createdConsultation: Prisma.ConsultationGetPayload<{
        include: {
          patient: { select: { id: true; fullName: true } };
          professional: {
            select: {
              id: true;
              fullName: true;
              professionalTitle: true;
              registrationNumber: true;
            };
          };
        };
      }>;
      try {
        createdConsultation = await tx.consultation.create({
          data: {
            organizationId,
            appointmentId: body.appointmentId ?? null,
            patientId: body.patientId,
            professionalId,
            scheduledAt,
            startedAt,
            status: "IN_PROGRESS",
            anamnesisStatus: "PENDING",
            version: 0,
          },
          include: {
            patient: { select: { id: true, fullName: true } },
            professional: {
              select: {
                id: true,
                fullName: true,
                professionalTitle: true,
                registrationNumber: true,
              },
            },
          },
        });
      } catch (err: unknown) {
        if (
          body.appointmentId &&
          typeof err === "object" &&
          err !== null &&
          "code" in err &&
          err.code === "P2002"
        ) {
          const conflictConsultation = await tx.consultation.findFirst({
            where: { appointmentId: body.appointmentId, organizationId },
            include: {
              patient: { select: { id: true, fullName: true } },
              professional: {
                select: {
                  id: true,
                  fullName: true,
                  professionalTitle: true,
                  registrationNumber: true,
                },
              },
            },
          });
          if (conflictConsultation) {
            return {
              created: false,
              consultation: this.formatConsultationDetail(
                conflictConsultation,
                timeZone,
              ),
            };
          }
        }
        throw err;
      }

      // 7. Record AuditLog entry
      await tx.auditLog.create({
        data: {
          organizationId,
          actorUserId: callerUserId,
          action: "CONSULTATION_STARTED",
          targetType: "CONSULTATION",
          targetId: createdConsultation.id,
          metadata: {
            patientId: body.patientId,
            professionalId,
            appointmentId: body.appointmentId ?? null,
            ...(body.notes ? { notes: body.notes } : {}),
          },
        },
      });

      return {
        created: true,
        consultation: this.formatConsultationDetail(
          createdConsultation,
          timeZone,
        ),
      };
    };

    if (typeof this.prisma.$transaction === "function") {
      return (
        this.prisma.$transaction as <T>(
          fn: (tx: any) => Promise<T>,
        ) => Promise<T>
      )(runInTransaction);
    }
    return runInTransaction(this.prisma);
  }

  async getById(
    organizationId: string,
    consultationId: string,
  ): Promise<ConsultationDetailResponse> {
    const timeZone = await this.resolveTimeZone(organizationId);
    const consultation = await this.prisma.consultation.findFirst({
      where: {
        id: consultationId,
        organizationId,
      },
      include: {
        patient: {
          select: {
            id: true,
            fullName: true,
          },
        },
        professional: {
          select: {
            id: true,
            fullName: true,
            professionalTitle: true,
            registrationNumber: true,
          },
        },
      },
    });

    if (!consultation) {
      throw new ApiError("NOT_FOUND", 404, "Atendimento não encontrado.");
    }

    return this.formatConsultationDetail(consultation, timeZone);
  }

  async saveDraft(
    organizationId: string,
    actorUserId: string,
    actorRole: string,
    consultationId: string,
    body: SaveConsultationDraftBody,
  ): Promise<ConsultationDetailResponse> {
    const timeZone = await this.resolveTimeZone(organizationId);

    const consultation = await this.prisma.consultation.findFirst({
      where: {
        id: consultationId,
        organizationId,
      },
    });

    if (!consultation) {
      throw new ApiError("NOT_FOUND", 404, "Atendimento não encontrado.");
    }

    const isAssigned = consultation.professionalId === actorUserId;
    const isClinicAdminProf =
      actorRole === "ADMIN" || actorRole === "ADMIN_PROFESSIONAL";
    if (!isAssigned && !isClinicAdminProf) {
      throw new ApiError(
        "PERMISSION_DENIED",
        403,
        "Profissional não autorizado para este atendimento.",
      );
    }

    if (
      consultation.anamnesisStatus === "APPROVED" ||
      consultation.status === "COMPLETED"
    ) {
      throw new ApiError(
        "DOCUMENT_STATE_CONFLICT",
        409,
        "Anamnese já finalizada/aprovada não pode ser editada.",
        {
          currentStatus: consultation.status,
          anamnesisStatus: consultation.anamnesisStatus,
        },
      );
    }

    if (consultation.status === "CANCELLED") {
      throw new ApiError(
        "DOCUMENT_STATE_CONFLICT",
        409,
        "Atendimento cancelado não pode ser editado.",
      );
    }

    if (consultation.version !== body.version) {
      throw new ApiError(
        "VERSION_CONFLICT",
        409,
        "O rascunho da anamnese foi alterado por outra sessão. Recarregue antes de salvar.",
        {
          currentVersion: consultation.version,
          submittedVersion: body.version,
        },
      );
    }

    const now = new Date();
    const nextVersion = consultation.version + 1;

    const existingDraft =
      consultation.anamnesisDraft &&
      typeof consultation.anamnesisDraft === "object" &&
      !Array.isArray(consultation.anamnesisDraft)
        ? (consultation.anamnesisDraft as Record<string, unknown>)
        : {};

    const newDraft: Record<string, unknown> = {
      ...existingDraft,
      ...(body.chiefComplaint !== undefined
        ? { chiefComplaint: body.chiefComplaint }
        : {}),
      ...(body.clinicalNotes !== undefined
        ? { clinicalNotes: body.clinicalNotes }
        : {}),
      ...(body.topics !== undefined ? { topics: body.topics } : {}),
    };

    const runInTransaction = async (tx: PrismaClient) => {
      const updateResult = await tx.consultation.updateMany({
        where: {
          id: consultationId,
          organizationId,
          version: body.version,
        },
        data: {
          version: nextVersion,
          anamnesisStatus: "DRAFT",
          status:
            consultation.status === "SCHEDULED"
              ? "IN_PROGRESS"
              : consultation.status,
          startedAt: consultation.startedAt ?? now,
          ...(body.chiefComplaint !== undefined
            ? { chiefComplaint: body.chiefComplaint }
            : {}),
          ...(body.clinicalNotes !== undefined
            ? { clinicalNotes: body.clinicalNotes }
            : {}),
          anamnesisDraft: newDraft as Prisma.InputJsonValue,
          draftSavedAt: now,
          draftSavedById: actorUserId,
        },
      });

      if (updateResult.count !== 1) {
        throw new ApiError(
          "VERSION_CONFLICT",
          409,
          "O rascunho da anamnese foi alterado por outra sessão. Recarregue antes de salvar.",
          {
            currentVersion: consultation.version,
            submittedVersion: body.version,
          },
        );
      }

      await tx.auditLog.create({
        data: {
          organizationId,
          actorUserId,
          action: "CONSULTATION_DRAFT_UPDATED",
          targetType: "CONSULTATION",
          targetId: consultationId,
          metadata: {
            consultationId,
            version: nextVersion,
            previousVersion: consultation.version,
          },
        },
      });

      const updated = await tx.consultation.findFirst({
        where: { id: consultationId, organizationId },
        include: {
          patient: { select: { id: true, fullName: true } },
          professional: {
            select: {
              id: true,
              fullName: true,
              professionalTitle: true,
              registrationNumber: true,
            },
          },
        },
      });

      if (!updated) {
        throw new ApiError("NOT_FOUND", 404, "Atendimento não encontrado.");
      }

      return this.formatConsultationDetail(updated, timeZone);
    };

    if (typeof this.prisma.$transaction === "function") {
      return (
        this.prisma.$transaction as unknown as <T>(
          fn: (tx: PrismaClient) => Promise<T>,
        ) => Promise<T>
      )(runInTransaction);
    }
    return runInTransaction(this.prisma);
  }

  async approve(
    organizationId: string,
    actorUserId: string,
    actorRole: string,
    consultationId: string,
    body: ApproveConsultationBody,
  ): Promise<ApproveConsultationResponse> {
    const timeZone = await this.resolveTimeZone(organizationId);

    const consultation = await this.prisma.consultation.findFirst({
      where: {
        id: consultationId,
        organizationId,
      },
      include: {
        patient: { select: { id: true, fullName: true } },
        professional: {
          select: {
            id: true,
            fullName: true,
            professionalTitle: true,
            registrationNumber: true,
          },
        },
      },
    });

    if (!consultation) {
      throw new ApiError("NOT_FOUND", 404, "Atendimento não encontrado.");
    }

    const isAssigned = consultation.professionalId === actorUserId;
    const isClinicAdminProf =
      actorRole === "ADMIN" || actorRole === "ADMIN_PROFESSIONAL";
    if (!isAssigned && !isClinicAdminProf) {
      throw new ApiError(
        "PERMISSION_DENIED",
        403,
        "Profissional não autorizado para aprovar este atendimento.",
      );
    }

    if (
      consultation.anamnesisStatus === "APPROVED" ||
      consultation.status === "COMPLETED"
    ) {
      throw new ApiError(
        "DOCUMENT_STATE_CONFLICT",
        409,
        "Anamnese já foi aprovada e congelada.",
        {
          currentStatus: consultation.status,
          anamnesisStatus: consultation.anamnesisStatus,
        },
      );
    }

    if (consultation.status === "CANCELLED") {
      throw new ApiError(
        "DOCUMENT_STATE_CONFLICT",
        409,
        "Atendimento cancelado não pode ser aprovado.",
      );
    }

    if (consultation.version !== body.version) {
      throw new ApiError(
        "VERSION_CONFLICT",
        409,
        "A consulta foi alterada por outra sessão. Recarregue antes de aprovar.",
        {
          currentVersion: consultation.version,
          submittedVersion: body.version,
        },
      );
    }

    // Merge any draft updates submitted with approval
    const existingDraft =
      consultation.anamnesisDraft &&
      typeof consultation.anamnesisDraft === "object" &&
      !Array.isArray(consultation.anamnesisDraft)
        ? (consultation.anamnesisDraft as Record<string, unknown>)
        : {};

    const finalChiefComplaint =
      body.chiefComplaint !== undefined
        ? (body.chiefComplaint ?? null)
        : (consultation.chiefComplaint ??
          (typeof existingDraft.chiefComplaint === "string"
            ? existingDraft.chiefComplaint
            : null));

    const finalClinicalNotes =
      body.clinicalNotes !== undefined
        ? (body.clinicalNotes ?? null)
        : (consultation.clinicalNotes ??
          (typeof existingDraft.clinicalNotes === "string"
            ? existingDraft.clinicalNotes
            : null));

    const existingTopics =
      existingDraft.topics && typeof existingDraft.topics === "object"
        ? existingDraft.topics
        : null;

    const finalTopicsInput =
      body.topics !== undefined ? body.topics : existingTopics;

    // Validate required topics
    const requiredTopics: Array<{ key: string; label: string }> = [];

    let revision = consultation.anamnesisTopicRevisionId
      ? await this.prisma.anamnesisTopicRevision.findUnique({
          where: { id: consultation.anamnesisTopicRevisionId },
        })
      : null;

    if (!revision) {
      const config = await this.prisma.anamnesisTopicConfig.findUnique({
        where: {
          organizationId_professionalId: {
            organizationId,
            professionalId: consultation.professionalId,
          },
        },
        include: { revisions: { orderBy: { version: "desc" }, take: 1 } },
      });
      revision = config?.revisions[0] ?? null;
    }

    if (revision && Array.isArray(revision.topics)) {
      for (const item of revision.topics as Array<{
        key?: string;
        label?: string;
        active?: boolean;
        required?: boolean;
      }>) {
        if (item && item.required && item.active !== false && item.key) {
          requiredTopics.push({
            key: item.key,
            label: item.label || item.key,
          });
        }
      }
    }

    const topicValuesMap = new Map<string, string>();
    if (finalTopicsInput) {
      if (Array.isArray(finalTopicsInput)) {
        for (const t of finalTopicsInput) {
          if (t && typeof t.key === "string" && typeof t.value === "string") {
            topicValuesMap.set(t.key, t.value.trim());
          }
        }
      } else if (typeof finalTopicsInput === "object") {
        for (const [key, val] of Object.entries(finalTopicsInput)) {
          if (typeof val === "string") {
            topicValuesMap.set(key, val.trim());
          }
        }
      }
    }

    if (finalChiefComplaint && finalChiefComplaint.trim()) {
      topicValuesMap.set("chief_complaint", finalChiefComplaint.trim());
      topicValuesMap.set("chiefComplaint", finalChiefComplaint.trim());
    }
    if (finalClinicalNotes && finalClinicalNotes.trim()) {
      topicValuesMap.set("clinical_notes", finalClinicalNotes.trim());
      topicValuesMap.set("clinicalNotes", finalClinicalNotes.trim());
    }

    const missingTopics: string[] = [];
    for (const req of requiredTopics) {
      const val = topicValuesMap.get(req.key);
      if (!val || val.length === 0) {
        missingTopics.push(req.label);
      }
    }

    if (missingTopics.length > 0) {
      throw new ApiError(
        "VALIDATION_ERROR",
        400,
        `Tópicos obrigatórios da anamnese devem estar preenchidos antes da aprovação: ${missingTopics.join(", ")}.`,
        {
          field: "topics",
          missingTopics,
        },
      );
    }

    const actorUser = await this.prisma.user.findUnique({
      where: { id: actorUserId },
      select: {
        id: true,
        fullName: true,
        professionalTitle: true,
        registrationNumber: true,
      },
    });

    const prof = actorUser ?? consultation.professional;
    const registration = prof?.registrationNumber?.trim();
    const title = prof?.professionalTitle?.trim();
    const signedBy = registration
      ? registration
      : title
        ? `${title} ${prof?.fullName || ""}`.trim()
        : (prof?.fullName ?? "CRM/SP 000000");

    const now = new Date();
    const nextVersion = consultation.version + 1;

    const snapshot = {
      consultationId,
      organizationId,
      version: nextVersion,
      patient: {
        id: consultation.patient.id,
        fullName: consultation.patient.fullName,
      },
      professional: {
        id: prof?.id ?? consultation.professionalId,
        fullName: prof?.fullName ?? consultation.professional.fullName,
        professionalTitle: prof?.professionalTitle ?? null,
        registrationNumber: prof?.registrationNumber ?? null,
      },
      signedBy,
      chiefComplaint: finalChiefComplaint,
      clinicalNotes: finalClinicalNotes,
      topics: finalTopicsInput ?? {},
      approvedAt: now.toISOString(),
      approvedById: actorUserId,
    };

    const snapshotHash =
      "sha256_" +
      createHash("sha256").update(JSON.stringify(snapshot)).digest("hex");

    const runInTransaction = async (tx: PrismaClient) => {
      const updateResult = await tx.consultation.updateMany({
        where: {
          id: consultationId,
          organizationId,
          version: consultation.version,
        },
        data: {
          version: nextVersion,
          anamnesisStatus: "APPROVED",
          status: "COMPLETED",
          completedAt: consultation.completedAt ?? now,
          startedAt: consultation.startedAt ?? now,
          chiefComplaint: finalChiefComplaint,
          clinicalNotes: finalClinicalNotes,
          approvedAt: now,
          approvedById: actorUserId,
          signedBy,
          anamnesisSnapshot: snapshot as Prisma.InputJsonValue,
          snapshotHash,
        },
      });

      if (updateResult.count !== 1) {
        throw new ApiError(
          "VERSION_CONFLICT",
          409,
          "A consulta foi alterada por outra sessão. Recarregue antes de aprovar.",
          {
            currentVersion: consultation.version,
            submittedVersion: body.version,
          },
        );
      }

      if (consultation.appointmentId) {
        await tx.appointment.updateMany({
          where: { id: consultation.appointmentId, organizationId },
          data: {
            status: "COMPLETED",
            queueStatus: "COMPLETED",
            queueUpdatedAt: now,
            queueUpdatedById: actorUserId,
          },
        });
      }

      await tx.auditLog.create({
        data: {
          organizationId,
          actorUserId,
          action: "CONSULTATION_ANAMNESIS_APPROVED",
          targetType: "CONSULTATION",
          targetId: consultationId,
          metadata: {
            consultationId,
            version: nextVersion,
            professionalId: actorUserId,
            signedBy,
            snapshotHash,
            approvedAt: now.toISOString(),
          },
        },
      });

      const updated = await tx.consultation.findFirst({
        where: { id: consultationId, organizationId },
        include: {
          patient: { select: { id: true, fullName: true } },
          professional: {
            select: {
              id: true,
              fullName: true,
              professionalTitle: true,
              registrationNumber: true,
            },
          },
        },
      });

      if (!updated) {
        throw new ApiError("NOT_FOUND", 404, "Atendimento não encontrado.");
      }

      const formatted = this.formatConsultationDetail(updated, timeZone);

      return {
        status: "APPROVED" as const,
        signedBy,
        approvedAt: now.toISOString(),
        consultationId,
        version: nextVersion,
        snapshotHash,
        snapshot,
        consultation: formatted,
      };
    };

    if (typeof this.prisma.$transaction === "function") {
      return (
        this.prisma.$transaction as unknown as <T>(
          fn: (tx: PrismaClient) => Promise<T>,
        ) => Promise<T>
      )(runInTransaction);
    }
    return runInTransaction(this.prisma);
  }
}
