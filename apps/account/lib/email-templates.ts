export type TransactionalEmail = {
  subject: string;
  html: string;
  text: string;
};

type ActionEmailOptions = {
  subject: string;
  preview: string;
  title: string;
  message: string;
  actionLabel: string;
  actionUrl: string;
  notice: string;
};

function escapeHtml(value: string) {
  return value.replace(/[&<>'"]/g, (character) => {
    const entities: Record<string, string> = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      "'": "&#39;",
      '"': "&quot;",
    };

    return entities[character];
  });
}

function actionEmail({
  subject,
  preview,
  title,
  message,
  actionLabel,
  actionUrl,
  notice,
}: ActionEmailOptions): TransactionalEmail {
  const safeSubject = escapeHtml(subject);
  const safePreview = escapeHtml(preview);
  const safeTitle = escapeHtml(title);
  const safeMessage = escapeHtml(message);
  const safeActionLabel = escapeHtml(actionLabel);
  const safeActionUrl = escapeHtml(actionUrl);
  const safeNotice = escapeHtml(notice);

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="color-scheme" content="light">
  <meta name="supported-color-schemes" content="light">
  <title>${safeSubject}</title>
</head>
<body style="margin:0;padding:0;background-color:#f4f1e9;color:#1c2f26;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;">
  <div style="display:none;font-size:1px;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;color:#f4f1e9;">${safePreview}</div>
  <table role="presentation" width="100%" border="0" cellspacing="0" cellpadding="0" style="width:100%;border-collapse:collapse;background-color:#f4f1e9;">
    <tr>
      <td align="center" style="padding:32px 16px;">
        <table role="presentation" width="100%" border="0" cellspacing="0" cellpadding="0" align="center" style="width:100%;max-width:560px;border-collapse:separate;background-color:#ffffff;border:1px solid #ded8ca;border-radius:16px;">
          <tr>
            <td style="padding:32px 28px;">
              <p style="margin:0 0 28px;font-size:20px;line-height:1.3;font-weight:700;color:#1c2f26;">🌳 OpenOak</p>
              <h1 style="margin:0 0 14px;font-size:26px;line-height:1.25;font-weight:700;color:#1c2f26;">${safeTitle}</h1>
              <p style="margin:0 0 24px;font-size:16px;line-height:1.65;color:#43564b;">${safeMessage}</p>
              <table role="presentation" border="0" cellspacing="0" cellpadding="0" style="border-collapse:separate;">
                <tr>
                  <td align="center" bgcolor="#234c3b" style="border-radius:10px;background-color:#234c3b;">
                    <a href="${safeActionUrl}" style="display:inline-block;padding:13px 20px;border:1px solid #234c3b;border-radius:10px;color:#ffffff;font-size:15px;line-height:1.2;font-weight:700;text-decoration:none;">${safeActionLabel}</a>
                  </td>
                </tr>
              </table>
              <p style="margin:24px 0 0;font-size:13px;line-height:1.55;color:#596b61;">Or copy and paste this address:</p>
              <p style="margin:6px 0 0;font-size:13px;line-height:1.55;word-break:break-all;"><a href="${safeActionUrl}" style="color:#285844;text-decoration:underline;">${safeActionUrl}</a></p>
              <p style="margin:28px 0 0;padding-top:20px;border-top:1px solid #e6e0d5;font-size:13px;line-height:1.6;color:#596b61;">${safeNotice}</p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;

  const text = `🌳 OpenOak

${title}

${message}

${actionLabel}: ${actionUrl}

${notice}`;

  return { subject, html, text };
}

export function verificationEmail(actionUrl: string): TransactionalEmail {
  return actionEmail({
    subject: "Verify your OpenOak email",
    preview: "Verify your email address to finish creating your OpenOak account.",
    title: "Verify your email",
    message: "Use the link below to verify your email address. This link expires in one hour.",
    actionLabel: "Verify email",
    actionUrl,
    notice: "If you didn’t create an OpenOak account, you can ignore this email.",
  });
}

export function passwordResetEmail(actionUrl: string): TransactionalEmail {
  return actionEmail({
    subject: "Reset your OpenOak password",
    preview: "Reset your password using this secure link.",
    title: "Reset your password",
    message: "Use the link below to choose a new password. This link expires in one hour.",
    actionLabel: "Reset password",
    actionUrl,
    notice: "If you didn’t request a password reset, you can ignore this email. Your password has not changed.",
  });
}

export function passwordChangedEmail(actionUrl: string): TransactionalEmail {
  return actionEmail({
    subject: "Your OpenOak password was changed",
    preview: "The password for your OpenOak account was changed.",
    title: "Password changed",
    message: "The password for your OpenOak account was changed.",
    actionLabel: "Reset password",
    actionUrl,
    notice: "If you made this change, no action is needed. If you didn’t, reset your password now.",
  });
}
