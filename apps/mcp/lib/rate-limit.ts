import { createHash } from "node:crypto";

type Bucket = { count: number; resetAt: number };
const buckets = new Map<string, Bucket>();

function positiveInteger(value: string | undefined, fallback: number) {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function mode() {
  return process.env.MCP_RATE_LIMIT_MODE === "enforce" ? "enforce" : "observe";
}

function pseudonymousKey(request: Request) {
  const userId = typeof request.auth?.extra?.userId === "string" ? request.auth.extra.userId : "unknown";
  const clientId = request.auth?.clientId || "unknown";
  return createHash("sha256").update(`${clientId}\0${userId}`).digest("base64url").slice(0, 24);
}

export function checkMcpRateLimit(request: Request, isWrite: boolean, now = Date.now()) {
  const limit = positiveInteger(
    isWrite ? process.env.MCP_WRITE_RATE_LIMIT_PER_MINUTE : process.env.MCP_READ_RATE_LIMIT_PER_MINUTE,
    isWrite ? 90 : 240,
  );
  const key = `${isWrite ? "write" : "read"}:${pseudonymousKey(request)}`;
  const current = buckets.get(key);
  const bucket = !current || current.resetAt <= now
    ? { count: 0, resetAt: now + 60_000 }
    : current;
  bucket.count += 1;
  buckets.set(key, bucket);

  if (buckets.size > 5_000) {
    for (const [bucketKey, candidate] of buckets) {
      if (candidate.resetAt <= now) buckets.delete(bucketKey);
    }
  }

  const exceeded = bucket.count > limit;
  return {
    allowed: !exceeded || mode() !== "enforce",
    exceeded,
    mode: mode(),
    limit,
    remaining: Math.max(0, limit - bucket.count),
    retryAfterSeconds: Math.max(1, Math.ceil((bucket.resetAt - now) / 1_000)),
  };
}

export function resetMcpRateLimitsForTests() {
  buckets.clear();
}
