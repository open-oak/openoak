export const CLAUDE_CODE_CLIENT_ID = "https://claude.ai/oauth/claude-code-client-metadata";
export const CLAUDE_CODE_METADATA_REDIRECTS = new Set([
  "http://localhost/callback",
  "http://127.0.0.1/callback",
]);

export function isClaudeCodeRuntimeRedirect(uri: string) {
  try {
    const url = new URL(uri);
    const port = Number(url.port);
    return (
      url.protocol === "http:" &&
      url.hostname === "localhost" &&
      url.pathname === "/callback" &&
      url.search === "" &&
      url.hash === "" &&
      url.username === "" &&
      url.password === "" &&
      Number.isInteger(port) &&
      port >= 1024 &&
      port <= 65535
    );
  } catch {
    return false;
  }
}

export function readClaudeCodeLoopbackRedirect(request: Request) {
  const requestUrl = new URL(request.url);
  if (!requestUrl.pathname.endsWith("/oauth2/authorize")) return null;
  if (requestUrl.searchParams.get("client_id") !== CLAUDE_CODE_CLIENT_ID) return null;

  const redirectUri = requestUrl.searchParams.get("redirect_uri");
  return redirectUri && isClaudeCodeRuntimeRedirect(redirectUri) ? redirectUri : null;
}
