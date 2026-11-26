import Link from "next/link";
import { headers } from "next/headers";
import { auth } from "@/lib/auth-server";
import { accountUrl, usesSharedAuth } from "@/lib/auth-mode";
import { getTodoInvitePreview } from "@/lib/todo-invite-preview";
import { Button } from "@/components/ui/button";
import { InviteAcceptForm } from "./invite-accept-form";

export const dynamic = "force-dynamic";

function signInHref(token: string) {
  const invitePath = `/i/${encodeURIComponent(token)}`;
  if (!usesSharedAuth) return `/login?redirect=${encodeURIComponent(invitePath)}`;
  const target = new URL(invitePath, process.env.BETTER_AUTH_URL || "https://todo.openoak.org");
  const login = new URL("/login", accountUrl);
  login.searchParams.set("redirect", target.toString());
  return login.toString();
}
export default async function TodoInvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const [preview, session] = await Promise.all([
    getTodoInvitePreview(token),
    auth.api.getSession({ headers: await headers() }),
  ]);

  return (
    <main className="flex min-h-dvh items-center justify-center bg-background p-4 text-foreground">
      <section className="w-full max-w-md rounded-2xl border border-border bg-card p-6 shadow-sm">
        <p className="text-sm font-medium text-muted-foreground">OpenTodo shared list</p>
        {preview ? (
          <>
            <h1 className="mt-2 text-2xl font-semibold">{preview.name}</h1>
            <p className="mt-2 mb-6 text-sm text-muted-foreground">
              {preview.owner.displayName || preview.owner.email || "A list owner"} invited you to collaborate.
            </p>
            {session ? (
              <InviteAcceptForm token={token} />
            ) : (
              <Button asChild className="w-full">
                <Link href={signInHref(token)}>Sign in to join</Link>
              </Button>
            )}
          </>
        ) : (
          <>
            <h1 className="mt-2 text-2xl font-semibold">Invite unavailable</h1>
            <p className="mt-2 mb-6 text-sm text-muted-foreground">This invite is unavailable.</p>
            <Button asChild variant="outline" className="w-full"><Link href="/">Open OpenTodo</Link></Button>
          </>
        )}
      </section>
    </main>
  );
}
