import { suiteUrls } from "../../../../shared/suite-config";
import Link from "next/link";
import { headers } from "next/headers";
import { auth } from "@/lib/auth-server";
import { prisma } from "@/lib/prisma";
import { scopeLabels } from "@/lib/oauth-display";
import { DisconnectForm } from "./disconnect-form";
import { AiTabs } from "./ai-tabs";
import { SetupInstructions } from "./setup-instructions";
import styles from "./page.module.css";

const connectionDateFormat = new Intl.DateTimeFormat("en-GB", {
  day: "numeric", month: "short", year: "numeric",
  hour: "2-digit", minute: "2-digit", second: "2-digit",
  hourCycle: "h23", timeZone: "UTC", timeZoneName: "short",
});

export const metadata = { title: "AI connections | OpenOak" };

export default async function ConnectedAiPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const urls = suiteUrls();
  const session = await auth.api.getSession({ headers: await headers() });
  const query = await searchParams;

  const consents = session ? await prisma.oauthConsent.findMany({
    where: { userId: session.user.id },
    include: { client: { select: { name: true, uri: true, clientId: true } } },
    orderBy: { updatedAt: "desc" },
  }) : [];
  // A client can have several consent records. Disconnect revokes the whole client.
  const connections = Array.from(Map.groupBy(consents, (consent) => consent.clientId).values());

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <a className={styles.brand} href={urls.home}>OpenOak</a>
        <Link href={session ? "/apps" : "/login?redirect=%2Fconnected-ai%3Ftab%3Dservices"}>{session ? "My apps" : "Sign in"}</Link>
      </header>
      <main className={styles.main}>
        <p className={styles.eyebrow}>Your OpenOak account</p>
        <h1>AI connections</h1>
        <p className={styles.intro}>Set up your AI app or manage its access to your OpenOak notes, tasks and boards.</p>

        <AiTabs initialTab={query.tab === "services" ? "services" : "setup"} setup={<SetupInstructions />} services={<>
        <section className={styles.connections} aria-label="Connected apps">
          {!session ? (
            <div className={styles.empty}>
              <h2>Sign in to see your connections</h2>
              <p>Your connected AI services and their access are available in your OpenOak account.</p>
              <Link className={styles.primary} href="/login?redirect=%2Fconnected-ai%3Ftab%3Dservices">Sign in</Link>
            </div>
          ) : connections.length === 0 ? (
            <div className={styles.empty}>
              <h2>No AI apps connected yet</h2>
              <p>Connect an app to bring OpenTodo, OpenOutline and OpenKanban into your conversations. You’ll review its access before connecting.</p>
            </div>
          ) : connections.map((records) => {
            const consent = records[0];
            const name = consent.client.name?.trim() || "Unnamed AI app";
            const scopes = [...new Set(records.flatMap((record) => record.scopes))];
            const connectedAt = records.reduce<Date | null>((earliest, record) =>
              record.createdAt && (!earliest || record.createdAt < earliest) ? record.createdAt : earliest, null);
            return (
              <article key={consent.clientId} className={styles.connection}>
                <div className={styles.connectionHeader}>
                  <div>
                    <h2>{name}</h2>
                    <p className={styles.connectionDate}>
                      {connectedAt ? <>Connected <time dateTime={connectedAt.toISOString()}>{connectionDateFormat.format(connectedAt)}</time></> : "Connection date unavailable"}
                    </p>
                  </div>
                  <DisconnectForm consentId={consent.id} name={name} />
                </div>
                <p className={styles.accessLabel}>Access you approved</p>
                <ul className={styles.permissions}>
                  {scopes.map((scope) => <li key={scope}>{scopeLabels[scope] || `Additional permission: ${scope}`}</li>)}
                </ul>
                <details>
                  <summary>Connection details</summary>
                  <dl>
                    {consent.client.uri && <><dt>App address</dt><dd>{consent.client.uri}</dd></>}
                    <dt>Client ID</dt><dd>{consent.client.clientId}</dd>
                    <dt>Permission codes</dt><dd>{scopes.join(", ") || "None"}</dd>
                  </dl>
                </details>
              </article>
            );
          })}
        </section>
        {connections.length > 0 && <p className={styles.footnote}>Disconnecting ends an app’s access to OpenOak. Your notes, tasks and boards stay here. Information already copied into the AI app stays there.</p>}
        </>} />
      </main>
      <footer className={styles.footer}><span>OpenOak</span><a href={`${urls.home}/legal/`}>Privacy &amp; terms</a></footer>
    </div>
  );
}
