import { prisma } from "./prisma";
import {
  CLAUDE_CODE_CLIENT_ID,
  CLAUDE_CODE_METADATA_REDIRECTS,
  isClaudeCodeRuntimeRedirect,
} from "./claude-code-redirect";

const MAX_RUNTIME_REDIRECTS = 16;

/**
 * Claude Code's signed metadata document declares a portless localhost
 * callback, while the CLI binds a random unprivileged port. Add only that
 * exact runtime URI to the already CIMD-validated client registration.
 */
export async function prepareClaudeCodeLoopbackRedirect(redirectUri: string) {
  const client = await prisma.oauthClient.findUnique({
    where: { clientId: CLAUDE_CODE_CLIENT_ID },
    select: {
      clientDiscoveryId: true,
      redirectUris: true,
      tokenEndpointAuthMethod: true,
    },
  });

  if (
    !client ||
    client.clientDiscoveryId !== "cimd" ||
    client.tokenEndpointAuthMethod !== "none" ||
    !client.redirectUris.some((uri) => CLAUDE_CODE_METADATA_REDIRECTS.has(uri)) ||
    !isClaudeCodeRuntimeRedirect(redirectUri)
  ) {
    return false;
  }

  if (client.redirectUris.includes(redirectUri)) return true;

  const documentRedirects = client.redirectUris.filter((uri) => !isClaudeCodeRuntimeRedirect(uri));
  const recentRuntimeRedirects = client.redirectUris
    .filter(isClaudeCodeRuntimeRedirect)
    .slice(-(MAX_RUNTIME_REDIRECTS - 1));

  await prisma.oauthClient.update({
    where: { clientId: CLAUDE_CODE_CLIENT_ID },
    data: {
      redirectUris: [...new Set([...documentRedirects, ...recentRuntimeRedirects, redirectUri])],
    },
  });
  return true;
}
