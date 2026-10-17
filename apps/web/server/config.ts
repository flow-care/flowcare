import "server-only";

export function getServerConfig() {
  const value = process.env.API_INTERNAL_URL;
  if (!value) throw new Error("API_INTERNAL_URL não configurada.");
  const trustProxyValue = process.env.TRUST_PROXY?.trim().toLowerCase();
  if (
    trustProxyValue !== undefined &&
    trustProxyValue !== "true" &&
    trustProxyValue !== "false"
  ) {
    throw new Error("TRUST_PROXY deve ser true ou false.");
  }
  const url = new URL(value);
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  ) {
    throw new Error("API_INTERNAL_URL inválida.");
  }
  return {
    apiBaseUrl: value.replace(/\/$/, ""),
    secureCookies: process.env.NODE_ENV === "production",
    trustProxy: trustProxyValue === "true",
  };
}
