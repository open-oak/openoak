import { NextRequest, NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth-server";
import { ensureTodoProfile } from "@/lib/auth";
import {
  ImportFormatError,
  MAX_IMPORT_BYTES,
  parseImportFile,
  parsePlainText,
} from "@/lib/todo-import";
import { applyImport } from "@/lib/todo-import-server";
import { BodyTooLargeError, readLimitedText } from "../../../../../shared/read-limited-text";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const responseHeaders = { "Cache-Control": "private, no-store, max-age=0" };

function fail(error: string, status: number) {
  return NextResponse.json({ error }, { status, headers: responseHeaders });
}

function sameOrigin(request: NextRequest) {
  const origin = request.headers.get("origin");
  if (!origin) return request.headers.get("sec-fetch-site") === "same-origin";
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

type ImportRequest =
  | { kind: "file"; filename: string; content: string }
  | { kind: "text"; content: string; listName: string };

function parseBody(value: unknown): ImportRequest | null {
  if (!value || typeof value !== "object") return null;
  const body = value as Record<string, unknown>;
  if (typeof body.content !== "string") return null;
  if (body.kind === "file") {
    return { kind: "file", filename: typeof body.filename === "string" ? body.filename.slice(0, 255) : "", content: body.content };
  }
  if (body.kind === "text") {
    return { kind: "text", content: body.content, listName: typeof body.listName === "string" ? body.listName : "" };
  }
  return null;
}

export async function POST(request: NextRequest) {
  if (!sameOrigin(request)) return fail("Cross-site import requests are not allowed.", 403);
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session) return fail("Sign in to import tasks.", 401);
  if (!request.headers.get("content-type")?.includes("application/json")) return fail("Send the import as JSON.", 415);

  let body: ImportRequest | null = null;
  try {
    body = parseBody(JSON.parse(await readLimitedText(request, MAX_IMPORT_BYTES + 4096)));
  } catch (error) {
    if (error instanceof BodyTooLargeError) return fail("The import is too large. The limit is 4 MB.", 413);
  }
  if (!body) return fail("The import request is not valid.", 400);

  let document;
  try {
    document = body.kind === "file"
      ? parseImportFile(body.filename, body.content)
      : parsePlainText(body.content, body.listName);
  } catch (error) {
    if (error instanceof ImportFormatError) return fail(error.message, 422);
    throw error;
  }

  const user = await ensureTodoProfile();
  try {
    const summary = await applyImport(user.id, document);
    revalidatePath("/", "layout");
    return NextResponse.json({ summary }, { headers: responseHeaders });
  } catch (error) {
    console.error("Todo import failed:", error);
    return fail("The import could not finish. Try again.", 500);
  }
}
