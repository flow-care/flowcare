import { ApiError } from "../../lib/api-error";

/**
 * Erros do domínio account (fábricas ApiError).
 * Reutiliza códigos estáveis do catálogo da API.
 */
export const InvalidCurrentPassword = () =>
  new ApiError("INVALID_CREDENTIALS", 401, "Senha atual incorreta.");

export const UserNotFound = () =>
  new ApiError("NOT_FOUND", 404, "Usuário não encontrado.");

export const SessionNotFound = () =>
  new ApiError("NOT_FOUND", 404, "Sessão não encontrada.");
