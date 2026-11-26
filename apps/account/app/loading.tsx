import { Logo } from "@/components/logo";

export default function Loading() {
  return (
    <main className="relative flex min-h-dvh items-center justify-center overflow-hidden bg-[#0b1413] px-5 text-white">
      <div
        aria-hidden
        className="pointer-events-none fixed inset-0 -z-20 bg-cover bg-center"
        style={{ backgroundImage: "url('/assets/openoak_bg.webp')" }}
      />
      <div
        aria-hidden
        className="pointer-events-none fixed inset-0 -z-10 bg-[linear-gradient(120deg,rgba(17,19,15,0.9)_0%,rgba(17,19,15,0.66)_45%,rgba(32,23,15,0.42)_100%)]"
      />
      <div className="flex flex-col items-center gap-5 text-center">
        <Logo className="text-3xl text-white" />
        <div className="size-8 animate-spin rounded-full border-2 border-white/30 border-t-white motion-reduce:animate-none" aria-hidden />
        <p className="text-sm font-semibold text-[#d8d0bd]" role="status">
          Preparing OpenOak
        </p>
      </div>
    </main>
  );
}
