import { NextRequest, NextResponse } from "next/server";
import { getSidebarData, getTaskView } from "@/app/actions";
import { auth } from "@/lib/auth-server";
import type { SortDirection, SortOption, TaskPageScope } from "@/lib/types";
import { createTodoSyncEtag } from "@/lib/todo-sync-server";

export const dynamic = "force-dynamic";

function parseRequest(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const scopeValue = params.get("scope");
  let scope: TaskPageScope;
  if (scopeValue === "list") {
    const listId = params.get("listId");
    if (!listId || listId.length > 128) return null;
    scope = { kind: "list", listId };
  } else if (scopeValue === "my-day" || scopeValue === "important" || scopeValue === "planned" || scopeValue === "tasks") {
    scope = { kind: scopeValue };
  } else return null;

  const sortValue = params.get("sort");
  const directionValue = params.get("direction");
  if (!(["created", "alpha", "importance", "due", "custom"] as const).includes(sortValue as SortOption)) return null;
  if (directionValue !== "asc" && directionValue !== "desc") return null;
  const activeCursor = params.get("activeCursor");
  const completedCursor = params.get("completedCursor");
  if ((activeCursor?.length || 0) > 256 || (completedCursor?.length || 0) > 256) return null;

  return {
    scope,
    sort: sortValue as SortOption,
    direction: directionValue as SortDirection,
    activeCursor,
    completedCursor,
  };
}

const responseHeaders = {
  "Cache-Control": "private, no-cache, no-store, max-age=0, must-revalidate",
  "Vary": "Cookie",
};

export async function GET(request: NextRequest) {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: responseHeaders });
  const input = parseRequest(request);
  if (!input) return NextResponse.json({ error: "Invalid sync request" }, { status: 400, headers: responseHeaders });

  const [sidebar, taskView] = await Promise.all([
    getSidebarData(),
    getTaskView({
      scope: input.scope,
      sort: input.sort,
      direction: input.direction,
      activeCursor: input.activeCursor,
      completedCursor: input.completedCursor,
    }),
  ]);
  const payload = { ...sidebar, ...taskView, syncedAt: new Date().toISOString() };
  const body = JSON.stringify(payload);
  const etag = createTodoSyncEtag(payload);
  if (request.headers.get("if-none-match") === etag) {
    return new NextResponse(null, { status: 304, headers: { ...responseHeaders, ETag: etag } });
  }
  return new NextResponse(body, {
    status: 200,
    headers: { ...responseHeaders, ETag: etag, "Content-Type": "application/json; charset=utf-8" },
  });
}
