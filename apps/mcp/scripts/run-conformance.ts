import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { dirname, join } from "node:path";
import { Readable } from "node:stream";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { createMcpHandler } from "mcp-handler";

process.env.DATABASE_URL ||= "postgresql://openoak_test:openoak_test@127.0.0.1:5432/openoak_test";

const { registerOpenOakTools } = await import("../lib/register-tools");
const { forbiddenMcpRequest, validateMcpRequestTarget } = await import("../lib/http-security");

const transport = createMcpHandler(registerOpenOakTools, {
  serverInfo: { name: "openoak-conformance", version: "0.1.0" },
  cacheHints: {
    "server/discover": { ttlMs: 300_000, cacheScope: "public" },
    "tools/list": { ttlMs: 300_000, cacheScope: "public" },
  },
  verboseLogs: false,
});

function requestUrl(request: IncomingMessage) {
  const host = request.headers.host || "localhost";
  return `http://${host}${request.url || "/"}`;
}

function toWebRequest(request: IncomingMessage) {
  const method = request.method || "GET";
  const init: RequestInit & { duplex?: "half" } = {
    method,
    headers: request.headers as HeadersInit,
  };
  if (!(method === "GET" || method === "HEAD")) {
    init.body = Readable.toWeb(request) as ReadableStream;
    init.duplex = "half";
  }
  return new Request(requestUrl(request), init);
}

async function writeResponse(response: Response, target: ServerResponse) {
  target.statusCode = response.status;
  response.headers.forEach((value, name) => target.setHeader(name, value));
  if (!response.body) {
    target.end();
    return;
  }
  Readable.fromWeb(response.body as never).pipe(target);
}

const server = createServer(async (incoming, outgoing) => {
  try {
    const request = toWebRequest(incoming);
    const validation = validateMcpRequestTarget(request);
    if (!validation.ok) {
      await writeResponse(forbiddenMcpRequest(validation.reason), outgoing);
      return;
    }
    if (request.method === "GET") {
      await writeResponse(new Response(null, { status: 204 }), outgoing);
      return;
    }
    await writeResponse(await transport(request), outgoing);
  } catch (error) {
    console.error(error);
    outgoing.statusCode = 500;
    outgoing.end();
  }
});

await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
const address = server.address();
if (!address || typeof address === "string") throw new Error("Could not start the conformance server.");
const url = `http://127.0.0.1:${address.port}`;
process.env.MCP_ALLOWED_HOSTS = `127.0.0.1:${address.port},localhost:${address.port}`;
process.env.MCP_ALLOWED_ORIGINS = `http://127.0.0.1:${address.port},http://localhost:${address.port}`;

const require = createRequire(import.meta.url);
const mode = process.argv[2] === "next" ? "next" : "stable";
const packageName = mode === "next"
  ? "@modelcontextprotocol/conformance-2026"
  : "@modelcontextprotocol/conformance";
const packageRoot = dirname(require.resolve(`${packageName}/package.json`));
const executable = join(packageRoot, "dist/index.js");
const scenarios = mode === "next"
  ? ["server-stateless", "tools-list", "dns-rebinding-protection", "caching"]
  : ["server-initialize", "ping", "tools-list", "dns-rebinding-protection"];

let failed = false;
try {
  for (const scenario of scenarios) {
    const args = [executable, "server", "--url", url, "--scenario", scenario];
    args.push("--spec-version", mode === "stable" ? "2025-11-25" : "2026-07-28");
    if (mode === "next") args.push("--force");
    const exitCode = await new Promise<number>((resolve) => {
      const child = spawn(process.execPath, args, { stdio: "inherit" });
      child.on("error", () => resolve(1));
      child.on("exit", (code) => resolve(code ?? 1));
    });
    if (exitCode !== 0) failed = true;
  }
} finally {
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}

if (failed) process.exitCode = 1;
