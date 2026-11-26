import { auth } from "@/lib/auth-server";
import { kanbanReadResponse, kanbanOperationResponse } from "@/lib/kanban-v2-http";

export const runtime = "nodejs";
export async function GET(request: Request, context: { params: Promise<{ resource: string }> }) {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session?.user.id) return Response.json({ error: { code: "unauthorized", message: "Sign in to OpenKanban." } }, { status: 401 });
  if (request.headers.has("x-openkanban-account") && request.headers.get("x-openkanban-account") !== session.user.id) return Response.json({ error: { code: "account_changed", message: "Your signed-in account changed. Sign in with the original account to sync these edits." } }, { status: 403 });
  return kanbanReadResponse(session.user.id, (await context.params).resource, new URL(request.url).searchParams, undefined, request.headers.get("x-openkanban-capabilities")?.split(",").map((value) => value.trim()).includes("sharing") ?? false);
}

export async function POST(request: Request, context: { params: Promise<{ resource: string }> }) {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session?.user.id) return Response.json({ error: { code: "unauthorized", message: "Sign in to OpenKanban." } }, { status: 401 });
  if (request.headers.has("x-openkanban-account") && request.headers.get("x-openkanban-account") !== session.user.id) return Response.json({ error: { code: "account_changed", message: "Your signed-in account changed. Sign in with the original account to sync these edits." } }, { status: 403 });
  const resource = (await context.params).resource;
  if (!["operations", "imports"].includes(resource)) return Response.json({ error: { code: "not_found", message: "Unknown resource." } }, { status: 404 });
  return kanbanOperationResponse(session.user.id, request, undefined, resource === "imports");
}
