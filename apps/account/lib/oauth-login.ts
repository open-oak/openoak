type LoginSearchParams =
  | Pick<URLSearchParams, "get">
  | Record<string, string | string[] | undefined>;

type SignInRedirect = {
  redirect?: boolean;
  url?: string | null;
} | null | undefined;

const oauthLoginMarkers = ["client_id", "exp", "ba_iat", "ba_param", "sig"];

function isSearchParamsReader(
  searchParams: LoginSearchParams,
): searchParams is Pick<URLSearchParams, "get"> {
  return typeof (searchParams as { get?: unknown }).get === "function";
}

function readSearchParam(searchParams: LoginSearchParams, name: string) {
  if (isSearchParamsReader(searchParams)) {
    return searchParams.get(name);
  }

  const value = searchParams[name];
  return Array.isArray(value) ? value[0] : value;
}

/** Detects the signed authorization query added by the OAuth provider. */
export function hasOAuthLoginContinuation(searchParams: LoginSearchParams) {
  return oauthLoginMarkers.every((name) => Boolean(readSearchParam(searchParams, name)));
}

/**
 * Returns undefined for a normal account login, null for a malformed OAuth
 * continuation, and the provider-owned destination for a valid continuation.
 */
export function getOAuthLoginDestination(
  searchParams: LoginSearchParams,
  result: SignInRedirect,
) {
  if (!hasOAuthLoginContinuation(searchParams)) return undefined;
  if (result?.redirect !== true || typeof result.url !== "string" || !result.url) return null;
  return result.url;
}
