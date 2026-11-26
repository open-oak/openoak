import type { CallToolResult, ServerContext, ToolAnnotations } from "@modelcontextprotocol/server";
import { boundedV2Result } from "@openoak/kanban/mcp-v2";

export type OpenOakScope = "openoak:read" | "openoak:write";

export const readAnnotations: ToolAnnotations = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
};

export const createAnnotations: ToolAnnotations = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: false,
  openWorldHint: false,
};

export const updateAnnotations: ToolAnnotations = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
};

export const deleteAnnotations: ToolAnnotations = {
  readOnlyHint: false,
  destructiveHint: true,
  idempotentHint: true,
  openWorldHint: false,
};

function safeJson(value: unknown): Record<string, unknown> {
  const serialized = JSON.stringify(value);
  if (serialized === undefined) return {};
  const parsed = JSON.parse(serialized) as unknown;
  return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : { result: parsed };
}

function errorResult(error: unknown): CallToolResult {
  const candidate = error as { code?: unknown; message?: unknown; details?: unknown; name?: unknown };
  const code = typeof candidate.code === "string" ? candidate.code : "internal_error";
  const message = typeof candidate.message === "string" && code !== "internal_error"
    ? candidate.message
    : "The OpenOak operation could not be completed.";
  return {
    isError: true,
    content: [{ type: "text", text: `${code}: ${message}` }],
    structuredContent: safeJson({
      error: {
        code,
        message,
        ...(candidate.details && typeof candidate.details === "object" ? { details: candidate.details } : {}),
      },
    }),
  };
}

export async function runTool(
  toolName: string,
  requiredScope: OpenOakScope,
  context: ServerContext,
  operation: (userId: string) => Promise<unknown>,
  summarize: (result: Record<string, unknown>) => string,
): Promise<CallToolResult> {
  const startedAt = performance.now();
  const auth = context.http?.authInfo;
  const userId = typeof auth?.extra?.userId === "string" ? auth.extra.userId : "";
  const requestId = typeof auth?.extra?.requestId === "string" ? auth.extra.requestId : crypto.randomUUID();
  let outcome = "success";
  let errorClass: string | undefined;

  try {
    if (!userId) {
      const error = Object.assign(new Error("Authentication is required."), { code: "unauthorized" });
      throw error;
    }
    if (!auth?.scopes.includes(requiredScope)) {
      const error = Object.assign(new Error(`This tool requires ${requiredScope}.`), {
        code: "insufficient_scope",
        details: { requiredScope },
      });
      throw error;
    }
    const result = safeJson(await operation(userId));
    if (toolName.startsWith("kanban_v2_")) boundedV2Result(result);
    return {
      content: [{ type: "text", text: summarize(result) }],
      structuredContent: result,
    };
  } catch (error) {
    outcome = "error";
    const candidate = error as { code?: unknown; name?: unknown };
    errorClass = typeof candidate.code === "string"
      ? candidate.code
      : typeof candidate.name === "string"
        ? candidate.name
        : "Error";
    return errorResult(error);
  } finally {
    console.info(JSON.stringify({
      requestId,
      toolName,
      durationMs: Math.round((performance.now() - startedAt) * 100) / 100,
      outcome,
      ...(errorClass ? { errorClass } : {}),
    }));
  }
}
