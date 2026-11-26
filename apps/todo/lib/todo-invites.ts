import { randomBytes } from "node:crypto";

const NONCE_BYTES = 18;
const INVITE_TOKEN_PATTERN = /^[A-Za-z0-9_-]{24,64}$/;

export interface TodoInviteClaims {
  nonce: string;
}

export function createInviteNonce() {
  return randomBytes(NONCE_BYTES).toString("base64url");
}

export function verifyTodoInviteToken(token: string): TodoInviteClaims | null {
  return INVITE_TOKEN_PATTERN.test(token) ? { nonce: token } : null;
}
