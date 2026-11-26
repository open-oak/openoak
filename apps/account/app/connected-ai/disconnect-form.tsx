"use client";

import { useActionState } from "react";
import { revokeConnectedAiClient } from "./actions";
import styles from "./page.module.css";

export function DisconnectForm({ consentId, name }: { consentId: string; name: string }) {
  const [error, action, pending] = useActionState(async (_previous: string, formData: FormData) => {
    try {
      await revokeConnectedAiClient(formData);
      return "";
    } catch {
      return "Couldn’t disconnect this app. Please try again.";
    }
  }, "");

  return (
    <form action={action}>
      <input type="hidden" name="consentId" value={consentId} />
      <button className={styles.disconnect} type="submit" disabled={pending} aria-label={`Disconnect ${name}`}>
        {pending ? "Disconnecting…" : "Disconnect"}
      </button>
      {error && <p role="alert" className={styles.error}>{error}</p>}
    </form>
  );
}
