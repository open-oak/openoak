import Link from "next/link";
import { headers } from "next/headers";
import { auth } from "@/lib/auth-server";
import { accountUrl, usesSharedAuth } from "@/lib/auth-mode";
import { previewBoardInvite } from "@/lib/kanban-sharing";
import { Button } from "@/components/ui/button";
import { InviteAcceptForm } from "./invite-accept-form";

export const dynamic = "force-dynamic";
export default async function InvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const [preview, session] = await Promise.all([previewBoardInvite(token), auth.api.getSession({ headers: await headers() })]);
  const path = `/i/${encodeURIComponent(token)}`;
  const login = usesSharedAuth ? new URL("/login", accountUrl) : null;
  login?.searchParams.set("redirect", new URL(path, process.env.BETTER_AUTH_URL || "https://kanban.openoak.org").toString());
  return (
    <main className="flex min-h-dvh items-center justify-center bg-background p-4 text-foreground">
      <section className="w-full max-w-md rounded-2xl border border-border bg-card p-6 shadow-sm">
        <p className="text-sm font-medium text-muted-foreground">OpenKanban shared board</p>
        <h1 className="mt-2 text-2xl font-semibold">{preview?.name ?? "Invite unavailable"}</h1>
        <p className="mt-2 mb-6 text-sm text-muted-foreground">{preview ? "Join to view and edit the board together. The owner manages who has access." : "This link has expired or sharing has been turned off."}</p>
        {preview ? session ? <InviteAcceptForm token={token} accountId={session.user.id} />
          : <Button asChild className="w-full"><Link href={login?.toString() ?? `/login?redirect=${encodeURIComponent(path)}`}>Sign in to join</Link></Button>
          : <Button asChild variant="outline" className="w-full"><Link href="/">Open OpenKanban</Link></Button>}
      </section>
    </main>
  );
}
