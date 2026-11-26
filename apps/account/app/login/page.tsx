import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth-server";
import { hasOAuthLoginContinuation } from "@/lib/oauth-login";
import { LoginForm } from "./login-form";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [session, query] = await Promise.all([
    auth.api.getSession({ headers: await headers() }),
    searchParams,
  ]);

  if (session && !hasOAuthLoginContinuation(query)) {
    redirect("/apps");
  }

  return <>{query.deleted === "1" && <p role="status" className="mx-auto max-w-md p-5 text-center text-white">Your account and data have been deleted.</p>}<LoginForm /></>;
}
