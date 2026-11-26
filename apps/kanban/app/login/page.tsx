import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { LocalAuthForm } from "@/components/local-auth-form";
import { auth } from "@/lib/auth-server";
import { accountUrl, usesSharedAuth } from "@/lib/auth-mode";

function safeRedirect(value: string | undefined) {
  return value?.startsWith("/") && !value.startsWith("//") ? value : "/";
}

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ redirect?: string }> }) {
  const { redirect: requestedRedirect } = await searchParams;
  if (usesSharedAuth) {
    const destination = new URL("/login", accountUrl);
    if (requestedRedirect) destination.searchParams.set("redirect", requestedRedirect);
    redirect(destination.toString());
  }
  const session = await auth.api.getSession({ headers: await headers() });
  if (session) redirect(safeRedirect(requestedRedirect));
  return <LocalAuthForm productName="OpenKanban" redirectTo={safeRedirect(requestedRedirect)} />;
}
