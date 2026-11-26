# MCP client compatibility gate

Run this gate against a Preview deployment with a dedicated test account before enforcing a new CSP/OAuth policy or declaring the tool contract stable. Never store the account password or access token here.

## Required procedure

For each client, open its connection settings and enter the MCP resource URL
for the deployment under test. Complete OAuth with the matching Account issuer.
See the [client setup guide](https://openoak.org/mcp/) for client controls.

1. Run `openoak_connection_status`.
2. List and search existing test data.
3. Create, update, move where applicable, and delete disposable Outline, Todo, and Kanban records.
4. Cause one safe concurrency conflict with a stale timestamp or revision and confirm it does not overwrite data.
5. Refresh or restart the client and confirm the connection survives through its refresh token.
6. Open `/connected-ai?tab=services` on the Account issuer for this deployment.
   Revoke the connection and confirm its next call fails.

## Result record

| Client family | Version | OAuth | Read | Write/delete | Conflict | Refresh | Revoke | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Codex / ChatGPT | Pending deployment | Pending | Pending | Pending | Pending | Pending | Pending | Public guide prepared |
| Claude Code / Desktop | Pending deployment | Pending | Pending | Pending | Pending | Pending | Pending | Public guide prepared |
| VS Code / Copilot | Pending deployment | Pending | Pending | Pending | Pending | Pending | Pending | Public guide prepared |
| Cursor desktop / CLI | Pending deployment | Pending | Pending | Pending | Pending | Pending | Pending | Public guide prepared |

Record exact client versions, whether a tool-catalog refresh or new task was required, and the smallest client-specific workaround. A workaround that requires an API key, local proxy, or manual OAuth registration fails this gate.
