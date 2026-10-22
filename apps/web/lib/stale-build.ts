const SERVER_ACTION_MISSING = "Failed to find Server Action";
const RELOAD_TIMESTAMP_KEY = "flowcare:stale-build-reload-at";
const RELOAD_COOLDOWN_MS = 30_000;

export const STALE_BUILD_MESSAGE =
  "O Flowcare foi atualizado. Recarregando a página para você continuar.";

/**
 * O Next assina cada Server Action com um id derivado do build. Quando o
 * navegador fica com o bundle de uma build anterior à que o servidor está
 * servindo — o caso normal depois de um deploy com a aba aberta — a chamada
 * falha com `Failed to find Server Action "<id>"`. Não é bug de código nem de
 * rede: a página só precisa ser recarregada.
 */
export function isServerActionMissingError(error: unknown): boolean {
  if (!error) return false;

  if (typeof error === "string") {
    return error.includes(SERVER_ACTION_MISSING);
  }

  const message = (error as { message?: unknown }).message;
  return typeof message === "string" && message.includes(SERVER_ACTION_MISSING);
}

/**
 * Recarrega a página uma única vez para sair da build antiga. O cooldown
 * evita loop caso o reload não resolva (servidor de fato sem a action).
 */
export function recoverFromStaleBuild(): boolean {
  if (typeof window === "undefined") return false;

  try {
    const lastAttempt = Number(
      window.sessionStorage.getItem(RELOAD_TIMESTAMP_KEY) ?? 0,
    );
    if (Date.now() - lastAttempt < RELOAD_COOLDOWN_MS) return false;
    window.sessionStorage.setItem(RELOAD_TIMESTAMP_KEY, String(Date.now()));
  } catch {
    // sessionStorage indisponível (modo restrito): recarrega sem guarda.
  }

  window.setTimeout(() => window.location.reload(), 1200);
  return true;
}
