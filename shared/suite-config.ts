type Environment = Record<string, string | undefined>;

function webUrl(value: string) {
  const url = new URL(value);
  if (!["https:", "http:"].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new Error("Suite URLs must be HTTP(S) URLs without credentials, queries or fragments.");
  return url.toString().replace(/\/$/, "");
}

export function suiteUrls(env: Environment = process.env) {
  return {
    home: webUrl(env.OPENOAK_HOME_URL || "https://openoak.org"),
    account: webUrl(env.OPENOAK_ACCOUNT_URL || env.NEXT_PUBLIC_ACCOUNT_URL || env.ACCOUNT_ISSUER_URL || "https://account.openoak.org"),
    todo: webUrl(env.OPENOAK_TODO_URL || "https://todo.openoak.org"),
    outline: webUrl(env.OPENOAK_OUTLINE_URL || "https://outline.openoak.org"),
    kanban: webUrl(env.OPENOAK_KANBAN_URL || "https://kanban.openoak.org"),
    mcp: webUrl(env.MCP_RESOURCE_URL || "https://mcp.openoak.org"),
  };
}

export function suiteTrustedOrigins(env: Environment = process.env) {
  const values = [...Object.values(suiteUrls(env)), env.BETTER_AUTH_URL, ...(env.AUTH_TRUSTED_ORIGINS || "").split(",")];
  return [...new Set(values.filter((value): value is string => Boolean(value?.trim())).map((value) => new URL(webUrl(value.trim())).origin))];
}
