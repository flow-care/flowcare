import { t } from "elysia";
import { weeklyScheduleRule } from "../onboarding/model";

export const params = t.Object({
  orgSlug: t.String({ minLength: 2, maxLength: 60 }),
});
export const exceptionParams = t.Object({
  orgSlug: t.String({ minLength: 2, maxLength: 60 }),
  exceptionId: t.String({ format: "uuid" }),
});
export const weeklyBody = t.Object({
  timezone: t.String({ minLength: 3, maxLength: 100 }),
  rules: t.Array(weeklyScheduleRule, { maxItems: 100 }),
});
export const weeklyResponse = t.Object({
  timezone: t.String(),
  rules: t.Array(weeklyScheduleRule),
});
export const exceptionBody = t.Object({
  professionalId: t.Optional(t.String({ format: "uuid" })),
  startsAt: t.String({ format: "date-time" }),
  endsAt: t.String({ format: "date-time" }),
  reason: t.Optional(t.String({ maxLength: 500 })),
});
export const exceptionItem = t.Object({
  id: t.String(),
  professionalId: t.Nullable(t.String()),
  startsAt: t.String(),
  endsAt: t.String(),
  timezone: t.String(),
  reason: t.Nullable(t.String()),
});
export const exceptionsResponse = t.Object({
  timezone: t.String(),
  exceptions: t.Array(exceptionItem),
});
export const exceptionResponse = t.Object({ exception: exceptionItem });
export const deleteResponse = t.Object({ deleted: t.Boolean() });
export type WeeklyBody = typeof weeklyBody.static;
export type ExceptionBody = typeof exceptionBody.static;
