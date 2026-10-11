/**
 * Erro de domínio: carrega o código estável do contrato (§2) e o status
 * HTTP. Services lançam; a tradução para o envelope acontece uma única
 * vez, no onError da aplicação.
 */
export class ApiError extends Error {
  constructor(
    readonly code: string,
    readonly httpStatus: number,
    message: string,
    readonly details?: Record<string, string>,
  ) {
    super(message);
  }
}
