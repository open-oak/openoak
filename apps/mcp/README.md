# OpenOak MCP

OpenOak exposes one stateless Streamable HTTP MCP resource:

```text
https://mcp.openoak.org
```

Use that exact URL in MCP clients. There is intentionally no `/mcp` alias. Health checks use `/health`, and OAuth protected-resource discovery uses `/.well-known/oauth-protected-resource`.

The service requires OAuth authorization code + PKCE. Request `openoak:read` for read/search tools and `openoak:write` for mutations. Existing-record mutations must use the `updatedAt` or Kanban `revision` returned by the latest read; conflicts are returned without overwriting newer data.

See [Self-hosting](../../docs/SELF_HOSTING.md#mcp) for the browser suite
and the current scope of self-host support.

## Deployment gates

Set the variables in `.env.example`, deploy Account with its additive OAuth
migration first, and then deploy this workspace as its own Vercel project with
the project root set to `apps/mcp`.

Remote PostgreSQL URLs use certificate and hostname verification by default.
Set `POSTGRES_SSL_CA` only when the account database uses a private CA;
`POSTGRES_SSL_MODE=disable` is accepted for loopback development only.

Vercel Firewall policy cannot be stored in `vercel.json`. Once the MCP project is linked, stage a generous per-IP POST limit in log-only mode:

```sh
vercel firewall rules add "Observe MCP POST volume" \
  --condition '{"type":"path","op":"eq","value":"/"}' \
  --condition '{"type":"method","op":"eq","value":"POST"}' \
  --action rate_limit \
  --rate-limit-window 60 \
  --rate-limit-requests 300 \
  --rate-limit-keys ip \
  --rate-limit-action log \
  --yes
```

Review the draft with `vercel firewall diff`. Publish and observe legitimate client traffic before changing the over-limit action from `log` to `rate_limit`; Firewall changes should follow the staged log → preview enforcement → production enforcement rollout.
