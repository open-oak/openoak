import { isPublicRoutableHost } from "@better-auth/core/utils/host";
import { lookup } from "node:dns/promises";
import type { LookupAddress } from "node:dns";
import type { IncomingHttpHeaders } from "node:http";
import { request } from "node:https";
import { isIP, type LookupFunction } from "node:net";
import { Readable } from "node:stream";

const BODY_FORBIDDEN_RESPONSE_STATUSES = new Set([204, 205, 304]);

function responseHeaders(headers: IncomingHttpHeaders) {
  const result = new Headers();
  for (const [name, value] of Object.entries(headers)) {
    if (Array.isArray(value)) {
      for (const item of value) result.append(name, item);
    } else if (value !== undefined) {
      result.append(name, value);
    }
  }
  return result;
}

// Node 22 requests address arrays when auto-family selection is enabled. The
// upstream CIMD transport always returns the legacy single-address callback
// shape, which makes Node try to connect to an undefined address.
export function createPinnedLookup(pinnedAddress: LookupAddress): LookupFunction {
  return (_hostname, options, callback) => {
    if (options.all) {
      callback(null, [pinnedAddress]);
      return;
    }
    callback(null, pinnedAddress.address, pinnedAddress.family);
  };
}

/**
 * Fetch a CIMD-owned HTTPS resource with resolve-once DNS validation,
 * connection pinning, and redirect refusal.
 */
export async function fetchClientMetadataResource(input: RequestInfo | URL, init?: RequestInit) {
  const webRequest = new Request(input, init);
  const url = new URL(webRequest.url);

  if (url.protocol !== "https:") throw new TypeError("CIMD Node transport requires an HTTPS URL");
  if (webRequest.method !== "GET" && webRequest.method !== "HEAD") {
    throw new TypeError("CIMD Node transport supports only GET and HEAD");
  }

  const addresses = await lookup(url.hostname, { all: true, verbatim: true });
  if (addresses.length === 0) throw new TypeError("metadata hostname returned no DNS addresses");
  for (const result of addresses) {
    if (!isPublicRoutableHost(result.address)) {
      throw new TypeError("metadata hostname must resolve only to public-routable addresses");
    }
  }

  const pinnedAddress = addresses[0];
  const headers = Object.fromEntries(webRequest.headers.entries());
  headers.host = url.host;
  const signal = init?.signal ?? (input instanceof Request ? input.signal : webRequest.signal);

  return new Promise<Response>((resolve, reject) => {
    const metadataRequest = request(
      url,
      {
        agent: false,
        headers,
        method: webRequest.method,
        servername: isIP(url.hostname.replace(/^\[|\]$/g, "")) === 0 ? url.hostname : undefined,
        signal,
        lookup: createPinnedLookup(pinnedAddress),
      },
      (response) => {
        const status = response.statusCode ?? 500;
        const body =
          webRequest.method === "HEAD" || BODY_FORBIDDEN_RESPONSE_STATUSES.has(status)
            ? null
            : (Readable.toWeb(response) as ReadableStream<Uint8Array>);
        resolve(
          new Response(body, {
            headers: responseHeaders(response.headers),
            status,
            statusText: response.statusMessage,
          }),
        );
      },
    );
    metadataRequest.once("error", reject);
    metadataRequest.end();
  });
}
