# MCP performance and rate-limit operation

## Latency check

Use a short-lived full-access token belonging only to the dedicated MCP test account:

```sh
MCP_BENCHMARK_TOKEN=... npm --workspace @openoak/mcp run benchmark
```

The benchmark takes 20 warm samples plus a first-call sample for discovery, connection status, paginated reads, and search. Set `MCP_BENCHMARK_OUTLINE_NOTE_ID` to include a detailed read. Disposable writes are opt-in with `MCP_BENCHMARK_ALLOW_WRITES=true`; they create and immediately delete notes in the test account.

The enforced budgets are 300 ms for discovery, 1 second for connection status, 1.5 seconds for reads/search, 2 seconds for mutations, and 3 seconds for each observed first call. Preserve the JSON or table output with the client-compatibility record when making a release decision.

## Staged rate limit

The server separates read and write request buckets by a pseudonymous hash of the authenticated user/client pair. Defaults are generous: 240 reads and 90 writes per minute per warm instance. Raw user identifiers are neither stored in the bucket key nor logged.

`MCP_RATE_LIMIT_MODE=observe` is the default. Review `rate_limit_observed` events after real traffic exists, then set `MCP_RATE_LIMIT_MODE=enforce` only if the normal client burst rate remains comfortably below the configured limits. This is intentionally best-effort per serverless instance; it adds no Redis or distributed session dependency.
