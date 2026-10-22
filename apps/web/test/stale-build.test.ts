import { describe, expect, test } from "bun:test";
import {
  isServerActionMissingError,
  recoverFromStaleBuild,
} from "../lib/stale-build";

describe("stale build detection", () => {
  test("reconhece o erro de Server Action de outra build", () => {
    const error = new Error(
      'Failed to find Server Action "608f87ed3f2fb3186ca97ef3acb178baa4ea9cd16a". This request might be from an older or newer deployment.',
    );

    expect(isServerActionMissingError(error)).toBe(true);
  });

  test("reconhece também quando o erro chega como string", () => {
    expect(
      isServerActionMissingError(
        'Failed to find Server Action "abc123" was not found on the server.',
      ),
    ).toBe(true);
  });

  test("não confunde erros comuns de negócio", () => {
    expect(
      isServerActionMissingError(
        Object.assign(new Error("O horário selecionado conflita."), {
          code: "SLOT_CONFLICT",
        }),
      ),
    ).toBe(false);
    expect(isServerActionMissingError(null)).toBe(false);
    expect(isServerActionMissingError({})).toBe(false);
  });

  test("não tenta recarregar fora do navegador", () => {
    expect(recoverFromStaleBuild()).toBe(false);
  });
});
