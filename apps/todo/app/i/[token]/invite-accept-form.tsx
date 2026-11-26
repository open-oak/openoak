"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { acceptTodoInvite } from "@/app/sharing-actions";
import { Button } from "@/components/ui/button";

export function InviteAcceptForm({ token }: { token: string }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  return (
    <form
      action={() => {
        setError(null);
        startTransition(async () => {
          const result = await acceptTodoInvite(token);
          if (!result.ok) {
            setError(result.error);
            return;
          }
          router.push(`/lists/${result.listId}`);
          router.refresh();
        });
      }}
      className="space-y-3"
    >
      <Button type="submit" className="w-full" disabled={pending}>
        {pending ? "Joining…" : "Join list"}
      </Button>
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    </form>
  );
}
