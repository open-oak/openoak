import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { createMcpHandler, generateProtectedResourceMetadata } from "mcp-handler";
import { OPENOAK_OUTPUT_SCHEMAS, registerOpenOakTools } from "../lib/register-tools.ts";

const appRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const registrySource = readFileSync(join(appRoot, "lib/register-tools.ts"), "utf8");

const expectedTools = [
  "openoak_connection_status",
  "openoak_search",
  "outline_list_folders",
  "outline_create_folder",
  "outline_update_folder",
  "outline_delete_folder",
  "outline_list_notes",
  "outline_get_note",
  "outline_create_note",
  "outline_update_note",
  "outline_delete_note",
  "kanban_v2_list_boards",
  "kanban_v2_list_lists",
  "kanban_v2_list_cards",
  "kanban_v2_get_card",
  "kanban_v2_read_card_details",
  "kanban_v2_read_detail_chunk",
  "kanban_v2_get_changes",
  "kanban_v2_list_archive",
  "kanban_v2_list_trash",
  "kanban_v2_apply_operation",
  "kanban_list_boards",
  "kanban_get_board",
  "kanban_list_cards",
  "kanban_get_card",
  "kanban_create_board",
  "kanban_update_board",
  "kanban_delete_board",
  "kanban_create_list",
  "kanban_update_list",
  "kanban_delete_list",
  "kanban_create_card",
  "kanban_update_card",
  "kanban_move_card",
  "kanban_delete_card",
  "todo_list_lists",
  "todo_create_list",
  "todo_update_list",
  "todo_delete_list",
  "todo_list_tasks",
  "todo_get_task",
  "todo_create_task",
  "todo_update_task",
  "todo_delete_task",
  "todo_create_subtask",
  "todo_update_subtask",
  "todo_delete_subtask",
];

test("the public registry contains the legacy tools and explicit modular reads", () => {
  const actual = [...registrySource.matchAll(/\n\s{4}"((?:openoak|outline|kanban|todo)_[a-z0-9_]+)",/g)].map((match) => match[1]);
  assert.deepEqual(actual, expectedTools);
  assert.deepEqual(Object.keys(OPENOAK_OUTPUT_SCHEMAS), expectedTools);
});

function modernBody(id, method, params = {}) {
  return {
    jsonrpc: "2.0",
    id,
    method,
    params: {
      ...params,
      _meta: {
        "io.modelcontextprotocol/protocolVersion": "2026-07-28",
        "io.modelcontextprotocol/clientCapabilities": {},
        "io.modelcontextprotocol/clientInfo": { name: "openoak-contract-test", version: "1" },
      },
    },
  };
}

async function modernCall(handler, id, method, params = {}, extraHeaders = {}) {
  return handler(new Request("https://mcp.openoak.org", {
    method: "POST",
    headers: {
      accept: "application/json",
      "content-type": "application/json",
      "mcp-method": method,
      "mcp-protocol-version": "2026-07-28",
      ...extraHeaders,
    },
    body: JSON.stringify(modernBody(id, method, params)),
  }));
}

async function authenticatedModernCall(handler, id, name, args = {}) {
  const request = new Request("https://mcp.openoak.org", {
    method: "POST",
    headers: {
      accept: "application/json",
      "content-type": "application/json",
      "mcp-method": "tools/call",
      "mcp-name": name,
      "mcp-protocol-version": "2026-07-28",
    },
    body: JSON.stringify(modernBody(id, "tools/call", { name, arguments: args })),
  });
  request.auth = {
    token: "not-logged",
    clientId: "contract-test",
    scopes: ["openoak:read", "openoak:write"],
    extra: { userId: "user-1", requestId: "request-1" },
  };
  return handler(request);
}

test("every tool publishes strict input and output schemas plus matching safety annotations", async () => {
  const handler = createMcpHandler(registerOpenOakTools, {
    serverInfo: { name: "openoak-test", version: "1" },
  });
  const response = await modernCall(handler, 1, "tools/list");
  assert.equal(response.status, 200);
  const payload = await response.json();
  const tools = payload.result.tools;
  assert.deepEqual(tools.map((tool) => tool.name), expectedTools);

  const reads = new Set([
    ...expectedTools.filter((name) => name.startsWith("kanban_v2_") && name !== "kanban_v2_apply_operation"),
    "openoak_connection_status",
    "openoak_search",
    "outline_list_folders",
    "outline_list_notes",
    "outline_get_note",
    "kanban_list_boards",
    "kanban_get_board",
    "kanban_list_cards",
    "kanban_get_card",
    "todo_list_lists",
    "todo_list_tasks",
    "todo_get_task",
  ]);
  const deletes = new Set(expectedTools.filter((name) => name.includes("_delete_") || name === "kanban_v2_apply_operation"));
  const creates = new Set(expectedTools.filter((name) => name.includes("_create_")));

  for (const tool of tools) {
    const name = tool.name;
    assert.equal(tool.inputSchema.additionalProperties, false, `${name} input must reject unknown fields`);
    assert.equal(tool.outputSchema.additionalProperties, false, `${name} output must reject unknown fields`);
    if (reads.has(name)) {
      assert.deepEqual(tool.annotations, {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      });
    } else if (deletes.has(name)) {
      assert.equal(tool.annotations.destructiveHint, true);
      assert.equal(tool.annotations.readOnlyHint, false);
    } else if (creates.has(name)) {
      assert.equal(tool.annotations.idempotentHint, false);
      assert.equal(tool.annotations.readOnlyHint, false);
    } else {
      assert.equal(tool.annotations.idempotentHint, true);
      assert.equal(tool.annotations.readOnlyHint, false);
    }
  }
});

test("connection status validates and returns no account identity or private content", async () => {
  const handler = createMcpHandler(registerOpenOakTools, { serverInfo: { name: "openoak-test", version: "1" } });
  const response = await authenticatedModernCall(handler, 2, "openoak_connection_status");
  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.deepEqual(payload.result.structuredContent.products, ["outline", "kanban", "todo"]);
  assert.deepEqual(payload.result.structuredContent.scopes, ["openoak:read", "openoak:write"]);
  assert.equal(payload.result.structuredContent.status, "connected");
  assert.equal(payload.result.structuredContent.userId, undefined);
  assert.equal(payload.result.structuredContent.email, undefined);
});

test("the protected resource metadata names the Account issuer and suite scopes", () => {
  const metadata = generateProtectedResourceMetadata({
    authServerUrls: ["https://account.openoak.org"],
    resourceUrl: "https://mcp.openoak.org",
    additionalMetadata: {
      resource_name: "OpenOak MCP",
      resource_documentation: "https://openoak.org/mcp",
      scopes_supported: ["openoak:read", "openoak:write"],
    },
  });
  assert.equal(metadata.resource, "https://mcp.openoak.org");
  assert.deepEqual(metadata.authorization_servers, ["https://account.openoak.org"]);
  assert.deepEqual(metadata.scopes_supported, ["openoak:read", "openoak:write"]);
  assert.equal(metadata.resource_documentation, "https://openoak.org/mcp");
});

test("the unpublished registry record is versioned and points only to the hosted HTTP server", () => {
  const record = JSON.parse(readFileSync(join(appRoot, "server.json"), "utf8"));
  assert.equal(record.$schema, "https://static.modelcontextprotocol.io/schemas/2025-12-11/server.schema.json");
  assert.equal(record.name, "org.openoak/openoak");
  assert.equal(record.version, "0.1.0");
  assert.deepEqual(record.remotes, [{ type: "streamable-http", url: "https://mcp.openoak.org" }]);
  assert.equal(record.packages, undefined);
});

test("mcp-handler serves current discovery and the 2025-11-25 stateless compatibility path", async () => {
  const handler = createMcpHandler(() => {}, { serverInfo: { name: "openoak-test", version: "1" } });
  const modern = await modernCall(handler, 1, "server/discover");
  assert.equal(modern.status, 200);
  assert.deepEqual((await modern.json()).result.supportedVersions, ["2026-07-28"]);

  const legacy = await handler(new Request("https://mcp.openoak.org", {
    method: "POST",
    headers: {
      accept: "application/json, text/event-stream",
      "content-type": "application/json",
      "mcp-protocol-version": "2025-11-25",
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 2,
      method: "initialize",
      params: {
        protocolVersion: "2025-11-25",
        capabilities: {},
        clientInfo: { name: "test", version: "1" },
      },
    }),
  }));
  assert.equal(legacy.status, 200);
  assert.match(await legacy.text(), /"protocolVersion":"2025-11-25"/);
});

test("modern requests reject routing header and body mismatches", async () => {
  const handler = createMcpHandler(registerOpenOakTools, { serverInfo: { name: "openoak-test", version: "1" } });
  const response = await modernCall(
    handler,
    3,
    "tools/call",
    { name: "openoak_connection_status", arguments: {} },
    { "mcp-name": "todo_get_task" },
  );
  assert.ok(response.status >= 400);
  assert.doesNotMatch(await response.text(), /OpenOak is connected/);
});

test("the MCP handler is mounted only at the dedicated domain root", () => {
  assert.equal(existsSync(join(appRoot, "app/route.ts")), true);
  assert.equal(existsSync(join(appRoot, "app/mcp/route.ts")), false);
  assert.equal(existsSync(join(appRoot, "app/health/route.ts")), true);
});
