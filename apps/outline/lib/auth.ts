import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "./auth-server";
import { loginUrl, usesSharedAuth } from "./auth-mode";

export async function requireSession() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    const appUrl = process.env.BETTER_AUTH_URL || "http://localhost:3000";
    const target = loginUrl(appUrl);
    if (usesSharedAuth) target.searchParams.set("redirect", appUrl);
    redirect(target.toString());
  }
  return session;
}
