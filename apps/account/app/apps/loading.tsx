import { Logo } from "@/components/logo";

export default function Loading() {
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
        <header className="flex items-center justify-between gap-4">
          <Logo className="text-2xl text-[#f6f3ee]" />
          <div className="h-10 w-20 rounded-full border border-white/12 bg-white/10" />
        </header>
        <section className="flex flex-1 items-center justify-center py-12">
          <div className="flex w-full flex-col items-center">
            <div className="grid w-full max-w-4xl grid-cols-3 items-start justify-items-center gap-4 sm:gap-10">
              {[0, 1, 2].map((item) => (
                <div key={item} className="flex w-full max-w-44 flex-col items-center gap-4">
                  <div className="size-20 animate-pulse rounded-full bg-white/10 motion-reduce:animate-none sm:size-24" />
                  <div className="h-5 w-20 animate-pulse rounded-full bg-white/14 motion-reduce:animate-none" />
                </div>
              ))}
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}
