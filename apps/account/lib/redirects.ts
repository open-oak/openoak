import { suiteTrustedOrigins } from "../../../shared/suite-config.ts";

export function sanitizeRedirect(value: string | null | undefined) {
  if (!value) return "/apps";

  // Keep the AI connection manager's sign-in continuation on this account host.
  if (value === "/connected-ai" || value === "/connected-ai?tab=services" || value === "/connected-ai?tab=setup") {
    return value;
  }

  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase();
    const legacyHosts = process.env.AUTH_REDIRECT_HOSTS?.trim() ? process.env.AUTH_REDIRECT_HOSTS.split(",").map((value) => value.trim().toLowerCase()).filter(Boolean) : undefined;
    const isAllowedHost = legacyHosts ? legacyHosts.includes(host) : suiteTrustedOrigins().includes(url.origin);
    const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(host);
    const isAllowedProtocol = url.protocol === "https:" || (url.protocol === "http:" && (process.env.NODE_ENV !== "production" || loopback));

    if (!isAllowedHost || !isAllowedProtocol || url.username || url.password) return "/apps";

    return url.toString();
  } catch {
    return "/apps";
  }
}
