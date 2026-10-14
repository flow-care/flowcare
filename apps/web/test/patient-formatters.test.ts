import { expect, test } from "bun:test";
import { formatBirthDateAndAge, maskCpf } from "../lib/patient-formatters";

test("maskCpf masks CPF to format 123.***.***-00", () => {
  expect(maskCpf("12345678900")).toBe("123.***.***-00");
  expect(maskCpf("123.456.789-00")).toBe("123.***.***-00");
  expect(maskCpf("52998224725")).toBe("529.***.***-25");
});

test("maskCpf returns original value when digits length is not 11", () => {
  expect(maskCpf("123")).toBe("123");
  expect(maskCpf("")).toBe("");
  expect(maskCpf("1234567890123")).toBe("1234567890123");
});

test("formatBirthDateAndAge calculates age and formats Brazilian date correctly", () => {
  const result = formatBirthDateAndAge("1990-05-15");
  expect(result.birthDateFormatted).toBe("15/05/1990");
  expect(result.ageText).toContain("anos");

  const fallback = formatBirthDateAndAge(null);
  expect(fallback).toEqual({ ageText: "—", birthDateFormatted: "—" });

  const invalid = formatBirthDateAndAge("invalid-date");
  expect(invalid).toEqual({ ageText: "—", birthDateFormatted: "invalid-date" });
});
