import { expect, test } from "bun:test";
import {
  daysFromSchedule,
  rulesFromDays,
  validateDays,
} from "../lib/onboarding-hours";

test("closed days remain without intervals when saved and reloaded", () => {
  const days = daysFromSchedule([]);
  expect(days.every((day) => !day.active && day.intervals.length === 0)).toBe(
    true,
  );
  expect(validateDays(days)).toBeUndefined();
  expect(rulesFromDays(days)).toEqual([]);
});

test("saved intervals hydrate their day and remain in the weekly payload", () => {
  const rule = {
    dayOfWeek: "MONDAY" as const,
    startTime: "08:00",
    endTime: "12:00",
    slotDurationMinutes: 30,
  };
  const days = daysFromSchedule([rule]);
  expect(days[0]?.active).toBe(true);
  expect(validateDays(days)).toBeUndefined();
  expect(rulesFromDays(days)).toEqual([rule]);
});

test("active days require intervals, block reversed times and overlaps", () => {
  const days = daysFromSchedule([]);
  const monday = days[0];
  if (!monday) throw new Error("Monday is missing");
  monday.active = true;
  expect(validateDays(days)).toContain("Adicione um intervalo");
  monday.intervals = [
    {
      id: "first",
      startTime: "12:00",
      endTime: "08:00",
      slotDurationMinutes: 30,
    },
  ];
  expect(validateDays(days)).toContain("anterior ao fim");
  monday.intervals = [
    {
      id: "first",
      startTime: "08:00",
      endTime: "12:00",
      slotDurationMinutes: 30,
    },
    {
      id: "second",
      startTime: "11:00",
      endTime: "13:00",
      slotDurationMinutes: 30,
    },
  ];
  expect(validateDays(days)).toContain("sobrepostos");
});
