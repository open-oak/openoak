import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { MAX_IMPORT_BYTES } from "@/lib/todo-import";

const mocks = {
  getSession: vi.fn(),
  ensureTodoProfile: vi.fn(),
  applyImport: vi.fn(),
};

vi.doMock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.doMock("@/lib/auth-server", () => ({ auth: { api: { getSession: mocks.getSession } } }));
vi.doMock("@/lib/auth", () => ({ ensureTodoProfile: mocks.ensureTodoProfile }));
vi.doMock("@/lib/todo-import-server", () => ({ applyImport: mocks.applyImport }));

const route = await import("@/app/api/import/route");

function request(body: unknown, headers: Record<string, string> = {}) {
  return new NextRequest("https://todo.openoak.org/api/import", {
    method: "POST",
    body: typeof body === "string" || body instanceof ReadableStream ? body : JSON.stringify(body),
    headers: { host: "todo.openoak.org", origin: "https://todo.openoak.org", "content-type": "application/json", ...headers },
  });
}

describe("POST /api/import", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getSession.mockResolvedValue({ user: { id: "user-1" } });
    mocks.ensureTodoProfile.mockResolvedValue({ id: "user-1" });
    mocks.applyImport.mockResolvedValue({ tasksImported: 1 });
  });

  it("imports pasted text for the signed-in user", async () => {
    const response = await route.POST(request({ kind: "text", content: "Buy milk", listName: "Inbox" }));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ summary: { tasksImported: 1 } });
    const [userId, document] = mocks.applyImport.mock.calls[0];
    expect(userId).toBe("user-1");
    expect(document.lists[0]).toMatchObject({ name: "Inbox", tasks: [expect.objectContaining({ title: "Buy milk" })] });
  });

  it("rejects cross-site requests before reading the session", async () => {
    const response = await route.POST(request({ kind: "text", content: "x" }, { origin: "https://evil.example" }));
    expect(response.status).toBe(403);
    expect(mocks.getSession).not.toHaveBeenCalled();
  });

  it("requires a session", async () => {
    mocks.getSession.mockResolvedValue(null);
    expect((await route.POST(request({ kind: "text", content: "x" }))).status).toBe(401);
  });

  it("returns a readable error for unsupported files", async () => {
    const response = await route.POST(request({ kind: "file", filename: "x.json", content: "{\"hello\":1}" }));
    expect(response.status).toBe(422);
    expect((await response.json()).error).toMatch(/Microsoft To Do export/);
    expect(mocks.applyImport).not.toHaveBeenCalled();
  });

  it("rejects malformed and oversized bodies", async () => {
    expect((await route.POST(request("not json"))).status).toBe(400);
    expect((await route.POST(request({ kind: "other", content: "x" }))).status).toBe(400);
    expect((await route.POST(request({ kind: "text", content: "x".repeat(4 * 1024 * 1024 + 5000) }))).status).toBe(413);
  });

  it("decodes multibyte characters split across chunks", async () => {
    const prefix = '{"kind":"text","content":"Buy ';
    const bytes = new TextEncoder().encode(`${prefix}🍎"}`);
    const split = prefix.length + 1;
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(bytes.subarray(0, split));
        controller.enqueue(bytes.subarray(split));
        controller.close();
      },
    });

    expect((await route.POST(request(stream))).status).toBe(200);
    expect(mocks.applyImport.mock.calls[0][1].lists[0].tasks[0].title).toBe("Buy 🍎");
  });

  it("stops reading an oversized multibyte body even when the header reports fewer bytes", async () => {
    const chunk = new TextEncoder().encode("🍎".repeat(MAX_IMPORT_BYTES / 8));
    const cancel = vi.fn();
    const pull = vi.fn((controller: ReadableStreamDefaultController<Uint8Array>) => {
      controller.enqueue(chunk);
      if (pull.mock.calls.length === 4) controller.close();
    });
    const stream = new ReadableStream({ pull, cancel }, { highWaterMark: 0 });

    expect((await route.POST(request(stream, { "content-length": "1" }))).status).toBe(413);
    expect(pull).toHaveBeenCalledTimes(3);
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(mocks.applyImport).not.toHaveBeenCalled();
  });
});
