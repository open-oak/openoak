import { mcpAuthConfig } from "./auth";

const DEFAULT_BROWSER_ORIGINS = [
  "https://openoak.org",
  "https://account.openoak.org",
  "https://todo.openoak.org",
  "https://outline.openoak.org",
  "https://kanban.openoak.org",
  "https://chatgpt.com",
  "https://chat.openai.com",
  "https://claude.ai",
  "https://vscode.dev",
  "https://github.dev",
  "https://github.com",
  "https://cursor.com",
] as const;

function configuredValues(name: string) {
  return (process.env[name] || "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
}

function normalizeHost(value: string) {
  if (!value || /[\s/@]/.test(value)) return null;
  try {
    const parsed = new URL(`https://${value}`);
    if (parsed.username || parsed.password || parsed.pathname !== "/" || parsed.search || parsed.hash) return null;
    return parsed.host.toLocaleLowerCase();
  } catch {
    return null;
  }
}

function normalizeOrigin(value: string) {
  try {
    const parsed = new URL(value);
    if (!(["https:", "http:"].includes(parsed.protocol))) return null;
    if (parsed.username || parsed.password || parsed.pathname !== "/" || parsed.search || parsed.hash) return null;
    return parsed.origin;
  } catch {
    return null;
  }
}

function allowedHosts(request: Request) {
  const hosts = new Set<string>();
  const resourceHost = normalizeHost(new URL(mcpAuthConfig.resource).host);
  if (resourceHost) hosts.add(resourceHost);
  for (const value of configuredValues("MCP_ALLOWED_HOSTS")) {
    const host = normalizeHost(value);
    if (host) hosts.add(host);
  }
  if (process.env.NODE_ENV !== "production") {
    const requestHost = normalizeHost(new URL(request.url).host);
    if (requestHost && ["localhost", "127.0.0.1", "[::1]"].includes(new URL(`https://${requestHost}`).hostname)) {
      hosts.add(requestHost);
    }
  }
  return hosts;
}

export function allowedBrowserOrigins() {
  const origins = new Set<string>(DEFAULT_BROWSER_ORIGINS);
  for (const value of configuredValues("MCP_ALLOWED_ORIGINS")) {
    const origin = normalizeOrigin(value);
    if (origin) origins.add(origin);
  }
  if (process.env.NODE_ENV !== "production") {
    for (const port of ["3000", "3001", "3002", "3003", "3004"]) {
      origins.add(`http://localhost:${port}`);
      origins.add(`http://127.0.0.1:${port}`);
    }
  }
  return origins;
}

export function validateMcpRequestTarget(request: Request) {
  const requestUrlHost = normalizeHost(new URL(request.url).host);
  const headerHost = normalizeHost(request.headers.get("host") || "");
  const allowed = allowedHosts(request);
  if (!requestUrlHost || !allowed.has(requestUrlHost)) return { ok: false as const, reason: "host" as const };
  if (!headerHost || !allowed.has(headerHost)) return { ok: false as const, reason: "host" as const };

  const originHeader = request.headers.get("origin");
  if (!originHeader) return { ok: true as const, origin: null };
  const origin = normalizeOrigin(originHeader);
  if (!origin || !allowedBrowserOrigins().has(origin)) return { ok: false as const, reason: "origin" as const };
  return { ok: true as const, origin };
}

function appendVary(headers: Headers, value: string) {
  const values = new Set((headers.get("Vary") || "").split(",").map((item) => item.trim()).filter(Boolean));
  values.add(value);
  headers.set("Vary", [...values].join(", "));
}

export function applyMcpCors(headers: Headers, origin: string | null) {
  appendVary(headers, "Origin");
  if (origin) headers.set("Access-Control-Allow-Origin", origin);
  else headers.delete("Access-Control-Allow-Origin");
  headers.set("Access-Control-Expose-Headers", "Mcp-Session-Id, WWW-Authenticate");
}

export function forbiddenMcpRequest(reason: "host" | "origin") {
  return Response.json(
    { error: "invalid_request", error_description: `Unapproved MCP ${reason}.` },
    { status: 403, headers: { "Cache-Control": "no-store" } },
  );
}
