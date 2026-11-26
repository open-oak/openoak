import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth-server";
import { OAuthConsentForm } from "./consent-form";

export default async function OAuthConsentPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const requestHeaders = await headers();
  const session = await auth.api.getSession({ headers: requestHeaders });
  const query = await searchParams;
  const clientId = typeof query.client_id === "string" ? query.client_id : "";
  const scope = typeof query.scope === "string" ? query.scope : "";

  if (!session) {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(query)) {
      if (typeof value === "string") params.set(key, value);
      else value?.forEach((item) => params.append(key, item));
    }
    redirect(`/login?${params}`);
  }
  if (!clientId) redirect("/apps");

  const client = await auth.api.getOAuthClientPublic({
    headers: requestHeaders,
    query: { client_id: clientId },
  });

  return (
    <OAuthConsentForm
      clientId={clientId}
      clientName={client.client_name || "AI client"}
      clientUri={client.client_uri}
      requestedScopes={scope.split(/\s+/).filter(Boolean)}
    />
  );
}
