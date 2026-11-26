import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = resolve(__dirname, "..");
const page = readFileSync(resolve(root, "app/i/[token]/page.tsx"), "utf8");
const form = readFileSync(resolve(root, "app/i/[token]/invite-accept-form.tsx"), "utf8");
const actions = readFileSync(resolve(root, "app/sharing-actions.ts"), "utf8");
const preview = readFileSync(resolve(root, "lib/todo-invite-preview.ts"), "utf8");
const proxy = readFileSync(resolve(root, "proxy.ts"), "utf8");

describe("Todo invite flow contract", () => {
  it("keeps invite preview public and free of membership mutations", () => {
    expect(proxy).toContain('pathname.startsWith("/i/")');
    expect(page).toContain("getTodoInvitePreview(token)");
    expect(page).toContain("auth.api.getSession");
    expect(page).not.toContain("acceptTodoInvite(token)");
  });

  it("preserves the invite through standalone and hosted sign-in", () => {
    expect(page).toContain('const invitePath = `/i/${encodeURIComponent(token)}`');
    expect(page).toContain('`/login?redirect=${encodeURIComponent(invitePath)}`');
    expect(page).toContain("login.searchParams.set(\"redirect\", target.toString())");
  });

  it("joins only from the explicit authenticated POST action", () => {
    expect(form).toContain("<form");
    expect(form).toContain("acceptTodoInvite(token)");
    expect(form).toMatch(/<Button type="submit"/);
    const acceptAction = actions.slice(
      actions.indexOf("export async function acceptTodoInvite"),
    );
    expect(acceptAction.indexOf("verifyTodoInviteToken(token)"))
      .toBeLessThan(acceptAction.indexOf("ensureTodoProfile()"));
  });

  it("uses the same generic failure for invalid, disabled, and unauthorized invites", () => {
    expect(actions).toContain("const unavailable = { ok: false, error: genericUnavailableMessage }");
    expect(actions).toContain("if (!claims) return unavailable");
    expect(actions).toContain("if (!result) return unavailable");
    expect(page).toContain("This invite is unavailable.");
  });

  it("previews only enabled custom lists with the current nonce", () => {
    expect(preview).toContain('kind: "CUSTOM"');
    expect(preview).toContain("inviteEnabled: true");
    expect(preview).toContain("inviteNonce: claims.nonce");
  });

  it("emits the opaque nonce directly in the compact invite path", () => {
    expect(actions).toContain('`/i/${encodeURIComponent(nonce)}`');
    expect(actions).not.toContain("createTodoInviteToken");
  });
});
