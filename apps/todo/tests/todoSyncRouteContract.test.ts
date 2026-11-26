import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = resolve(__dirname, "..");
const route = readFileSync(resolve(root, "app/api/sync/route.ts"), "utf8");
const client = readFileSync(resolve(root, "components/collaboration-sync.tsx"), "utf8");

describe("Todo polling transport contract", () => {
  it("returns deterministic cache validators without cacheable private data", () => {
    expect(route).toContain('request.headers.get("if-none-match")');
    expect(route).toContain("status: 304");
    expect(route).toMatch(/"Cache-Control": "[^"]*no-store[^"]*"/);
    expect(route).toContain('"Vary": "Cookie"');
    expect(route).toMatch(/\bETag:\s*etag/);
  });

  it("polls every 15 seconds and refreshes immediately on visibility/online changes", () => {
    expect(client).toContain("const POLL_INTERVAL_MS = 15_000");
    expect(client).toContain('document.addEventListener("visibilitychange"');
    expect(client).toContain('window.addEventListener("online"');
    expect(client).toContain('document.visibilityState !== "visible"');
  });

  it("does not duplicate the task view's initial revalidation", () => {
    const listenerSetup = client.indexOf('document.addEventListener("visibilitychange"');
    const cleanup = client.indexOf("return () =>", listenerSetup);
    const startup = client.slice(listenerSetup, cleanup);
    expect(startup).toContain("schedule();");
    expect(startup).not.toContain("void poll();");
    expect(route).toContain("getTaskView({");
  });

  it("handles unchanged, logged-out, offline, and unmounted requests explicitly", () => {
    expect(client).toContain("response.status === 304");
    expect(client).toContain("response.status === 401");
    expect(client).toContain("navigator.onLine");
    expect(client).toContain("controller?.abort()");
    expect(client).toContain("MAX_OFFLINE_BACKOFF_MS = 60_000");
  });
});
