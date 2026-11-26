import Link from "next/link";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth-server";
import { deletionSchemas } from "@/lib/account-deletion";
import { DeleteAccountForm } from "./delete-account-form";

export const metadata = { title: "Account settings | OpenOak" };

export default async function SettingsPage() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/login");
  const enabled = Boolean(deletionSchemas(process.env.ACCOUNT_DELETION_SCHEMAS));
  return <main className="mx-auto min-h-dvh max-w-2xl px-5 py-10 text-white">
    <Link href="/apps" className="underline">My apps</Link>
    <h1 className="mt-8 text-3xl font-semibold">Account settings</h1>
    <p className="mt-3 break-words">{session.user.email}</p>
    <section className="mt-10 rounded-2xl border border-red-300/40 p-5" aria-labelledby="delete-account-title">
      <h2 id="delete-account-title" className="text-xl font-semibold">Delete account and data</h2>
      <p className="mt-3">This permanently deletes your account, notes, owned boards and lists, tasks you created, deleted items, settings and memberships. Other people will lose access to content you own. AI connections and all sessions will end.</p>
      <p className="mt-3">This cannot be undone. Export any data you want to keep first. Copies already held by other people or AI services are outside OpenOak. Protected backups expire under the service’s retention policy.</p>
      {enabled ? <DeleteAccountForm email={session.user.email} /> : <p className="mt-5">For this installation, request deletion at <a href="mailto:openoaksoftware@proton.me" className="underline">openoaksoftware@proton.me</a>.</p>}
    </section>
  </main>;
}
