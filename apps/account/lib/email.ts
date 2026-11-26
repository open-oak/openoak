import { Resend } from "resend";
import {
  passwordChangedEmail,
  passwordResetEmail,
  type TransactionalEmail,
  verificationEmail,
} from "./email-templates.ts";

export const EMAIL_NOT_CONFIGURED = "Email is not configured on this server.";

let resend: Resend | null = null;

export function emailTransport(env: NodeJS.ProcessEnv = process.env) {
  switch (env.EMAIL_TRANSPORT) {
    case "log":
      return env.NODE_ENV === "development" ? { kind: "log" as const } : null;
    case "resend":
    case "":
    case undefined: {
      const apiKey = env.RESEND_API_KEY?.trim();
      return apiKey ? { kind: "resend" as const, apiKey } : null;
    }
    default:
      return null;
  }
}

async function deliver(
  to: string,
  email: TransactionalEmail,
  description: string,
  localActionUrl?: string,
) {
  const transport = emailTransport();
  if (!transport) throw new Error(EMAIL_NOT_CONFIGURED);
  if (transport.kind === "log") {
    if (localActionUrl) console.info(`OpenOak ${description} link: ${localActionUrl}`);
    return;
  }

  resend ??= new Resend(transport.apiKey);
  const { error } = await resend.emails.send({
    from: process.env.RESEND_FROM || "OpenOak <noreply@openoak.org>",
    to,
    subject: email.subject,
    html: email.html,
    text: email.text,
  });

  if (error) throw new Error(`Resend rejected the ${description} email: ${error.message}`);
}

export function deliverVerificationEmail(to: string, actionUrl: string) {
  return deliver(to, verificationEmail(actionUrl), "verification", actionUrl);
}

export function deliverPasswordResetEmail(to: string, actionUrl: string) {
  return deliver(to, passwordResetEmail(actionUrl), "password reset", actionUrl);
}

export function deliverPasswordChangedEmail(to: string, actionUrl: string) {
  return deliver(to, passwordChangedEmail(actionUrl), "password changed");
}
