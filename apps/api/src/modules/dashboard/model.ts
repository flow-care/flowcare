import { t } from "elysia";

export const dashboardParams = t.Object({
  orgSlug: t.String({ minLength: 1 }),
});

export const dashboardQuery = t.Object({
  period: t.Optional(
    t.Union([t.Literal("today"), t.Literal("week"), t.Literal("month")]),
  ),
  startDate: t.Optional(t.String({ pattern: "^\\d{4}-\\d{2}-\\d{2}$" })),
  endDate: t.Optional(t.String({ pattern: "^\\d{4}-\\d{2}-\\d{2}$" })),
});

export const dashboardMetricsResponse = t.Object({
  periodStart: t.String(),
  periodEnd: t.String(),
  timeZone: t.String(),
  totalAppointments: t.Integer({ minimum: 0 }),
  scheduledAppointments: t.Integer({ minimum: 0 }),
  completedAppointments: t.Integer({ minimum: 0 }),
  cancelledAppointments: t.Integer({ minimum: 0 }),
  noShowAppointments: t.Integer({ minimum: 0 }),
  noShowRate: t.Union([t.Number({ minimum: 0, maximum: 1 }), t.Null()]),
});

export type DashboardQuery = typeof dashboardQuery.static;
export type DashboardMetricsResponse = typeof dashboardMetricsResponse.static;
