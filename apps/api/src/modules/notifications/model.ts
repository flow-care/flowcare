import { t } from "elysia";

export const preferenceInput = t.Object({
  event: t.String(),
  channel: t.String(),
  enabled: t.Boolean(),
});

export const updatePreferencesBody = t.Object({
  preferences: t.Array(preferenceInput),
});

export const preference = t.Object({
  event: t.String(),
  channel: t.String(),
  enabled: t.Boolean(),
  required: t.Boolean(),
});

export const preferencesResponse = t.Object({
  preferences: t.Array(preference),
});

export type UpdatePreferencesBody = typeof updatePreferencesBody.static;
export type PreferencesResponse = typeof preferencesResponse.static;
