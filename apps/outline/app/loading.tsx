export default function Loading() {
  return (
    <main className="notes-root flex min-h-dvh items-center justify-center px-6">
      <div className="notes-panel flex min-h-48 w-full max-w-sm flex-col items-center justify-center gap-5 px-6 text-center">
        <div className="size-9 animate-spin rounded-full border-2 border-[color-mix(in_oklab,var(--primary)_24%,transparent)] border-t-primary" aria-hidden />
        <div className="space-y-1">
          <p className="text-base font-bold text-foreground" role="status">
            Opening OpenOutline
          </p>
          <p className="text-sm text-muted-foreground">Checking your session.</p>
        </div>
      </div>
    </main>
  );
}
