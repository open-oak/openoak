const authorizationPaths = new Set([
  "/api/auth/oauth2/authorize",
  "/api/auth/oauth2/consent",
]);

function callbackShape(value: string) {
  try {
    const callback = new URL(value);
    return {
      hasCode: callback.searchParams.has("code"),
      hasError: callback.searchParams.has("error"),
      hasIssuer: callback.searchParams.has("iss"),
    };
  } catch {
    return null;
  }
}

function logIssuerGuard(
  path: string,
  channel: string,
  shape: ReturnType<typeof callbackShape>,
  applied: boolean,
) {
  if (process.env.NODE_ENV !== "production") return;
  console.info("oauth_issuer_response", {
    path,
    channel,
    hasCode: shape?.hasCode ?? false,
    hasError: shape?.hasError ?? false,
    hadIssuer: shape?.hasIssuer ?? false,
    applied,
  });
}

function callbackWithIssuer(value: string, issuer: string) {
  try {
    const callback = new URL(value);
    if (!callback.searchParams.has("code") && !callback.searchParams.has("error")) return null;
    callback.searchParams.set("iss", issuer);
    return callback.toString();
  } catch {
    return null;
  }
}

export async function ensureOAuthIssuerResponse(
  request: Request,
  response: Response,
  issuer: string,
) {
  const path = new URL(request.url).pathname;
  if (!authorizationPaths.has(path)) return response;

  const location = response.headers.get("location");
  const locationShape = location ? callbackShape(location) : null;
  const guardedLocation = location && callbackWithIssuer(location, issuer);
  if (guardedLocation && guardedLocation !== location) {
    logIssuerGuard(path, "location", locationShape, true);
    const headers = new Headers(response.headers);
    headers.set("location", guardedLocation);
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
  }

  if (!response.headers.get("content-type")?.includes("application/json")) {
    if (request.method === "POST") logIssuerGuard(path, "unhandled", locationShape, false);
    return response;
  }

  let body: unknown;
  try {
    body = await response.clone().json();
  } catch {
    logIssuerGuard(path, "unreadable-json", null, false);
    return response;
  }
  if (!body || typeof body !== "object") {
    logIssuerGuard(path, "non-object-json", null, false);
    return response;
  }

  const result = body as { redirect?: unknown; url?: unknown };
  if (result.redirect !== true || typeof result.url !== "string") {
    logIssuerGuard(path, "non-redirect-json", null, false);
    return response;
  }

  const resultShape = callbackShape(result.url);
  const guardedUrl = callbackWithIssuer(result.url, issuer);
  if (!guardedUrl || guardedUrl === result.url) {
    logIssuerGuard(path, "json", resultShape, false);
    return response;
  }

  logIssuerGuard(path, "json", resultShape, true);
  const headers = new Headers(response.headers);
  headers.delete("content-length");
  return Response.json(
    { ...result, url: guardedUrl },
    { status: response.status, statusText: response.statusText, headers },
  );
}
