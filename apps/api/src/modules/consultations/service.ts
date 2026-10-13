import type { Prisma, PrismaClient } from "../../generated/prisma/client";
import { ApiError } from "../../lib/api-error";
import { normalizePatientName } from "../patients/service";
import type {
  ConsultationListItem,
  ListConsultationsQuery,
  ListConsultationsResponse,
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
}
