import { describe, expect, it } from "vitest";
import {
  createInviteNonce,
  verifyTodoInviteToken,
} from "@/lib/todo-invites";

describe("Todo opaque invite tokens", () => {
  it("uses a compact 144-bit bearer token", () => {
    const token = createInviteNonce();
    expect(token).toMatch(/^[A-Za-z0-9_-]{24}$/);
    expect(verifyTodoInviteToken(token)).toEqual({ nonce: token });
  });

  it.each([
    "",
    "too-short",
    "v1.payload.signature",
    "contains a space----------------",
    "a".repeat(65),
  ])("rejects malformed token %s", (token) => {
    expect(verifyTodoInviteToken(token)).toBeNull();
  });

  it("creates a different token when an owner rotates the invite", () => {
    expect(createInviteNonce()).not.toBe(createInviteNonce());
  });
});
