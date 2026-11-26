import { z } from "zod";
import { auth } from "@/lib/auth-server";
import { centralPrisma } from "@/lib/central-prisma";
import { acceptBoardInvite, changeBoardSharing, getBoardSharing } from "@/lib/kanban-sharing";
import { kanbanErrorResponse } from "@/lib/kanban-v2-http";

export const runtime = "nodejs";
const input = z.discriminatedUnion("action", [
  z.object({ action: z.literal("join"), token: z.string().regex(/^[A-Za-z0-9_-]{24}$/) }).strict(),
  z.object({ action: z.enum(["enable", "rotate", "disable", "leave"]), boardKey: z.string().min(1).max(200) }).strict(),
  z.object({ action: z.literal("remove"), boardKey: z.string().min(1).max(200), memberId: z.string().min(1).max(200) }).strict(),
]);
async function actor(request: Request) {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session?.user.id) return Response.json({ error: { message: "Sign in to OpenKanban." } }, { status: 401 });
  if (request.headers.get("x-openkanban-account") !== session.user.id) return Response.json({ error: { message: "Your signed-in account changed. Reload before continuing." } }, { status: 403 });
  return session.user.id;
}
export async function GET(request: Request) {
  const id = await actor(request); if (id instanceof Response) return id;
  const params = new URL(request.url).searchParams;
  const boardKey = params.get("boardKey"), after = params.get("after") ?? "";
  if (!boardKey || boardKey.length > 200 || after.length > 200) return Response.json({ error: { message: "Invalid board." } }, { status: 400 });
  try {
    const sharing = await getBoardSharing(id, boardKey, undefined, after);
    const users = await centralPrisma.user.findMany({ where: { id: { in: [sharing.ownerId, ...sharing.members] } }, select: { id: true, name: true } });
    const person = (userId: string) => ({ id: userId, name: users.find((user) => user.id === userId)?.name || "OpenOak member" });
    return Response.json({ ...sharing, owner: person(sharing.ownerId), members: sharing.members.map(person) }, { headers: { "cache-control": "no-store" } });
  } catch (error) { return kanbanErrorResponse(error); }
}
export async function POST(request: Request) {
  const id = await actor(request); if (id instanceof Response) return id;
  if (request.headers.get("origin") !== new URL(request.url).origin) return Response.json({ error: { message: "Cross-origin writes are not allowed." } }, { status: 403 });
  if (!request.headers.get("content-type")?.startsWith("application/json")) return Response.json({ error: { message: "Use application/json." } }, { status: 415 });
  const reader = request.body?.getReader();
  if (!reader) return Response.json({ error: { message: "Missing action." } }, { status: 400 });
  try {
    const chunks: Uint8Array[] = []; let size = 0;
    for (;;) {
      const { value, done } = await reader.read(); if (done) break;
      size += value.byteLength;
      if (size > 4096) { await reader.cancel(); return Response.json({ error: { message: "Action too large." } }, { status: 413 }); }
      chunks.push(value);
    }
    let body: unknown;
    try { body = JSON.parse(Buffer.concat(chunks).toString("utf8")); } catch { body = null; }
    const parsed = input.safeParse(body);
    if (!parsed.success) return Response.json({ error: { message: "Invalid sharing action." } }, { status: 400 });
    const data = parsed.data;
    const result = data.action === "join" ? await acceptBoardInvite(id, data.token)
      : await changeBoardSharing(id, data.boardKey, data.action, data.action === "remove" ? data.memberId : undefined);
    return Response.json(result, { headers: { "cache-control": "no-store" } });
  } catch (error) { return kanbanErrorResponse(error); }
}
