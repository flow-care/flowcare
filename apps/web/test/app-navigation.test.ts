import { describe, expect, test } from "bun:test";
import { appSections, canOpenSection } from "@/lib/app-navigation";

describe("app navigation", () => {
  test("shows common modules to every active role", () => {
    for (const role of [
      "ADMIN",
      "ADMIN_PROFESSIONAL",
      "PROFESSIONAL",
      "RECEPTIONIST",
    ] as const) {
      for (const section of ["dashboard", "appointments", "patients"]) {
        expect(canOpenSection(role, section)).toBe(true);
      }
    }
  });

  test("keeps administrative and clinical modules behind their roles", () => {
    expect(canOpenSection("RECEPTIONIST", "settings")).toBe(false);
    expect(canOpenSection("PROFESSIONAL", "settings")).toBe(false);
    expect(canOpenSection("ADMIN", "settings")).toBe(true);
    // ADMIN acumula o grupo clínico (decisão de 22/10/2026).
    expect(canOpenSection("ADMIN", "consultations")).toBe(true);
    expect(canOpenSection("PROFESSIONAL", "consultations")).toBe(true);
    expect(canOpenSection("RECEPTIONIST", "consultations")).toBe(false);
    expect(canOpenSection("RECEPTIONIST", "whatsapp")).toBe(true);
    expect(canOpenSection("PROFESSIONAL", "whatsapp")).toBe(false);
    expect(canOpenSection("ADMIN", "unlisted-module")).toBe(false);
  });

  test("defines one unique route for every sidebar item", () => {
    expect(new Set(appSections.map((section) => section.segment)).size).toBe(
      appSections.length,
    );
  });
});
