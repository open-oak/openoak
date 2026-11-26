import { suiteUrls } from "../../../../shared/suite-config";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth-server";
import { Logo } from "@/components/logo";
import { AppLauncher } from "./app-launcher";

export default async function AppsPage() {
  const session = await auth.api.getSession({ headers: await headers() });

  if (!session) {
    redirect("/login");
  }

  const urls = suiteUrls();
  return (
    <main className="relative isolate min-h-dvh overflow-hidden px-5 py-5 text-[#f6f3ee] sm:px-8 sm:py-7">
      <div
        aria-hidden
        className="pointer-events-none fixed inset-0 z-0 bg-cover bg-center"
        style={{ backgroundImage: "url('/assets/openoak_bg.webp')" }}
      />
      <div
        aria-hidden
        className="pointer-events-none fixed inset-0 z-10 bg-[linear-gradient(120deg,rgba(17,19,15,0.9)_0%,rgba(17,19,15,0.66)_45%,rgba(32,23,15,0.42)_100%)]"
      />

      <div className="relative z-20 mx-auto flex min-h-[calc(100dvh-2.5rem)] w-full max-w-6xl flex-col sm:min-h-[calc(100dvh-3.5rem)]">
        <header className="flex flex-col items-start justify-between gap-4 sm:flex-row sm:items-center">
          <a href={urls.home} aria-label="OpenOak home" className="rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70">
            <Logo className="text-2xl text-[#f6f3ee]" />
          </a>
          <div className="flex flex-wrap items-center gap-2">
            <a href="/settings" className="inline-flex min-h-10 items-center rounded-full border border-white/18 bg-white/10 px-4 text-sm font-semibold hover:bg-white/18 focus-visible:outline focus-visible:outline-2">Account settings</a>
            <a href="/connected-ai" className="inline-flex h-10 items-center justify-center rounded-full border border-white/18 bg-white/10 px-4 text-sm font-semibold text-white transition hover:bg-white/18 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70 motion-reduce:transition-none">
              AI connections
            </a>
            <form action="/logout" method="post">
              <button
                type="submit"
                className="inline-flex h-10 items-center justify-center rounded-full border border-white/18 bg-white/10 px-4 text-sm font-semibold text-white transition hover:bg-white/18 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70 motion-reduce:transition-none"
              >
                Log out
              </button>
            </form>
          </div>
        </header>

        <section className="flex flex-1 items-center justify-center py-12">
          <AppLauncher apps={[{ name: "OpenTodo", href: urls.todo, icon: "✅" }, { name: "OpenOutline", href: urls.outline, icon: "📝" }, { name: "OpenKanban", href: urls.kanban, icon: "📋" }]} />
        </section>
      </div>
    </main>
  );
}
